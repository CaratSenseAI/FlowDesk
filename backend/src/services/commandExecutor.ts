import { ActionChannel, CommandStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { checkRateLimit } from '../lib/rateLimit';
import { ParsedCommand, parseCommand, parseWithRules } from './commandService';
import { assignableUsers } from './permissionService';
import { Candidate, resolveName } from './nameResolutionService';
import {
  PendingState, clearState, getState, readChoiceIndex, readConfirmation, setState,
} from './stateService';
import { getLastAttributedTaskId } from './conversationService';
import { TaskOpError, reassign } from './taskService';

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
  /** The task the command ended up touching, for the caller's logging. */
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
 * How sure the parse has to be before a ticket moves without a human saying
 * yes. The AI layer clamps its own self-reported confidence to this same value,
 * so raising it above 0.9 means every AI-parsed command is confirmed.
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
 * A reassignment that has been fully resolved and is waiting on a yes.
 *
 * Held as ids, but re-validated on execution — see `runReassign`. Being in this
 * payload is not authority to do anything; if the manager loses the report
 * between asking and confirming, the confirmation is refused.
 */
interface PendingReassign {
  intent: 'reassign_ticket';
  taskId: string;
  newAssigneeId: string;
  newAssigneeName: string;
  previousAssigneeName: string;
  reason: string | null;
  confidence: number;
  rawText: string;
}

/** An unresolved name, plus the shortlist we offered. */
interface PendingChoice {
  intent: 'reassign_ticket';
  taskId: string;
  reason: string | null;
  confidence: number;
  rawText: string;
}

type ChoiceOption = Candidate;

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
 * the reply telling the sender what happened, and the alternative (an
 * exception here unwinding a reassignment that already committed) is worse than
 * a gap in the log, which the `Activity` row still covers.
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
    // Told explicitly rather than silently ignored. An employee who tries this
    // and hears nothing back assumes it worked.
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

  switch (parsed.intent) {
    case 'reassign_ticket':
      return startReassign(ctx, parsed);
    default:
      return notYetSupported(ctx, parsed);
  }
}

async function notYetSupported(ctx: CommandContext, parsed: ParsedCommand): Promise<CommandOutcome> {
  const reply =
    'I can reassign a ticket for you — try "Assign TSK-1059 to Vikranth". ' +
    'Other changes still need the dashboard for now.';
  await record(ctx, {
    intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
    taskId: parsed.taskRef, status: CommandStatus.rejected, errorReason: 'Intent not supported yet',
  });
  return outcome(reply, CommandStatus.rejected, parsed.taskRef);
}

// ─── Reassignment ─────────────────────────────────────────────────────────────

