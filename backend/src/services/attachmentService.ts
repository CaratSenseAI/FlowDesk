import { MessageKind } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { extractTaskRef } from './intentService';

// ─────────────────────────────────────────────────────────────────────────────
// Photographs and documents as instructions.
//
// A manager sends a picture of a damaged product captioned "Vedant, inspect
// this and update me". That is a task — but it looks nothing like one to the
// command parser, which is built around verbs like "assign" and "create". So
// media messages get their own small vocabulary, checked only when there is an
// attachment in play.
//
// The governing rule is the spec's: a pronoun ("this", "that image") may be
// resolved from recent conversation ONLY when exactly one recent attachment
// could be meant. Two candidates is a question, not a coin toss — forwarding
// the wrong photograph to the wrong person is not recoverable.
// ─────────────────────────────────────────────────────────────────────────────

export type AttachmentIntent =
  /** Put the file on an existing ticket. */
  | 'attach_to_task'
  /** Send the file to somebody, explicitly WITHOUT creating a task. */
  | 'forward_only'
  /** Make a new task out of the file and its caption. */
  | 'create_from_media';

export interface ParsedAttachment {
  intent: AttachmentIntent;
  taskRef: string | null;
  /** Names the sender mentioned, as written. */
  targetNames: string[];
  /** The caption minus the addressing, used as the task title. */
  title: string | null;
  /** True when the sender said in so many words not to create a task. */
  noTask: boolean;
  /** True when the file is referred to rather than included ("send THIS"). */
  refersToEarlier: boolean;
}

const SEND_VERB    = /\b(?:send|share|forward|pass\s+on|bhej\s*(?:do|dena)?|भेज)\b/i;
const ATTACH_VERB  = /\b(?:add|attach|put|append|include)\b/i;
const NO_TASK      = /\b(?:don'?t|do\s+not|no\s+need\s+to|dont)\s+(?:create|make|open|raise)\b|\bjust\s+(?:send|share|forward)\b|\bwithout\s+(?:creating|making)\s+a?\s*task\b/i;

/** "this", "that image", "the photo" — a file referred to, not included. */
const REFERS_EARLIER = /\b(?:this|that|the)\s*(?:image|photo|picture|pic|file|document|doc|pdf|attachment)?\b/i;

/** Who it is for. Media captions address people directly — "Vedant, inspect this". */
const ADDRESSED_NAME = /^([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*)?)\s*[,:—-]/;
const NAME_AFTER_TO  = /\b(?:to|for)\s+([A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,2})/i;

const STOP = new Set([
  'this', 'that', 'the', 'it', 'please', 'pls', 'and', 'also', 'a', 'an',
  'image', 'photo', 'picture', 'file', 'document', 'send', 'share', 'add',
  // "add this TO TASK 1060 and send it to Vikranth" — the first "to" points at
  // the ticket, not a person, and reading it as a name lost the real one.
  'task', 'ticket', 'tsk', 'job', 'attach', 'put', 'me', 'him', 'her', 'them',
]);

function cleanName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const words: string[] = [];
  for (const w of raw.trim().split(/\s+/)) {
    const bare = w.replace(/[^A-Za-z'’\-]/g, '');
    if (!bare) { if (words.length) break; else continue; }
    if (STOP.has(bare.toLowerCase())) { if (words.length) break; else continue; }
    words.push(bare);
  }
  return words.length ? words.join(' ') : null;
}

/**
 * Read a media caption, or a message referring to a file sent moments ago.
 *
 * `hasMedia` matters: "send this to Vedant" with a photograph attached is the
 * photograph, while the same words on their own are a reference to something
 * earlier in the conversation and have to be resolved before anything is sent.
 */
export function parseAttachment(text: string, hasMedia: boolean): ParsedAttachment | null {
  const trimmed = (text ?? '').trim();

  const taskRef = extractTaskRef(trimmed);
  const wantsSend   = SEND_VERB.test(trimmed);
  const wantsAttach = ATTACH_VERB.test(trimmed) && taskRef !== null;

  // Nothing here is about a file.
  if (!hasMedia && !(wantsSend && REFERS_EARLIER.test(trimmed))) return null;

  const names: string[] = [];
  const addressed = cleanName(trimmed.match(ADDRESSED_NAME)?.[1]);
  if (addressed) names.push(addressed);
  // Every "to X" / "for X", not just the first: "add this to task 1060 and send
  // it to Vikranth" has two, and only the second is a person.
  for (const m of trimmed.matchAll(new RegExp(NAME_AFTER_TO.source, 'gi'))) {
    const after = cleanName(m[1]);
    if (after && !names.some((n) => n.toLowerCase() === after.toLowerCase())) names.push(after);
  }

  const noTask = NO_TASK.test(trimmed);

  const intent: AttachmentIntent =
    wantsAttach                      ? 'attach_to_task'
    : noTask && names.length > 0     ? 'forward_only'
    : hasMedia || names.length > 0   ? 'create_from_media'
    : 'forward_only';

  // The caption minus the addressing becomes the task title.
  const title = trimmed
    .replace(ADDRESSED_NAME, '')
    .replace(NAME_AFTER_TO, '')
    .replace(/\b(?:send|share|forward|add|attach|put)\b/gi, '')
    .replace(/\b(?:this|that|it)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[,:\-—\s]+|[,.\s]+$/g, '');

  return {
    intent,
    taskRef,
    targetNames: names,
    title: title.length >= 3 ? title : null,
    noTask,
    refersToEarlier: !hasMedia,
  };
}

// ─── Resolving "this" and "that image" ────────────────────────────────────────

/** How far back a bare "send this" may reach. */
export function attachmentWindowMs(): number {
  const s = parseInt(process.env.WA_ATTACHMENT_WINDOW_S ?? '900', 10);
  return (Number.isFinite(s) && s > 0 ? s : 900) * 1000;
}

export interface RecentAttachment {
  id: string;
  mediaUrl: string;
  kind: MessageKind;
  text: string;
  createdAt: Date;
}

/**
 * Files this person sent us recently, newest first.
 *
 * Scoped to messages the REQUESTER themselves sent. Somebody must not be able
 * to forward a photograph out of a conversation they only had sight of — the
 * spec is explicit that only attachments the user sent, or is authorised to
 * share, may be used.
 */
export async function recentAttachments(userId: string): Promise<RecentAttachment[]> {
  const rows = await prisma.message.findMany({
    where: {
      userId,
      senderId: userId,
      direction: 'inbound',
      mediaUrl: { not: null },
      kind: { in: [MessageKind.image, MessageKind.document, MessageKind.video] },
      createdAt: { gt: new Date(Date.now() - attachmentWindowMs()) },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true, mediaUrl: true, kind: true, text: true, createdAt: true },
  });

  return rows.map((r) => ({
    id: r.id, mediaUrl: r.mediaUrl!, kind: r.kind, text: r.text, createdAt: r.createdAt,
  }));
}

/** A short human label for an attachment, used when asking which one. */
export function describeAttachment(a: RecentAttachment, now: Date = new Date()): string {
  const mins = Math.max(1, Math.round((now.getTime() - a.createdAt.getTime()) / 60_000));
  const what = a.kind === MessageKind.document ? 'Document' : a.kind === MessageKind.video ? 'Video' : 'Image';
  const cap  = a.text?.trim() ? ` — "${a.text.trim().slice(0, 40)}"` : '';
  return `${what} sent ${mins} min ago${cap}`;
}
