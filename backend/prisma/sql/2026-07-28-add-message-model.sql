-- ============================================================================
-- FlowDesk — add the Message model (one WhatsApp conversation per person)
--
-- Run this in the Neon SQL editor against the database that tdm-flowdesk-prod
-- uses, BEFORE deploying commit 6e140fc. The new backend queries "Message" on
-- the tracker, notifications and webhook paths, so without this table those
-- endpoints return 500 and the Tracker renders empty.
--
-- SAFE TO RE-RUN. Every statement is guarded, so running it twice does
-- nothing the second time.
--
-- SAFE FOR EXISTING DATA. It only creates new types, one new table, indexes
-- and foreign keys. It does not drop, alter or delete anything that already
-- exists — "User", "Task" and "Activity" rows are untouched.
--
-- Part 1 creates the schema. Part 2 copies existing WhatsApp history into it.
-- ============================================================================


-- ─── Part 1: schema ─────────────────────────────────────────────────────────

-- Postgres has no CREATE TYPE IF NOT EXISTS, hence the exception guards.
DO $$ BEGIN
  CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MessageKind" AS ENUM ('text', 'image', 'document', 'video', 'voice', 'interactive', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AttributionSource" AS ENUM ('explicit_ref', 'list_reply', 'single_open_task', 'recent_context', 'manual', 'none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


CREATE TABLE IF NOT EXISTS "Message" (
    "id"               TEXT NOT NULL,
    -- Conversation owner: whoever owns the phone number this thread belongs to.
    "userId"           TEXT NOT NULL,
    -- Who actually wrote it. Inbound: same as userId. Outbound: the manager.
    "senderId"         TEXT NOT NULL,
    "direction"        "MessageDirection" NOT NULL,
    "kind"             "MessageKind" NOT NULL DEFAULT 'text',
    -- Nullable on purpose: an unroutable message stays unattributed rather
    -- than being guessed onto the wrong task.
    "taskId"           TEXT,
    "attributedBy"     "AttributionSource" NOT NULL DEFAULT 'none',
    "needsAttribution" BOOLEAN NOT NULL DEFAULT false,
    "intentAction"     TEXT,
    "intentConfidence" TEXT,
    "text"             TEXT NOT NULL DEFAULT '',
    "mediaUrl"         TEXT,
    "transcription"    TEXT,
    -- Meta's wamid. Unique, so a retried webhook delivery is a no-op.
    "waMessageId"      TEXT,
    "deliveryStatus"   "DeliveryStatus" NOT NULL DEFAULT 'sent',
    "deliveryError"    TEXT,
    -- Set only by the backfill below, so re-running it inserts nothing.
    "legacyActivityId" TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Message_waMessageId_key"      ON "Message"("waMessageId");
CREATE UNIQUE INDEX IF NOT EXISTS "Message_legacyActivityId_key" ON "Message"("legacyActivityId");

CREATE INDEX IF NOT EXISTS "Message_userId_createdAt_idx"           ON "Message"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_userId_direction_createdAt_idx" ON "Message"("userId", "direction", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_taskId_createdAt_idx"           ON "Message"("taskId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_userId_needsAttribution_idx"    ON "Message"("userId", "needsAttribution");

-- The schema had no indexes at all before this; these two serve the task
-- activity feed and the notification/escalation queries.
CREATE INDEX IF NOT EXISTS "Activity_taskId_createdAt_idx" ON "Activity"("taskId", "createdAt");
CREATE INDEX IF NOT EXISTS "Activity_type_createdAt_idx"   ON "Activity"("type", "createdAt");


-- Deleting a user removes their conversation; deleting a task must NOT delete
-- the messages that mentioned it, so taskId is SET NULL rather than CASCADE.
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─── Part 2: backfill existing WhatsApp history ─────────────────────────────
--
-- Copies the four legacy WhatsApp activity types into "Message" so past
-- conversations appear in the new Tracker. Task audit rows (created, status,
-- escalation, …) are deliberately left alone — they stay in "Activity".
--
-- The legacy "Activity" rows are NOT deleted. They are the rollback path.
--
-- ON CONFLICT makes this idempotent: without it, running this twice would
-- silently double every message in every conversation.

INSERT INTO "Message" (
  "id", "userId", "senderId", "direction", "kind", "taskId", "attributedBy",
  "needsAttribution", "text", "mediaUrl", "transcription",
  "deliveryStatus", "legacyActivityId", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  -- Owner is the assignee for BOTH directions: a manager's reply belongs in
  -- the employee's conversation, not the manager's.
  t."assignedToId",
  -- Sender preserves who actually wrote it.
  a."byId",
  CASE WHEN a."type" IN ('whatsapp', 'whatsapp_dup', 'voicenote')
       THEN 'inbound' ELSE 'outbound' END::"MessageDirection",
  -- Legacy rows never recorded a media type, only a URL. 'image' is the
  -- overwhelmingly common case and the UI degrades gracefully otherwise.
  CASE WHEN a."type" = 'voicenote'     THEN 'voice'
       WHEN a."mediaUrl" IS NOT NULL   THEN 'image'
       ELSE 'text' END::"MessageKind",
  a."taskId",
  -- "manual" is the honest default: these rows predate attribution tracking,
  -- so we genuinely don't know how they were routed.
  'manual'::"AttributionSource",
  false,
  a."text",
  a."mediaUrl",
  a."transcription",
  'sent'::"DeliveryStatus",
  a."id",
  a."createdAt"
FROM "Activity" a
JOIN "Task" t ON t."id" = a."taskId"
WHERE a."type" IN ('whatsapp', 'whatsapp_dup', 'voicenote', 'outbound')
ON CONFLICT ("legacyActivityId") DO NOTHING;


-- ─── Verification ───────────────────────────────────────────────────────────
-- Expect: migrated = source, and the User/Task/Activity counts unchanged.

SELECT
  (SELECT COUNT(*) FROM "Message")                                          AS messages_migrated,
  (SELECT COUNT(*) FROM "Activity"
     WHERE "type" IN ('whatsapp','whatsapp_dup','voicenote','outbound'))    AS source_activities,
  (SELECT COUNT(*) FROM "Message" WHERE "direction" = 'inbound')            AS inbound,
  (SELECT COUNT(*) FROM "Message" WHERE "direction" = 'outbound')           AS outbound,
  (SELECT COUNT(*) FROM "User")                                             AS users_unchanged,
  (SELECT COUNT(*) FROM "Task")                                             AS tasks_unchanged,
  (SELECT COUNT(*) FROM "Activity")                                         AS activities_unchanged;
