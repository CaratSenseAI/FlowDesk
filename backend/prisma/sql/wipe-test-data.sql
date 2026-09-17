-- One-off cleanup before the TDM client handover (Sept 2026).
-- Run in the Neon console → SQL Editor, against the production database.
-- Keeps only users U001 (TDM Admin) and U007 (Ashish). Deletes everything else.

-- STEP 1 — look before deleting. Run this block alone first.
SELECT 'Task' AS tbl, count(*) FROM "Task"
UNION ALL SELECT 'Activity', count(*) FROM "Activity"
UNION ALL SELECT 'TaskAssignee', count(*) FROM "TaskAssignee"
UNION ALL SELECT 'Message', count(*) FROM "Message"
UNION ALL SELECT 'WhatsAppCommand', count(*) FROM "WhatsAppCommand"
UNION ALL SELECT 'ConversationState', count(*) FROM "ConversationState"
UNION ALL SELECT 'Invoice', count(*) FROM "Invoice"
UNION ALL SELECT 'Contact', count(*) FROM "Contact"
UNION ALL SELECT 'User (to delete)', count(*) FROM "User" WHERE id NOT IN ('U001','U007');

SELECT id, name, role, phone, "reportingToId",
       CASE WHEN id IN ('U001','U007') THEN 'KEEP' ELSE 'DELETE' END AS action
FROM "User" ORDER BY id;

-- STEP 2 — the deletion. Run this whole block as one statement batch.
-- Everything is inside one transaction: it either completes fully or changes nothing.
BEGIN;

DELETE FROM "Message";
DELETE FROM "WhatsAppCommand";
DELETE FROM "ConversationState";
DELETE FROM "Activity";
DELETE FROM "TaskAssignee";
DELETE FROM "Task";
DELETE FROM "Invoice";
DELETE FROM "Contact";

-- Kept users whose manager is being removed now report to the admin.
UPDATE "User" SET "reportingToId" = 'U001'
WHERE id IN ('U001','U007')
  AND "reportingToId" IS NOT NULL
  AND "reportingToId" NOT IN ('U001','U007');

DELETE FROM "User" WHERE id NOT IN ('U001','U007');

COMMIT;

-- STEP 3 — verify. Expect 0 tasks, 0 messages, and exactly two users.
SELECT (SELECT count(*) FROM "Task") AS tasks,
       (SELECT count(*) FROM "Message") AS messages,
       (SELECT count(*) FROM "User") AS users;
SELECT id, name, role, phone FROM "User" ORDER BY id;
