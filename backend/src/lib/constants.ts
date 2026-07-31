/**
 * Shared constants.
 *
 * `Activity.type` is a bare String column with no enum behind it, so every
 * value used to be a hand-typed literal spread across 13 write sites. One
 * typo silently created an activity type nothing reads. These constants are
 * the single definition.
 */

export const ACTIVITY_TYPE = {
  // Task lifecycle — written by taskController / escalationService
  CREATED:     'created',
  STATUS:      'status',
  APPROVAL:    'approval',
  REJECT:      'reject',
  ESCALATION:  'escalation',
  RETRACT:     'retract',
  REASSIGN:    'reassign',
  COMMENT:     'comment',
  /** A message was re-linked to a different task. Written on both tasks. */
  ATTRIBUTION: 'attribution',

  // Legacy WhatsApp types. Read-only now — WhatsApp lives in `Message`.
  // Kept so the backfill and any un-migrated rows still resolve.
  WHATSAPP:     'whatsapp',
  WHATSAPP_DUP: 'whatsapp_dup',
  VOICENOTE:    'voicenote',
  OUTBOUND:     'outbound',
} as const;

export type ActivityType = (typeof ACTIVITY_TYPE)[keyof typeof ACTIVITY_TYPE];

/** The four types the backfill migrates into `Message`. */
export const LEGACY_WA_TYPES: string[] = [
  ACTIVITY_TYPE.WHATSAPP,
  ACTIVITY_TYPE.WHATSAPP_DUP,
  ACTIVITY_TYPE.VOICENOTE,
  ACTIVITY_TYPE.OUTBOUND,
];

/**
 * Activity types that should raise a notification.
 *
 * `REASSIGN` and `CREATED` were missing, which meant being handed a task raised
 * nothing in the bell — the one event the new assignee most needs to see.
 * Notification scoping keys off `task.assignedToId`, so after a reassignment
 * the row is already visible to exactly the right person.
 */
export const NOTIFIABLE_ACTIVITY_TYPES: string[] = [
  ACTIVITY_TYPE.ESCALATION,
  ACTIVITY_TYPE.STATUS,
  ACTIVITY_TYPE.APPROVAL,
  ACTIVITY_TYPE.REASSIGN,
  ACTIVITY_TYPE.CREATED,
];

// ─── Time windows ─────────────────────────────────────────────────────────────

/** WhatsApp's free-form messaging window. One per phone number, not per task. */
export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How long a task stays "the one we're talking about". Within this window a
 * bare follow-up ("this one too", "also done") is attributed to the same task
 * as the previous message.
 */
export const CONTEXT_WINDOW_MS = 30 * 60 * 1000;

/**
 * How far back to look for an unattributed photo when a task is completed.
 * Covers the common flow: send the photo, then say "task 1060 done" a moment
 * later. Without this the photo would never count as evidence.
 */
export const EVIDENCE_ADOPT_MS = 10 * 60 * 1000;

/** Meta caps interactive lists at 10 rows across all sections. */
export const MAX_LIST_ROWS = 10;