async function startReassign(ctx: CommandContext, parsed: ParsedCommand): Promise<CommandOutcome> {
  const audit = {
    intent: parsed.intent, entities: parsed, confidence: parsed.confidence,
  } as const;

  // ── Which ticket? ────────────────────────────────────────────────────────
  //
  // "Delegate this ticket to Vikranth" names no number. Rather than refuse, fall
  // back to whatever this conversation was just talking about — the same
  // context window the worker pipeline uses for "also done".
  //
  // A ticket found this way is never acted on without confirmation, however
  // exact the name is: the sender didn't say which ticket, so we have to show
  // them the one we picked.
  const fromContext = parsed.taskRef ? null : await getLastAttributedTaskId(ctx.actor.id);
  const taskRef = parsed.taskRef ?? fromContext;

  if (!taskRef) {
    const reply =
      'I understood that you want to assign a ticket, but I could not identify the ' +
      'ticket number. Please provide it in a format such as TSK-1059.';
    await record(ctx, { ...audit, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying);
  }

  const task = await prisma.task.findUnique({
    where:  { id: taskRef },
    select: {
      id: true, title: true, status: true, assignedToId: true, assignedById: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });

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

  if (!parsed.targetName) {
    const reply =
      `I understood that you want to reassign ${task.id}, but not who to. ` +
      `Reply with a name${scope.length ? ` — for example: ${namesOf(scope, 3)}` : ''}.`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying, task.id);
  }

  const resolution = resolveName(parsed.targetName, scope);

  if (resolution.status === 'not_found') {
    const reply = scope.length === 0
      ? `You don't have anyone reporting to you that I can assign ${task.id} to.`
      : `I couldn't find anyone called "${parsed.targetName}" in your team. ` +
        `You can assign ${task.id} to: ${namesOf(scope, 8)}.`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.rejected, errorReason: reply });
    return outcome(reply, CommandStatus.rejected, task.id);
  }

  if (resolution.status === 'ambiguous') {
    const options: ChoiceOption[] = resolution.candidates.map((c) => ({ id: c.user.id, name: c.user.name }));
    const pending: PendingChoice = {
      intent: 'reassign_ticket',
      taskId: task.id,
      reason: parsed.reason,
      confidence: parsed.confidence,
      rawText: ctx.text,
    };
    await setState(ctx.actor.id, 'choose_employee', pending, options);

    const reply =
      `I found ${options.length} people with similar names: ` +
      `${options.map((o, i) => `${i + 1}. ${o.name}`).join('  ')}\n` +
      `Please reply with the correct name or its number.`;
    await record(ctx, { ...audit, taskId: task.id, status: CommandStatus.clarifying, errorReason: reply });
    return outcome(reply, CommandStatus.clarifying, task.id);
  }

  const target = resolution.match!.user;

  // ── Act, or ask first ────────────────────────────────────────────────────
  //
  // Three ways to end up asking, and each maps to a clause in the spec:
  //   • the name wasn't exact          — a typo, resolved but not assumed
  //   • the parse wasn't confident     — the model was guessing
  //   • the ticket came from context   — the sender never actually said which
  //
  // Only an exact name, on a confidently-parsed command, naming its own ticket,
  // goes straight through.
  const certain =
    !resolution.requiresConfirmation &&
    parsed.confidence >= confidenceThreshold() &&
    fromContext === null;
  if (!certain) {
    return askToConfirm(ctx, {
      intent: 'reassign_ticket',
      taskId: task.id,
      newAssigneeId: target.id,
      newAssigneeName: target.name,
      previousAssigneeName: task.assignedTo.name,
      reason: parsed.reason,
      confidence: parsed.confidence,
      rawText: ctx.text,
    }, parsed);
  }

  return runReassign(ctx, {
    intent: 'reassign_ticket',
    taskId: task.id,
    newAssigneeId: target.id,
    newAssigneeName: target.name,
    previousAssigneeName: task.assignedTo.name,
    reason: parsed.reason,
    confidence: parsed.confidence,
    rawText: ctx.text,
  }, { confirmed: false, parsed });
}

async function askToConfirm(
  ctx: CommandContext,
  pending: PendingReassign,
  parsed: ParsedCommand | null,
): Promise<CommandOutcome> {
  await setState(ctx.actor.id, 'confirm', pending);

  const heard = ctx.transcription
    ? `I heard: "${ctx.transcription.slice(0, 120)}"\n\n`
    : '';

  const reply =
    `${heard}You are about to reassign ${pending.taskId} from ` +
    `${pending.previousAssigneeName} to ${pending.newAssigneeName}. ` +
    `Reply "Confirm" to continue, or "Cancel" to stop.`;

  await record(ctx, {
    intent: 'reassign_ticket',
    entities: parsed ?? pending,
    confidence: pending.confidence,
    taskId: pending.taskId,
    newAssigneeId: pending.newAssigneeId,
    status: CommandStatus.awaiting_confirmation,
  });

  return outcome(reply, CommandStatus.awaiting_confirmation, pending.taskId);
}

/**
 * Do it — by asking `taskService` to, which is the same call the web endpoint
 * makes. Every authorization check happens in there, on data read fresh from
 * the database, no matter how the command reached this point.
 */
