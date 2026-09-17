# Assignment message must say what the task is

**Request (Ashish, 17 Sept 2026):** the WhatsApp message an employee receives when a task is assigned should describe the task, not just say "a new task TSK-2 has been assigned to you".

**Verdict:** the code already knows the title, deadline and description. The approved Meta template has no slots for them. Fix = one new template with five slots (Meta side, you) + passing the values in (code side, me, ~30 minutes).

---

## 1. Why the message is empty today

There are two ways an assignment reaches an employee:

| Situation | What is sent | Contains the task? |
|---|---|---|
| Employee messaged FlowDesk in the last 24 h | Free-form text built in `notifyService.ts` | Title yes, deadline no, description no |
| Anyone else (new employee, or quiet > 24 h) | Approved template `task_assignment` | **No** — its body has only `{{1}}` name and `{{2}}` task id |

WhatsApp only delivers approved templates outside the 24-hour window, and a template can only show what its body has slots for. The current body is:

> Hi {{1}}, a new task {{2}} has been assigned to you on FlowDesk. Please complete it before the deadline and reply here to update its status.

Nothing in the code can add the title to that message. A new template body is required.

---

## 2. Steps for Aditya — create the new template in Meta

Create a **new** template instead of editing `task_assignment`. Editing puts the existing one back into review and can interrupt sending; a new name keeps today's message working until the new one is approved.

### 2.1 English

1. **Meta Business Suite** (login in `CLAUDE.md`) → **WhatsApp Manager** → **Message templates** (TDM WhatsApp Business Account) → **Create template**.
2. **Category:** Utility · **Name:** `task_assignment_full` (exactly) · **Language:** English.
3. **Header:** none.
4. **Body** — paste exactly, five variables in this order:

   ```
   TASK ALLOTTED!

   Hi {{1}}, a new task {{2}} has been assigned to you on FlowDesk.

   Task: {{3}}
   Deadline: {{4}}
   Details: {{5}}

   Reply here to update its status.
   ```

   | Slot | Meaning | Sample value to enter |
   |---|---|---|
   | `{{1}}` | assignee's name | Anshul Raibole |
   | `{{2}}` | task id | TSK-12 |
   | `{{3}}` | task title | Godown stock check |
   | `{{4}}` | deadline, Indian time | 20 Sept, 5:00 PM |
   | `{{5}}` | description, or "none" | Count all rolls in rack B |

5. **Footer:** `Via FlowDesk` (optional, matches today's message).
6. **Buttons** — same as the current template, labels **identical**, because `contactReplyService` matches the tapped label text:
   - Quick reply: `Started/ In Progress`
   - Quick reply: `Done`
   - Visit website: `Visit website` → `https://tdm-flowdesk.vercel.app`
7. **Submit.**

### 2.2 Hindi

Repeat 2.1 with **Language: Hindi**, same name, same buttons, this body:

```
नया काम!

नमस्ते {{1}}, FlowDesk पर आपको नया काम {{2}} दिया गया है।

काम: {{3}}
अंतिम तिथि: {{4}}
विवरण: {{5}}

अपडेट के लिए यहाँ जवाब दें।
```

Samples: अंशुल रायबोले · TSK-12 · गोदाम स्टॉक जांच · 20 सितंबर, शाम 5 बजे · रैक B के सभी रोल गिनें

### 2.3 Optional: the reassignment message too

`task_reassigned` has the same gap ("{{2}} moved {{3}} to you"). If Ashish wants that one to name the work as well, create `task_reassigned_full` (en + hi):

```
TASK REASSIGNED

Hi {{1}}, {{2}} has moved task {{3}} to you.

Task: {{4}}
Deadline: {{5}}

Reply here to update its status.
```

Slots: new assignee · who moved it · task id · title · deadline.

### 2.4 Approval

- Status shows under Message templates. Usually minutes, occasionally up to a day.
- Common rejection reasons, all avoided above: a variable as the very first or last thing in the body; two variables side by side; missing sample values.
- When both languages show **Approved**, tell me. Until then the code keeps using `task_assignment`.

### 2.5 Nothing else

No Render, Vercel, Cloudinary or environment changes. The backend needs one **Manual Deploy** on Render after the code lands (auto-deploy is still broken — see `CLAUDE.md`).

---

## 3. Code implementation (Claude)

### 3.1 `whatsappService.ts`

- Add `TEMPLATE.ASSIGNMENT_FULL = 'task_assignment_full'` (and `REASSIGNED_FULL` if 2.3 is done).
- New `sendTaskAssignmentNotificationFull(to, assigneeName, taskId, title, deadlineText, details, lang)` calling `sendWhatsAppLocalized(to, name, [assigneeName, taskId, title, deadlineText, details], langCode)`.
- `sanitiseParam` already collapses whitespace and cuts at 300 characters, which keeps the body under Meta's 1024-character cap. A description longer than that arrives truncated with "…".
- Empty description → pass `'none'` / `'कोई नहीं'`; Meta rejects an empty parameter.
- Deadline formatted in `Asia/Kolkata`: `20 Sept, 5:00 PM` (English) / `20 सितंबर, शाम 5:00` (Hindi) — reuse `queryService.shortDate` and add a time variant.

### 3.2 `notifyService.ts`

- Extend `NotifyParams.task` to `{ id, title, description, deadline }`.
- Template path: call the `Full` sender.
- Free-form path (window open): add the deadline and description lines so both paths read the same:

  ```
  📋 New task assigned: TSK-12
  *Godown stock check*
  Deadline: 20 Sept, 5:00 PM
  Details: Count all rolls in rack B

  Reply "done", "issue <reason>" or "delay <reason>" to update it.
  ```

### 3.3 Callers

`taskService.create`, `reassign`, `duplicate`, and `commandExecutor` (`startCreate`, `startReassign`, outreach task creation) already pass `task: { id, title }`; add `description` and `deadline` at each call site. The `select` lists there already load both columns.

### 3.4 Docs and tests

- `WHATSAPP_TEMPLATES.md`: new rows for `task_assignment_full` (and `task_reassigned_full`), slots in order; mark `task_assignment` as retired.
- Unit tests in `tests/unit/whatsappService.test.ts`: parameter order, `'none'` for an empty description, 300-character truncation, deadline formatting in IST.
- Integration test: creating a task for a user with no open window records a `Message` with the new template name.

### 3.5 Rollout

1. Templates submitted (you) → 2. code on `main` (me) → 3. templates approved (Meta) → 4. Manual Deploy on Render (you) → 5. test: create a task for Anshul while he has not replied in 24 h; he should receive the full message with title, deadline and details.

---

## 4. What to tell Ashish

- The message will show the task name, deadline and details.
- Each field is limited to about 300 characters and shows as one paragraph — the full task is always on the dashboard link under the message.
- Same three buttons as now.
- If he also wants an **image** in the message, that is the separate template in `docs/TASK_IMAGE_ATTACHMENTS.md`; create it with these same five slots plus the image header, and both requests ship together.
