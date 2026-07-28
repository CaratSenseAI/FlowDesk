-- ============================================================================
-- FlowDesk — "In Progress" task status + WhatsApp delivery/read receipts
--
-- Run AFTER 2026-07-28-add-message-model.sql, and before deploying the commit
-- that adds them. Two new values on each of two existing enums; no tables,
-- columns or rows change.
--
-- SAFE TO RE-RUN — every statement uses IF NOT EXISTS.
--
-- Not needed at all if the Render Build Command runs `prisma db push`, which
-- applies this automatically on deploy.
-- ============================================================================

-- ─── "In Progress" ──────────────────────────────────────────────────────────
-- Set when a worker messages something like "1054 in progress, will complete
-- soon". Placed after Pending so the enum reads in lifecycle order.
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'InProgress' AFTER 'Pending';

-- ─── "Submitted" ────────────────────────────────────────────────────────────
-- A worker reporting completion lands here, not in Done. Done now means a
-- reviewer approved it, so the board never claims work is finished on the
-- strength of a WhatsApp message alone.
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'Submitted' AFTER 'InProgress';


-- ─── Delivery receipts ──────────────────────────────────────────────────────
-- Driven by Meta's status webhook, mirroring WhatsApp's own ticks:
--   sent      → one grey tick
--   delivered → two grey ticks
--   read      → two blue ticks
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'delivered' AFTER 'sent';
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'read'      AFTER 'delivered';


-- ─── Verification ───────────────────────────────────────────────────────────
SELECT
  t.typname AS enum_name,
  string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS values
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('TaskStatus', 'DeliveryStatus')
GROUP BY t.typname;

-- Expect:
--   DeliveryStatus | pending, sent, delivered, read, failed
--   TaskStatus     | Pending, InProgress, Submitted, Done, Issue, Delay


-- ─── Optional: move already-"Done" WhatsApp submissions into review ─────────
-- Tasks marked Done by a worker before this change were never actually
-- approved by anyone. Uncomment to put them back in the approval queue where
-- they belong. Leave commented if you'd rather accept them as-is.
--
-- UPDATE "Task" SET status = 'Submitted'
-- WHERE status = 'Done' AND approved = false;
