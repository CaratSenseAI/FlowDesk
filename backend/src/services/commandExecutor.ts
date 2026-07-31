import { ActionChannel, CommandStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { checkRateLimit } from '../lib/rateLimit';
import { ParsedCommand, parseCommand, parseWithRules } from './commandService';
import { assignableUsers } from './permissionService';
import { Candidate, resolveName } from './nameResolutionService';
import { parseDeadline } from './deadlineParser';
import {
  PendingState, clearState, getState, readChoiceIndex, readConfirmation, setState,
} from './stateService';
import { getLastAttributedTaskId } from './conversationService';
import { sendInteractiveButtons } from './whatsappService';
import * as taskService from './taskService';
import { TaskOpError } from './taskService';

// ─────────────────────────────────────────────────────────────────────────────
// The trusted layer.
//
// Everything reaching this file is untrusted: the text came from WhatsApp, and
// the struct describing it came from a regex or a language model. Neither is
// evidence of anything. So nothing here takes the parse at its word —
// `taskService` re-reads the task, re-checks who the actor is, and re-derives
// the reporting hierarchy from the database before a single row changes.
//
// The model's only influence is on WHICH question gets asked. It cannot widen
// the set of people who may be assigned work (that comes from
// `assignableUsers`), it cannot reach a task the sender can't see, and a
// confident-sounding confidence score buys it nothing.
//
// Every command lands in `WhatsAppCommand`, including the refusals. A rejected
// command is the most interesting row in that table.
// ─────────────────────────────────────────────────────────────────────────────

export interface CommandActor {
  id:    string;
  name:  string;
  role:  string;
  phone: string | null;
}

export interface CommandContext {
  actor: CommandActor;
  /** The message text, or the transcript for a voice note. */
  text: string;
  transcription: string | null;
  waMessageId: string | null;
  /** Our own `Message` row, when one has been written. */
  messageId: string | null;
}

export interface CommandOutcome {
  /** What to send back to the sender. Never empty. */
  reply: string;
  status: CommandStatus;
  /**
   * The ticket the command was ABOUT — which is not the same as one that
   * exists. "Assign TSK-9999 to Vedant" reports TSK-9999 here so the audit
   * names it; the caller checks before using it as a foreign key.
   */
  taskId: string | null;
}

// ─── Feature gating ───────────────────────────────────────────────────────────

/**
 * Off unless switched on.
 *
 * This ships dark on purpose. Existing client deployments have managers whose
 * phone numbers are already registered; flipping this on by default would give
 * every one of them a live command channel the moment they upgraded, with no
 * decision made by anyone. `startupSummary()` logs the state at boot so a
 * deployment that meant to enable it and didn't is obvious in the logs.
 */
export function commandsEnabled(): boolean {
  return (process.env.WA_COMMANDS_ENABLED ?? 'false').toLowerCase() === 'true';
}

/**
 * How sure the parse has to be before anything changes without a human saying
 * yes. The AI layer clamps its own self-reported confidence to this same value,
 * so raising it above 0.9 means every AI-parsed command is confirmed first.
 */
export function confidenceThreshold(): number {
  const raw = parseFloat(process.env.WA_CONFIDENCE_THRESHOLD ?? '0.9');
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.9;
}

export function commandRoles(): string[] {
  return (process.env.WA_COMMAND_ROLES ?? 'Manager,Admin')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

export function startupSummary(): string {
  return commandsEnabled()
    ? `[Command] WhatsApp management commands ENABLED for: ${commandRoles().join(', ')}`
    : '[Command] WhatsApp management commands are DISABLED (set WA_COMMANDS_ENABLED=true to turn them on)';
}

/**
 * A cheap "is this worth looking at?" check for the webhook.
 *
 * Exists so the caller doesn't have to re-implement the gating rules to decide
 * whether to take the command path. It stays cheap deliberately: the rule parse
 * is pure string work, and the state lookup — the only query — runs solely for
 * roles that can issue commands at all.
 *
 * A true here is not permission to do anything. `tryHandleCommand` re-checks
 * everything; this only avoids pointless work on the overwhelming majority of
 * messages, which are workers reporting progress.
 */
export async function looksLikeCommand(actor: CommandActor, text: string): Promise<boolean> {
  if (!commandsEnabled()) return false;
  if (parseWithRules(text)) return true;
  if (!commandRoles().includes(actor.role)) return false;
  return (await getState(actor.id)) !== null;
}

// ─── Held state ───────────────────────────────────────────────────────────────

/**
 * A command that has been resolved as far as it can be and is waiting on the
 * sender — either to confirm it, or to say which of several people they meant.
 *
 * Held as ids, but RE-VALIDATED on execution: being in this payload grants no
 * authority. If the manager loses the report between asking and confirming, or
 * the ticket closes, the confirmation is refused like any other command.
 */
interface PendingCommand {
  parsed: ParsedCommand;
  /** Verified to exist at the time we asked. */
  taskId: string | null;
  targetId: string | null;
  targetName: string | null;
  /** Every resolved assignee, for a multi-person command. */
  targets: ChoiceOption[];
  previousAssigneeName: string | null;
  /** True when the ticket came from conversation context, not from the sender. */
  fromContext: boolean;
  /** Resolved deadline, carried as an ISO string through the Json column. */
  deadlineIso: string | null;
  /**
   * What the sender picked when we asked how several people relate, or what
   * to do about an already-assigned or completed task. Set by the button reply
   * and read when the held command finally runs.
   */
  resolution?: 'shared' | 'separate' | 'add' | 'replace' | 'reopen' | 'copy';
}

type ChoiceOption = Candidate;

/**
 * Button ids. Sent to Meta, echoed back verbatim in the webhook, and matched
 * here — so they are a wire format, not display text. Meta caps a button title
 * at 20 characters, which every label below respects.
 */
const BTN = {
  shared:   'wa_shared',
  separate: 'wa_separate',
  add:      'wa_add',
  replace:  'wa_replace',
  reopen:   'wa_reopen',
  copy:     'wa_copy',
  cancel:   'wa_cancel',
} as const;

// ─── Audit ────────────────────────────────────────────────────────────────────

interface AuditInput {
  intent:     string | null;
  entities:   unknown;
  confidence: number | null;
  taskId?:    string | null;
  previousAssigneeId?: string | null;
  newAssigneeId?:      string | null;
  confirmed?: boolean;
  status:     CommandStatus;
  errorReason?: string | null;
}

/**
 * Write the audit row. Never throws — losing the audit write must not also lose
 * the reply telling the sender what happened, and the alternative (an exception
 * here unwinding a change that already committed) is worse than a gap in this
 * log, which the `Activity` row still covers.
 */
async function record(ctx: CommandContext, input: AuditInput): Promise<void> {
  try {
    await prisma.whatsAppCommand.create({
      data: {
        senderId:         ctx.actor.id,
        senderPhoneLast4: (ctx.actor.phone ?? '').replace(/\D/g, '').slice(-4),
        waMessageId:      ctx.waMessageId,
        messageId:        ctx.messageId,
        rawText:          ctx.text.slice(0, 2000),
        transcription:    ctx.transcription,
        intent:           input.intent,
        entities:         (input.entities ?? {}) as object,
        confidence:       input.confidence,
        taskId:           input.taskId ?? null,
        previousAssigneeId: input.previousAssigneeId ?? null,
        newAssigneeId:      input.newAssigneeId ?? null,
        channel:          ActionChannel.whatsapp,
        confirmed:        input.confirmed ?? false,
        status:           input.status,
        errorReason:      input.errorReason ?? null,
      },
    });
  } catch (err) {
    console.error('[Command] Failed writing audit row:', err);
  }
}

function outcome(reply: string, status: CommandStatus, taskId: string | null = null): CommandOutcome {
  return { reply, status, taskId };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Handle this message as a management command, or decline it.
 *
 * Returns null when the message isn't one — which is the common case, since
 * most traffic on this webhook is workers reporting progress. A null return
 * means the caller carries on down the existing worker pipeline, unchanged.
 */
export async function tryHandleCommand(ctx: CommandContext): Promise<CommandOutcome | null> {
  if (!commandsEnabled()) return null;

  const roleAllowed = commandRoles().includes(ctx.actor.role);

  // ── Is this an answer to something we asked? ─────────────────────────────
  if (roleAllowed) {
    const state = await getState(ctx.actor.id);
    if (state) {
      const resolved = await resolvePending(ctx, state);
      // null means "that wasn't an answer" — fall through and see whether it's
      // a fresh command instead.
      if (resolved) return resolved;
    }
  }

  // ── Is this a new command? ───────────────────────────────────────────────
  const parsed = await parseCommand(ctx.text);
  if (!parsed) return null;

  if (!roleAllowed) {
    // Only refuse a command they unmistakably issued. The handover verbs are
    // ordinary English — "I handed over the site to Vikranth" is a worker
    // reporting progress, and answering it with "only managers can reassign
    // tickets" would be both wrong and baffling. A partial parse falls through
    // to the worker pipeline where it belongs.
    if (parsed.confidence < confidenceThreshold()) return null;

    // A complete command, though, is told explicitly rather than ignored: an
    // employee who tries this and hears nothing back assumes it worked.
    const reply = 'Only managers can assign or reassign tickets over WhatsApp. ' +
      'Reply with an update on one of your own tasks instead.';
    await record(ctx, {
      intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
      taskId: parsed.taskRef, status: CommandStatus.rejected, errorReason: reply,
    });
    return outcome(reply, CommandStatus.rejected, parsed.taskRef);
  }

  // ── Throttle ─────────────────────────────────────────────────────────────
  const limit = checkRateLimit(ctx.actor.id);
  if (!limit.allowed) {
    const reply = `You've sent a lot of commands in a short time. ` +
      `Please try again in about ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`;
    await record(ctx, {
      intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
      taskId: parsed.taskRef, status: CommandStatus.rejected, errorReason: 'Rate limited',
    });
    return outcome(reply, CommandStatus.rejected, parsed.taskRef);
  }

  try {
    switch (parsed.intent) {
      case 'reassign_ticket': return await startReassign(ctx, parsed);
      case 'create_task':     return await startCreate(ctx, parsed);
      case 'add_comment':
      case 'set_priority':
      case 'set_deadline':    return await startEdit(ctx, parsed);
    }
  } catch (err) {
    console.error('[Command] Unexpected failure:', err);
    await record(ctx, {
      intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
      taskId: parsed.taskRef, status: CommandStatus.failed, errorReason: (err as Error).message,
    });
    return outcome(
      'Something went wrong handling that. Please try again, or use the dashboard.',
      CommandStatus.failed,
      parsed.taskRef,
    );
  }
}

// ─── Resolving the pieces ─────────────────────────────────────────────────────

/**
 * Which ticket, given that the sender may not have said.
 *
 * "Delegate this ticket to Vikranth" names no number, so fall back to whatever
 * the conversation was just about — the same context window the worker pipeline
 * uses for "also done". A ticket found that way is flagged, because it must
 * never be acted on without showing the sender which one we picked.
 */
async function resolveTicket(
  ctx: CommandContext,
  parsed: ParsedCommand,
): Promise<{ taskRef: string | null; fromContext: boolean }> {
  if (parsed.taskRef) return { taskRef: parsed.taskRef, fromContext: false };

  const contextual = await getLastAttributedTaskId(ctx.actor.id);
  return { taskRef: contextual, fromContext: contextual !== null };
}

async function loadTask(taskRef: string) {
  return prisma.task.findUnique({
    where:  { id: taskRef },
    select: {
      id: true, title: true, status: true, priority: true, deadline: true,
      assignedToId: true, assignedById: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });
}

// ─── Reassignment ─────────────────────────────────────────────────────────────

async function startReassign(ctx: CommandContext, parsed: ParsedCommand): Promise<CommandOutcome> {
  const audit = { intent: parsed.intent, entities: parsed, confidence: parsed.confidence } as const;

  const { taskRef, fromContext } = await resolveTicket(ctx, parsed);
  if (!taskRef) {
    const reply =
      'I understood that you want to assign a ticket, but I could not identify the ' +
      'ticket number. Please provide it in a format such as TSK-1059.';
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const task = await loadTask(taskRef);
  if (!task) {
    const reply = `I could not find ticket ${taskRef}. Please check the ticket number and try again.`;
    await record(ctx, { ...audit, taskId: taskRef, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected, taskRef);
  }

  // ── Who to? ──────────────────────────────────────────────────────────────
  //
  // The candidate list IS the permission boundary — see nameResolutionService.
  // Someone outside the sender's hierarchy is absent from this list, so they
  // cannot be selected and the reply cannot reveal that they exist.
  const scope = await assignableUsers(ctx.actor);

  const base: PendingCommand = {
    parsed, taskId: task.id, targetId: null, targetName: null, targets: [],
    previousAssigneeName: task.assignedTo.name, fromContext, deadlineIso: null,
  };

  if (parsed.targetNames.length === 0) {
    const reply =
      `I understood that you want to reassign ${task.id}, but not who to. ` +
      `Reply with a name${scope.length ? ` — for example: ${namesOf(scope, 3)}` : ''}.`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying, task.id);
  }

  // ── Resolve every name against the sender's own team ─────────────────────
  const resolved = await resolveEveryName(ctx, parsed.targetNames, scope, base, task.id);
  if ('outcome' in resolved) return resolved.outcome;
  const targets = resolved.targets;

  const pending: PendingCommand = {
    ...base, targets, targetId: targets[0].id, targetName: targets[0].name,
  };

  const holderIds = new Set(
    (await prisma.taskAssignee.findMany({ where: { taskId: task.id }, select: { userId: true } }))
      .map((a) => a.userId),
  );

  // ── UC10: this is already exactly what was asked for ─────────────────────
  if (targets.length === holderIds.size && targets.every((t) => holderIds.has(t.id))) {
    const reply = `${task.id} is already assigned to ${listNames(targets)}. ` +
      `No duplicate assignment was created.`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected, task.id);
  }

  // ── UC24: the task is finished ───────────────────────────────────────────
  // Reopening loses nothing — the activity log is append-only — but it does
  // reverse a decision an approver made, so it is never silent.
  if (task.status === 'Done') {
    return askWithButtons(ctx, pending,
      `${task.id} is completed. Reopen it and assign it to ${listNames(targets)}, or create a new copy?`,
      [
        { id: BTN.reopen, title: 'Reopen task' },
        { id: BTN.copy,   title: 'Create a copy' },
        { id: BTN.cancel, title: 'Cancel' },
      ]);
  }

  // ── UC4: several people, and nothing saying how they relate ──────────────
  // The two readings give different people different work, so this is asked
  // however confident the rest of the parse was.
  if (targets.length > 1 && parsed.assignmentIntent === null) {
    return askWithButtons(ctx, pending,
      `Should ${listNames(targets)} share ${task.id}, or should I create a separate task for each person?`,
      [
        { id: BTN.shared,   title: 'Share one task' },
        { id: BTN.separate, title: 'Separate tasks' },
        { id: BTN.cancel,   title: 'Cancel' },
      ]);
  }

  // ── UC5 / UC7: somebody already holds it ─────────────────────────────────
  // "Also assign" adds and "instead" replaces; where the sender said neither,
  // one of those answers takes the task away from somebody mid-flight, so it
  // is the question that must not be guessed.
  const newcomers = targets.filter((t) => !holderIds.has(t.id));
  // "Somebody else" excludes the sender. A manager delegating a ticket they are
  // personally holding is not taking work off anyone — they ARE the person
  // being relieved — so it needs no confirmation. That is the spec's own
  // scenario, and confirming it would put a question in front of the most
  // common command there is.
  const somebodyElseHolds = [...holderIds]
    .some((id) => id !== ctx.actor.id && !targets.some((t) => t.id === id));

  // Only an EXPLICIT "also"/"add"/"too"/"bhi" raises this. A plain "assign task
  // 4 to Vedant" says neither add nor replace and is an ordinary reassignment —
  // asking about every one of those would make the common case cost two
  // messages for no reason.
  if (parsed.adds && newcomers.length > 0 && somebodyElseHolds && parsed.assignmentIntent === null) {
    return askWithButtons(ctx, pending,
      `${task.id} is currently assigned to ${task.assignedTo.name}. Add ` +
      `${listNames(newcomers)} as a joint assignee, or reassign the task?`,
      [
        { id: BTN.add,     title: 'Add as joint' },
        { id: BTN.replace, title: 'Reassign' },
        { id: BTN.cancel,  title: 'Cancel' },
      ]);
  }

  // Three ways to end up asking, each mapping to a clause in the spec:
  //   • the name wasn't exact        — a typo, resolved but not assumed
  //   • the parse wasn't confident   — the model was guessing
  //   • the ticket came from context — the sender never said which one
  //
  // A fourth: replacement language on a task somebody else is holding, WITHOUT
  // the sender having named them. "Reassign task 4 from Vedant to Vikranth"
  // shows they already know who they are removing, so it goes through. "Give
  // task 4 to Vikranth instead" does not, and taking work off somebody who is
  // mid-flight is the thing the spec says must always be confirmed.
  const namedTheHolder =
    parsed.fromName !== null &&
    resolveName(parsed.fromName, [{ id: task.assignedToId, name: task.assignedTo.name }])
      .status === 'matched';

  const certain =
    !resolved.requiresConfirmation &&
    parsed.confidence >= confidenceThreshold() &&
    !fromContext &&
    !(parsed.replaces && somebodyElseHolds && !namedTheHolder);

  return certain ? execute(ctx, pending, false) : askToConfirm(ctx, pending);
}

/**
 * Resolve a list of names to people, or return the question that has to be
 * asked instead. Every name is searched only within `scope` — see
 * nameResolutionService for why that list IS the permission boundary.
 */
async function resolveEveryName(
  ctx: CommandContext,
  names: string[],
  scope: { id: string; name: string }[],
  base: PendingCommand,
  taskId: string | null,
): Promise<{ targets: ChoiceOption[]; requiresConfirmation: boolean } | { outcome: CommandOutcome }> {
  const targets: ChoiceOption[] = [];
  let requiresConfirmation = false;

  for (const name of names) {
    const resolution = resolveName(name, scope);

    if (resolution.status === 'not_found') {
      const reply = scope.length === 0
        ? `You don't have anyone reporting to you that I can assign work to.`
        : `I couldn't find anyone called "${name}" in your team. ` +
          `You can assign to: ${namesOf(scope, 8)}.`;
      await record(ctx, {
        intent: base.parsed.intent, entities: base.parsed,
        confidence: base.parsed.confidence, taskId,
        status: CommandStatus.rejected, errorReason: reply,
      });
      return { outcome: outcome(reply, CommandStatus.rejected, taskId) };
    }

    if (resolution.status === 'ambiguous') {
      return { outcome: await askWhichPerson(ctx, base, resolution.candidates.map((c) => c.user)) };
    }

    targets.push({ id: resolution.match!.user.id, name: resolution.match!.user.name });
    if (resolution.requiresConfirmation) requiresConfirmation = true;
  }

  return { targets, requiresConfirmation };
}

function listNames(people: { name: string }[]): string {
  if (people.length === 0) return 'nobody';
  if (people.length === 1) return people[0].name;
  return `${people.slice(0, -1).map((p) => p.name).join(', ')} and ${people[people.length - 1].name}`;
}

// ─── Creation ─────────────────────────────────────────────────────────────────

async function startCreate(ctx: CommandContext, parsed: ParsedCommand): Promise<CommandOutcome> {
  const audit = { intent: parsed.intent, entities: parsed, confidence: parsed.confidence } as const;

  if (!parsed.title) {
    const reply =
      'I understood that you want to create a task, but not what it is. Try ' +
      '"Create a task for Vedant to prepare the weekly report by Friday".';
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const scope = await assignableUsers(ctx.actor);
  const base: PendingCommand = {
    parsed, taskId: null, targetId: null, targetName: null, targets: [],
    previousAssigneeName: null, fromContext: false, deadlineIso: null,
  };

  if (parsed.targetNames.length === 0) {
    const reply =
      `I understood that you want to create "${parsed.title}", but not who for. ` +
      `Reply with a name${scope.length ? ` — for example: ${namesOf(scope, 3)}` : ''}.`;
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const resolved = await resolveEveryName(ctx, parsed.targetNames, scope, base, null);
  if ('outcome' in resolved) return resolved.outcome;
  const targets = resolved.targets;

  // A task with no deadline can't exist — the escalation engine is built on it.
  // So an unreadable date is a question, never a default.
  const deadline = parsed.deadlineText ? parseDeadline(parsed.deadlineText) : null;
  if (!deadline) {
    const reply = parsed.deadlineText
      ? `I couldn't work out the date "${parsed.deadlineText}". When is "${parsed.title}" due? ` +
        `Try "by Friday", "tomorrow", or "15/08".`
      : `When is "${parsed.title}" due? Try "by Friday", "tomorrow", or "15/08".`;
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const pending: PendingCommand = {
    ...base,
    targets,
    targetId: targets[0].id,
    targetName: targets[0].name,
    deadlineIso: deadline.toISOString(),
  };

  // Same question as reassignment, and for the same reason: two people named
  // and no word saying whether that is one job or two.
  if (targets.length > 1 && parsed.assignmentIntent === null) {
    return askWithButtons(ctx, pending,
      `Should ${listNames(targets)} share one task for "${parsed.title}", or should I create a separate task for each?`,
      [
        { id: BTN.shared,   title: 'Share one task' },
        { id: BTN.separate, title: 'Separate tasks' },
        { id: BTN.cancel,   title: 'Cancel' },
      ]);
  }

  const certain = !resolved.requiresConfirmation && parsed.confidence >= confidenceThreshold();
  return certain ? execute(ctx, pending, false) : askToConfirm(ctx, pending);
}

// ─── Comment / priority / deadline ────────────────────────────────────────────

async function startEdit(ctx: CommandContext, parsed: ParsedCommand): Promise<CommandOutcome> {
  const audit = { intent: parsed.intent, entities: parsed, confidence: parsed.confidence } as const;

  const { taskRef, fromContext } = await resolveTicket(ctx, parsed);
  if (!taskRef) {
    const reply =
      'I understood what you want to change, but not which ticket. ' +
      'Please include it in a format such as TSK-1059.';
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const task = await loadTask(taskRef);
  if (!task) {
    const reply = `I could not find ticket ${taskRef}. Please check the ticket number and try again.`;
    await record(ctx, { ...audit, taskId: taskRef, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected, taskRef);
  }

  const pending: PendingCommand = {
    parsed, taskId: task.id, targetId: null, targetName: null, targets: [],
    previousAssigneeName: task.assignedTo.name, fromContext, deadlineIso: null,
  };

  // Each intent needs its own value present before there is anything to do.
  if (parsed.intent === 'add_comment' && !parsed.comment) {
    const reply = `What should the comment on ${task.id} say?`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying, task.id);
  }

  if (parsed.intent === 'set_priority' && !parsed.priority) {
    const reply = `What priority should ${task.id} be — High, Medium or Low?`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying, task.id);
  }

  if (parsed.intent === 'set_deadline') {
    const deadline = parsed.deadlineText ? parseDeadline(parsed.deadlineText) : null;
    if (!deadline) {
      const reply = parsed.deadlineText
        ? `I couldn't work out the date "${parsed.deadlineText}". Try "Friday", "tomorrow", or "15/08".`
        : `When should ${task.id} be due? Try "Friday", "tomorrow", or "15/08".`;
      await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.clarifying, errorReason: reply });
      return outcome(reply, CommandStatus.clarifying, task.id);
    }
    pending.deadlineIso = deadline.toISOString();
  }

  const certain = parsed.confidence >= confidenceThreshold() && !fromContext;
  return certain ? execute(ctx, pending, false) : askToConfirm(ctx, pending);
}

// ─── Asking ───────────────────────────────────────────────────────────────────

/**
 * Offer a small set of choices as WhatsApp buttons.
 *
 * Meta allows at most three, which is exactly what every question here needs:
 * two ways forward and a way out. The reply arrives as the button's id in the
 * message text, so `resolvePending` matches on `BTN.*` rather than on wording
 * — and the same handler still accepts a typed answer for anyone whose client
 * doesn't render buttons.
 */
async function askWithButtons(
  ctx: CommandContext,
  pending: PendingCommand,
  body: string,
  buttons: { id: string; title: string }[],
): Promise<CommandOutcome> {
  await setState(ctx.actor.id, 'choose_option', pending, buttons);

  if (ctx.actor.phone) {
    await sendInteractiveButtons(ctx.actor.phone, body, buttons.slice(0, 3));
  }

  await record(ctx, {
    intent: pending.parsed.intent, entities: pending.parsed,
    confidence: pending.parsed.confidence, taskId: pending.taskId,
    status: CommandStatus.clarifying, errorReason: body,
  });

  // The text is returned as well as sent: a client that can't render buttons
  // still sees the question, and the caller records it in the thread.
  return outcome(
    `${body}\n${buttons.map((b) => `• ${b.title}`).join('\n')}`,
    CommandStatus.clarifying,
    pending.taskId,
  );
}

async function askWhichPerson(
  ctx: CommandContext,
  pending: PendingCommand,
  candidates: ChoiceOption[],
): Promise<CommandOutcome> {
  const options = candidates.map((c) => ({ id: c.id, name: c.name }));
  await setState(ctx.actor.id, 'choose_employee', pending, options);

  const reply =
    `I found ${options.length} employees with similar names: ` +
    `${options.map((o, i) => `${i + 1}. ${o.name}`).join('  ')}\n` +
    `Please reply with the correct name or its number.`;

  await record(ctx, {
    intent: pending.parsed.intent, entities: pending.parsed,
    confidence: pending.parsed.confidence, taskId: pending.taskId,
    status: CommandStatus.clarifying, errorReason: reply,
  });
  return outcome(reply, CommandStatus.clarifying, pending.taskId);
}

function describe(pending: PendingCommand): string {
  const p = pending.parsed;
  const due = pending.deadlineIso ? fmtDate(new Date(pending.deadlineIso)) : null;

  switch (p.intent) {
    case 'reassign_ticket':
      return `reassign ${pending.taskId} from ${pending.previousAssigneeName} to ${pending.targetName}`;
    case 'create_task':
      return `create a task for ${pending.targetName}: "${p.title}", due ${due}`;
    case 'add_comment':
      return `add this comment to ${pending.taskId}: "${p.comment}"`;
    case 'set_priority':
      return `set ${pending.taskId} to ${p.priority} priority`;
    case 'set_deadline':
      return `move the ${pending.taskId} deadline to ${due}`;
  }
}

async function askToConfirm(ctx: CommandContext, pending: PendingCommand): Promise<CommandOutcome> {
  await setState(ctx.actor.id, 'confirm', pending);

  // On a voice note, show what was transcribed. The sender can hear their own
  // words back in WhatsApp but has no idea what we made of them, and a bad
  // transcript is the likeliest reason we're asking in the first place.
  const heard = ctx.transcription ? `I heard: "${ctx.transcription.slice(0, 120)}"\n\n` : '';

  const reply =
    `${heard}You are about to ${describe(pending)}. ` +
    `Reply "Confirm" to continue, or "Cancel" to stop.`;

  await record(ctx, {
    intent: pending.parsed.intent, entities: pending.parsed,
    confidence: pending.parsed.confidence, taskId: pending.taskId,
    newAssigneeId: pending.targetId,
    status: CommandStatus.awaiting_confirmation,
  });

  return outcome(reply, CommandStatus.awaiting_confirmation, pending.taskId);
}

// ─── Doing it ─────────────────────────────────────────────────────────────────

/**
 * Carry out the command — by calling `taskService`, which is the same code the
 * web endpoints run. Every authorization check happens in there, against data
 * read fresh from the database, no matter how the command reached this point or
 * how long it sat in a pending state first.
 */
async function execute(
  ctx: CommandContext,
  pending: PendingCommand,
  confirmed: boolean,
): Promise<CommandOutcome> {
  const actor  = { id: ctx.actor.id, role: ctx.actor.role };
  const parsed = pending.parsed;
  const opts   = { channel: ActionChannel.whatsapp };

  const before = pending.taskId
    ? await prisma.task.findUnique({ where: { id: pending.taskId }, select: { assignedToId: true } })
    : null;

  try {
    let reply: string;
    let taskId = pending.taskId;

    switch (parsed.intent) {
      case 'reassign_ticket': {
        // How the sender answered, or what the wording already said.
        const mode = pending.resolution
          ?? (parsed.assignmentIntent === 'shared'   ? 'shared'
            : parsed.assignmentIntent === 'separate' ? 'separate'
            : parsed.replaces                        ? 'replace'
            : pending.targets.length > 1             ? 'shared'
            : 'replace');

        if (mode === 'reopen') {
          await taskService.reopen(actor, pending.taskId!, opts);
          const task = await taskService.reassign(actor, pending.taskId!, pending.targetId!, {
            ...opts, reason: parsed.reason,
          });
          reply = `✅ ${task.id} has been reopened and assigned to ${task.assignedTo.name}.`;
          break;
        }

        if (mode === 'copy' || mode === 'separate') {
          // One task each, copied from the original. The source keeps its own
          // assignee and its own history — nothing about it changes.
          const made: string[] = [];
          for (const t of pending.targets) {
            const copy = await taskService.duplicate(actor, pending.taskId!, t.id, opts);
            made.push(`${copy.id} for ${t.name}`);
          }
          reply = made.length === 1
            ? `✅ ${made[0].replace(' for ', ' has been created as a copy of ' + pending.taskId + ' and assigned to ')}.`
            : `✅ ${made.length} separate tasks were created from ${pending.taskId}: ${made.join(', ')}. ` +
              `Each person was notified separately.`;
          break;
        }

        if (mode === 'shared' || mode === 'add') {
          const task = await taskService.addAssignees(
            actor, pending.taskId!, pending.targets.map((t) => t.id), opts,
          );
          const holders = task.assignees.map((a) => a.user.name);
          reply = `✅ ${task.id} has been assigned jointly to ${holders.join(' and ')}. ` +
            `Each of them must complete their own part before it goes for approval.`;
          break;
        }

        const task = await taskService.reassign(actor, pending.taskId!, pending.targetId!, {
          ...opts, reason: parsed.reason,
        });
        reply = `✅ Ticket ${task.id} has been assigned to ${task.assignedTo.name} successfully.`;
        break;
      }
      case 'create_task': {
        const mode = pending.resolution ?? parsed.assignmentIntent ?? 'separate';

        // One task each is the default for a new instruction: without an
        // existing task there is nothing to share, and a copy each is the
        // reading that preserves everyone's individual accountability.
        if (pending.targets.length > 1 && mode === 'separate') {
          const made: string[] = [];
          for (const t of pending.targets) {
            const made1 = await taskService.create(actor, {
              title:        parsed.title!,
              assignedToId: t.id,
              priority:     parsed.priority ?? undefined,
              deadline:     new Date(pending.deadlineIso!),
            }, opts);
            made.push(`${made1.id} for ${t.name}`);
            taskId = made1.id;
          }
          reply = `✅ ${made.length} tasks were created from the same instruction: ${made.join(', ')}. ` +
            `Each person was notified separately.`;
          break;
        }

        const created = await taskService.create(actor, {
          title:        parsed.title!,
          assignedToId: pending.targets[0]?.id ?? pending.targetId!,
          priority:     parsed.priority ?? undefined,
          deadline:     new Date(pending.deadlineIso!),
        }, opts);
        taskId = created.id;

        if (pending.targets.length > 1) {
          const shared = await taskService.addAssignees(
            actor, created.id, pending.targets.slice(1).map((t) => t.id), opts,
          );
          reply = `✅ Created ${shared.id} — "${shared.title}", due ${fmtDate(shared.deadline)}, ` +
            `assigned jointly to ${shared.assignees.map((a) => a.user.name).join(' and ')}.`;
          break;
        }

        reply = `✅ Created ${created.id} for ${created.assignedTo.name} — "${created.title}", due ${fmtDate(created.deadline)}.`;
        break;
      }
      case 'add_comment': {
        const task = await taskService.comment(actor, pending.taskId!, parsed.comment!, opts);
        reply = `✅ Comment added to ${task.id}.`;
        break;
      }
      case 'set_priority': {
        const task = await taskService.setPriority(actor, pending.taskId!, parsed.priority!, opts);
        reply = `✅ ${task.id} priority set to ${task.priority}.`;
        break;
      }
      case 'set_deadline': {
        const task = await taskService.setDeadline(actor, pending.taskId!, new Date(pending.deadlineIso!), opts);
        reply = `✅ ${task.id} deadline moved to ${fmtDate(task.deadline)}.`;
        break;
      }
    }

    await record(ctx, {
      intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
      taskId,
      previousAssigneeId: before?.assignedToId ?? null,
      newAssigneeId: pending.targetId,
      confirmed,
      status: CommandStatus.executed,
    });

    console.log(`[Command] ${ctx.actor.name}: ${parsed.intent} on ${taskId} via WhatsApp`);
    return outcome(reply, CommandStatus.executed, taskId);
  } catch (err) {
    // A refusal from taskService is an answer, and the sender gets the reason.
    // Anything else is a bug and must not be echoed back verbatim.
    const isRefusal = err instanceof TaskOpError;
    if (!isRefusal) console.error(`[Command] Unexpected failure on ${pending.taskId}:`, err);

    const reply = isRefusal
      ? refusalMessage(err as TaskOpError, pending)
      : `Something went wrong. Please try again, or use the dashboard.`;

    await record(ctx, {
      intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
      taskId: pending.taskId,
      previousAssigneeId: before?.assignedToId ?? null,
      newAssigneeId: pending.targetId,
      confirmed,
      status: isRefusal ? CommandStatus.rejected : CommandStatus.failed,
      errorReason: (err as Error).message,
    });

    return outcome(reply, isRefusal ? CommandStatus.rejected : CommandStatus.failed, pending.taskId);
  }
}

function refusalMessage(err: TaskOpError, pending: PendingCommand): string {
  if (err.code === 'forbidden') {
    return err.message.includes('outside your permitted reporting structure')
      ? `You cannot assign ${pending.taskId ?? 'this ticket'} to ${pending.targetName} because ` +
        `they are outside your permitted reporting structure.`
      : `You do not have permission to change ${pending.taskId ?? 'that ticket'}.`;
  }
  if (err.code === 'not_found') {
    return `I could not find ticket ${pending.taskId}. Please check the ticket number and try again.`;
  }
  return err.message;
}

// ─── Answering a held question ────────────────────────────────────────────────

/**
 * Interpret this message as a reply to whatever we last asked.
 *
 * Returns null when it clearly isn't one, so the message gets a second chance
 * as a fresh command or as an ordinary worker update. That fallthrough is what
 * stops a forgotten pending question from swallowing unrelated messages for the
 * rest of its lifetime.
 */
async function resolvePending(
  ctx: CommandContext,
  state: PendingState,
): Promise<CommandOutcome | null> {
  const pending = state.payload as PendingCommand;

  if (state.kind === 'confirm') {
    const answer = readConfirmation(ctx.text);

    if (answer === 'yes') {
      await clearState(ctx.actor.id);
      return execute(ctx, pending, true);
    }

    if (answer === 'no') {
      await clearState(ctx.actor.id);
      await record(ctx, {
        intent: pending.parsed.intent, entities: pending.parsed,
        confidence: pending.parsed.confidence, taskId: pending.taskId,
        newAssigneeId: pending.targetId, status: CommandStatus.cancelled,
      });
      return outcome(
        `Cancelled — ${pending.taskId ?? 'nothing'} has not been changed.`,
        CommandStatus.cancelled,
        pending.taskId,
      );
    }

    // Unclear. If it reads as a new command, let that replace this one.
    if (await parseCommand(ctx.text)) return null;

    return outcome(
      `I still need a yes or no: reply "Confirm" to ${describe(pending)}, or "Cancel" to stop.`,
      CommandStatus.awaiting_confirmation,
      pending.taskId,
    );
  }

  if (state.kind === 'choose_option') {
    const options = state.options as { id: string; title: string }[];
    const said    = ctx.text.trim().toLowerCase();

    // A tapped button arrives as its id; a typed reply arrives as words. Both
    // are accepted, because not every client renders buttons.
    const chosen = options.find((o) => o.id.toLowerCase() === said)
      ?? options.find((o) => o.title.toLowerCase() === said)
      ?? (readChoiceIndex(ctx.text, options.length) !== null
            ? options[readChoiceIndex(ctx.text, options.length)!]
            : undefined);

    if (!chosen) {
      // Typed "cancel"/"no" rather than tapping it.
      if (readConfirmation(ctx.text) === 'no') {
        await clearState(ctx.actor.id);
        await record(ctx, {
          intent: pending.parsed.intent, entities: pending.parsed,
          confidence: pending.parsed.confidence, taskId: pending.taskId,
          status: CommandStatus.cancelled,
        });
        return outcome(`Cancelled — nothing was changed.`, CommandStatus.cancelled, pending.taskId);
      }
      if (await parseCommand(ctx.text)) return null;
      return outcome(
        `I still need to know which: ${options.map((o) => o.title).join(' / ')}`,
        CommandStatus.clarifying,
        pending.taskId,
      );
    }

    await clearState(ctx.actor.id);

    if (chosen.id === BTN.cancel) {
      await record(ctx, {
        intent: pending.parsed.intent, entities: pending.parsed,
        confidence: pending.parsed.confidence, taskId: pending.taskId,
        status: CommandStatus.cancelled,
      });
      return outcome(
        `Cancelled — ${pending.taskId ?? 'nothing'} has not been changed.`,
        CommandStatus.cancelled,
        pending.taskId,
      );
    }

    const RESOLUTIONS: Record<string, PendingCommand['resolution']> = {
      [BTN.shared]: 'shared', [BTN.separate]: 'separate',
      [BTN.add]: 'add', [BTN.replace]: 'replace',
      [BTN.reopen]: 'reopen', [BTN.copy]: 'copy',
    };

    // The answer resolves the ambiguity; it does not authorise the change.
    // Everything is re-validated inside execute → taskService.
    return execute(ctx, { ...pending, resolution: RESOLUTIONS[chosen.id] }, true);
  }

  if (state.kind === 'choose_employee') {
    const options = state.options as ChoiceOption[];

    const byIndex = readChoiceIndex(ctx.text, options.length);
    // Re-run resolution against the shortlist only. A reply of "Sharma" is
    // unambiguous among the two people we offered even though it wasn't
    // against the whole team.
    const picked = byIndex !== null
      ? options[byIndex]
      : resolveName(ctx.text, options).match?.user ?? null;

    if (!picked) {
      if (await parseCommand(ctx.text)) return null;
      return outcome(
        `I still need to know which one: ${options.map((o, i) => `${i + 1}. ${o.name}`).join('  ')}`,
        CommandStatus.clarifying,
        pending.taskId,
      );
    }

    // Disambiguation resolves the name; it does not authorise the change. The
    // sender still confirms, which is the flow the spec describes.
    return askToConfirm(ctx, {
      ...pending,
      targetId: picked.id,
      targetName: picked.name,
      // Replace only the name that WAS ambiguous, keeping any already resolved.
      targets: [...pending.targets.filter((t) => t.id !== picked.id), picked],
    });
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function namesOf(users: { name: string }[], limit: number): string {
  const shown = users.slice(0, limit).map((u) => u.name);
  const extra = users.length - shown.length;
  return shown.join(', ') + (extra > 0 ? `, and ${extra} more` : '');
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