async function runReassign(
  ctx: CommandContext,
  pending: PendingReassign,
  opts: { confirmed: boolean; parsed: ParsedCommand | null },
): Promise<CommandOutcome> {
  const before = await prisma.task.findUnique({
    where: { id: pending.taskId }, select: { assignedToId: true },
  });

  try {
    const task = await reassign(
      { id: ctx.actor.id, role: ctx.actor.role },
      pending.taskId,
      pending.newAssigneeId,
      { channel: ActionChannel.whatsapp, reason: pending.reason },
    );

    await record(ctx, {
      intent: 'reassign_ticket',
      entities: opts.parsed ?? pending,
      confidence: pending.confidence,
      taskId: task.id,
      previousAssigneeId: before?.assignedToId ?? null,
      newAssigneeId: pending.newAssigneeId,
      confirmed: opts.confirmed,
      status: CommandStatus.executed,
    });

    console.log(
      `[Command] ${ctx.actor.name} reassigned ${task.id} → ${task.assignedTo.name} via WhatsApp`,
    );

    return outcome(
      `✅ Ticket ${task.id} has been assigned to ${task.assignedTo.name} successfully.`,
      CommandStatus.executed,
      task.id,
    );
  } catch (err) {
    // A refusal from taskService is an answer, not a crash — the sender gets
    // the reason. Anything else is a bug and must not be echoed back verbatim.
    const isRefusal = err instanceof TaskOpError;
    const reply = isRefusal
      ? refusalMessage(err as TaskOpError, pending)
      : `Something went wrong reassigning ${pending.taskId}. Please try again, or use the dashboard.`;

    if (!isRefusal) console.error(`[Command] Unexpected failure on ${pending.taskId}:`, err);

    await record(ctx, {
      intent: 'reassign_ticket',
      entities: opts.parsed ?? pending,
      confidence: pending.confidence,
      taskId: pending.taskId,
      previousAssigneeId: before?.assignedToId ?? null,
      newAssigneeId: pending.newAssigneeId,
      confirmed: opts.confirmed,
      status: isRefusal ? CommandStatus.rejected : CommandStatus.failed,
      errorReason: (err as Error).message,
    });

    return outcome(reply, isRefusal ? CommandStatus.rejected : CommandStatus.failed, pending.taskId);
  }
}

function refusalMessage(err: TaskOpError, pending: PendingReassign): string {
  if (err.code === 'forbidden') {
    return err.message.includes('outside your permitted reporting structure')
      ? `You cannot assign ${pending.taskId} to ${pending.newAssigneeName} because they are ` +
        `outside your permitted reporting structure.`
      : `You do not have permission to reassign ${pending.taskId}.`;
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
 * stops a forgotten pending question from swallowing unrelated messages for
 * the rest of its lifetime.
 */
async function resolvePending(
  ctx: CommandContext,
  state: PendingState,
): Promise<CommandOutcome | null> {
  if (state.kind === 'confirm') {
    const pending = state.payload as PendingReassign;
    const answer  = readConfirmation(ctx.text);

    if (answer === 'yes') {
      await clearState(ctx.actor.id);
      return runReassign(ctx, pending, { confirmed: true, parsed: null });
    }

    if (answer === 'no') {
      await clearState(ctx.actor.id);
      const reply = `Cancelled — ${pending.taskId} has not been changed.`;
      await record(ctx, {
        intent: 'reassign_ticket', entities: pending, confidence: pending.confidence,
        taskId: pending.taskId, newAssigneeId: pending.newAssigneeId,
        status: CommandStatus.cancelled,
      });
      return outcome(reply, CommandStatus.cancelled, pending.taskId);
    }

    // Unclear. If it reads as a new command, let it replace this one.
    if (await parseCommand(ctx.text)) return null;

    return outcome(
      `I still need a yes or no: reply "Confirm" to reassign ${pending.taskId} to ` +
      `${pending.newAssigneeName}, or "Cancel" to stop.`,
      CommandStatus.awaiting_confirmation,
      pending.taskId,
    );
  }

  if (state.kind === 'choose_employee') {
    const pending = state.payload as PendingChoice;
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

    const task = await prisma.task.findUnique({
      where: { id: pending.taskId },
      select: { id: true, assignedTo: { select: { name: true } } },
    });
    if (!task) {
      await clearState(ctx.actor.id);
      return outcome(
        `I could not find ticket ${pending.taskId} any more. Please start again.`,
        CommandStatus.rejected,
        pending.taskId,
      );
    }

    // Disambiguation resolves the name; it does not authorise the change. The
    // sender still confirms, which is the flow the spec describes.
    return askToConfirm(ctx, {
      intent: 'reassign_ticket',
      taskId: pending.taskId,
      newAssigneeId: picked.id,
      newAssigneeName: picked.name,
      previousAssigneeName: task.assignedTo.name,
      reason: pending.reason,
      confidence: pending.confidence,
      rawText: pending.rawText,
    }, null);
  }

  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function namesOf(users: { name: string }[], limit: number): string {
  const shown = users.slice(0, limit).map((u) => u.name);
  const extra = users.length - shown.length;
  return shown.join(', ') + (extra > 0 ? `, and ${extra} more` : '');
}
