# Configuration steps — assignment message content and task images

**What this is.** Both features are built, pushed to `main` (commit `2ba993b`) and the frontend is already live on Vercel. Nothing an employee receives changes until you do the steps below, in this order. Each step says where the fact comes from; nothing here is assumed.

| Step | Where | Time | Blocks |
|---|---|---|---|
| 1 | Render → Manual Deploy | 2 min + build | everything |
| 2 | Meta WhatsApp Manager (account **TDM Fabrics**) → create 6 templates | 30 min | step 4 |
| 3 | Wait for Meta approval | minutes to 24 h | step 4 |
| 4 | Render → set `WA_RICH_TEMPLATES_APPROVED=true` → deploy | 2 min | rich messages |
| 5 | Test on WhatsApp | 10 min | — |
| 6 | (once) Render ↔ GitHub reconnect so deploys become automatic | 5 min | convenience |

---

## Step 1 — Deploy the backend on Render (do this first)

The frontend on Vercel already has the image picker. Until the backend is deployed, attaching a file to a task shows "Upload failed" because `/api/uploads` does not exist yet. Text tasks are unaffected.

1. Log in at https://dashboard.render.com with `tdm@caratsense.in`.
2. Open service **tdm-flowdesk-prod** → **Deploys** tab.
3. Open the **Manual Deploy** dropdown → **Deploy latest commit**. The deploy should reference commit `2ba993b`.
4. Wait for status **Live**. Confirm with:
   `https://tdm-flowdesk-prod.onrender.com/api/health` → `"commit":"2ba993b"`.

The build runs `prisma db push`, which adds the two new task columns (`attachmentUrl`, `attachmentKind`) automatically.

> Render docs: the Manual Deploy dropdown offers "Deploy latest commit", "Deploy a specific commit", "Clear build cache & deploy" and "Restart service". Source: https://render.com/docs/deploys

---

## Step 2 — Create six templates in Meta WhatsApp Manager

**Where.** Meta Business Suite → **WhatsApp Manager → Message templates**. In the account selector at the top right choose **TDM Fabrics** (ID `1061511566555814`). That is the account holding the production number +91 87967 99970; the others ("TDM Fabrics Bot", "TDM Fabrics Listing", "Test WhatsApp Business Account") are not used by FlowDesk. The list currently shows 23 templates; the ones FlowDesk sends today are there, e.g. `task_assignment_en`, `task_assignment_hi`, `task_escalation_en`.

**Naming — this matters.** Every template on this account is one language, and the language is part of the name: `task_assignment_en` and `task_assignment_hi` are two separate templates. The code builds the name the same way (`<base>_<lang>`), so create **six** templates with these exact names:

| # | Template name | Language to pick | Header | Category |
|---|---|---|---|---|
| 1 | `task_assignment_full_en` | English | Text: `TASK ALLOTTED!` | Utility |
| 2 | `task_assignment_full_hi` | Hindi | Text: `नया काम!` | Utility |
| 3 | `task_assignment_image_en` | English | **Media → Image** | Utility |
| 4 | `task_assignment_image_hi` | Hindi | **Media → Image** | Utility |
| 5 | `task_reassigned_full_en` | English | Text: `TASK REASSIGNED` | Utility |
| 6 | `task_reassigned_full_hi` | Hindi | Text: `काम बदला गया` | Utility |

Pick **English**, not "English (US)" — only `hello_world` uses English (US); all FlowDesk templates use plain English, which the code sends as language code `en`.

Rules from Meta's documentation that apply to all six:

- Names: "lowercase alphanumeric characters and underscores". Sources: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
- Every variable needs a sample value: "you must include an example value for each parameter."
- Positional variables "starting from 1", in order, none skipped.
- A media header needs a sample file at submission: "The example asset will be reviewed as part of template review."
- Review: "Review can take up to 24 hours."
- Widely reported rejection causes (BSP guides, not stated on Meta's page): a body that starts or ends with a variable, and two variables side by side. The bodies below avoid both. Sources: https://m.aisensy.com/blog/whatsapp-template-approval-process/ , https://help.spurnow.com/en/articles/11999432-whatsapp-template-rejected-common-reasons-and-how-to-fix

Buttons — identical on all six, and the labels must be **exactly** these because the code matches the tapped label text (they are the same three the current `task_assignment_en` has):
- Quick reply: `Started/ In Progress`
- Quick reply: `Done`
- Visit website: label `Visit website`, URL `https://tdm-flowdesk.vercel.app`

Footer (optional, matches today's message): `Via FlowDesk`

### Templates 1 and 3 — `task_assignment_full_en` and `task_assignment_image_en`

Same body, same samples, same buttons. Template 3 additionally has **Header: Media → Image** with any JPEG/PNG uploaded as the sample (a screenshot of a task is fine). Template 1 has **Header: Text** `TASK ALLOTTED!`.

Body:
```
Hi {{1}}, a new task {{2}} has been assigned to you on FlowDesk.

Task: {{3}}
Deadline: {{4}}
Details: {{5}}

Reply here to update its status.
```
Sample values: `{{1}}` Anshul Raibole · `{{2}}` TSK-12 · `{{3}}` Godown stock check · `{{4}}` 20 Sept, 5:00 pm · `{{5}}` Count all rolls in rack B

### Templates 2 and 4 — `task_assignment_full_hi` and `task_assignment_image_hi`

Language **Hindi**. Template 2: Header Text `नया काम!`. Template 4: Header Media → Image with a sample file.

Body:
```
नमस्ते {{1}}, FlowDesk पर आपको नया काम {{2}} दिया गया है।

काम: {{3}}
अंतिम तिथि: {{4}}
विवरण: {{5}}

अपडेट के लिए यहाँ जवाब दें।
```
Sample values: अंशुल रायबोले · TSK-12 · गोदाम स्टॉक जांच · 20 सितंबर, शाम 5:00 · रैक B के सभी रोल गिनें

### Template 5 — `task_reassigned_full_en`

Language English. Header Text `TASK REASSIGNED`.
```
Hi {{1}}, {{2}} has moved task {{3}} to you.

Task: {{4}}
Deadline: {{5}}

Reply here to update its status.
```
Sample values: Anshul Raibole · Aditya Shelke · TSK-12 · Godown stock check · 20 Sept, 5:00 pm

### Template 6 — `task_reassigned_full_hi`

Language Hindi. Header Text `काम बदला गया`.
```
नमस्ते {{1}}, {{2}} ने काम {{3}} आपको सौंपा है।

काम: {{4}}
अंतिम तिथि: {{5}}

अपडेट के लिए यहाँ जवाब दें।
```
Sample values: अंशुल रायबोले · आदित्य शेल्के · TSK-12 · गोदाम स्टॉक जांच · 20 सितंबर, शाम 5:00

**About the image header at runtime.** In templates 3 and 4 the picture Meta shows is the one attached to the task, sent as a public Cloudinary link. Meta's Cloud API takes an image header as `{"type":"header","parameters":[{"type":"image","image":{"link":"<public url>"}}]}`; the link must be direct and publicly reachable. Sources: https://learn.microsoft.com/en-us/azure/communication-services/concepts/advanced-messaging/whatsapp/template-messages , https://docs.messangi.com/docs/creating-sending-whatsapp-media-message-template . Image limits, enforced by Meta and by the upload endpoint: JPEG or PNG, **5 MB**. Source: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media

---

## Step 3 — Wait for approval

- The **Status** column in WhatsApp Manager is what to watch. On this account an approved, sendable template shows **"Active – Quality pending"** (every existing FlowDesk template shows exactly that; the quality part changes to High/Medium/Low as messages are delivered). A template under review shows **"In review"** or **"Pending"**; a refused one shows **"Rejected"**. Meta: In-Review means "the template is still under review. Review can take up to 24 hours"; Rejected means it "violates one or more policies". Source: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
- Provider experience: utility templates often clear in minutes, occasionally up to 24 h. Source: https://www.twilio.com/docs/whatsapp/tutorial/message-template-approvals-statuses
- All **six** must show **Active** before Step 4. The code falls back to the `_en` template for any employee whose language has no approved template, so if a `_hi` one is rejected, fix and resubmit it; do not switch the flag on with an `_en` one missing.
- If Meta files one as **Marketing** instead of Utility (as happened to `sales_order_placed`), it still sends but costs more per message; appeal from the template's page. The bodies above describe a triggered work event, which is Utility.
- Do **not** delete or edit the existing `task_assignment_en/hi` and `task_reassigned_en/hi`. They keep sending until the flag in Step 4 is on, and remain the fallback if it is ever turned off.

---

## Step 4 — Switch the rich messages on in Render

Do this only after all six templates show **Active** in Step 3.

1. Render → **tdm-flowdesk-prod** → **Environment** (left pane).
2. Under **Environment Variables**, click **+ Add Environment Variable**.
3. Key `WA_RICH_TEMPLATES_APPROVED`, value `true`.
4. Save. Render shows a dropdown: choose **"Save and deploy"** (redeploys the existing build with the new variable). "Save only" would store it without the service using it.
   Source: https://render.com/docs/configure-environment-variables — "Save, rebuild, and deploy", "Save and deploy", "Save only".
5. After the deploy is Live, Render logs at startup will show the templates in use.

Until this flag is `true`, employees receive the same two-slot message as before, and images attached on the dashboard are delivered only to people who replied in the last 24 hours (see Step 5).

To turn the rich messages off again at any time, set the value to `false` and "Save and deploy".

---

## Step 5 — Test on WhatsApp

Meta's rule that shapes the results: "When a WhatsApp user messages you… a 24-hour timer called a customer service window starts… While the window is open, you can send any of the service message types… When the window closes, you can only send pre-approved template messages." Source: https://developers.facebook.com/docs/whatsapp/conversation-types

| Test | Expected on the employee's phone |
|---|---|
| A. Employee who has **not** replied in 24 h; create a task on the dashboard **without** an image | `task_assignment_full_en` (or `_hi` per the employee's language): name, task id, title, deadline, details, three buttons |
| B. Same employee; create a task **with** an image | `task_assignment_image_en`/`_hi`: the picture on top, same text below |
| C. Employee replies anything (window now open); create a task **with** an image | A plain photo with the full message as its caption |
| D. Employee with open window; create a task **without** an image | Free text: title, deadline, details |
| E. Reassign a task to an employee with a closed window | `task_reassigned_full_en`/`_hi` |
| F. From WhatsApp, send a photo with "Anshul ko bhejo, kal tak theek karo" while Anshul's window is closed | Anshul gets `task_assignment_image_en`/`_hi` with that photo (previously the file was only saved) |

Every send is recorded in the dashboard **Tracker** tab with delivery status and Meta's error text if it failed. If a template is not approved yet and the flag is on, Meta's error there reads like "Template name does not exist in the translation" — turn the flag off until approval completes.

---

## Step 6 — One-time: make Render deploy automatically again

Render's build log shows "It looks like we don't have access to your repo". Deploys have been manual since. Per Render's docs, deploys are automatic once the Render GitHub App can see the repository: "Whenever you push or merge a change to that branch, by default Render automatically rebuilds and redeploys your service."

1. As a **CaratSenseAI GitHub org admin** (Kashyap0319, kumargauravcs, tiwarygaurav or vkcsai), open https://github.com/apps/render/installations/new, choose the CaratSenseAI organisation, and under **Repository access** make sure `CaratSenseAI/FlowDesk` is included. Save.
2. In Render → **tdm-flowdesk-prod** → **Settings**, check the connected repository shows `CaratSenseAI/FlowDesk`, branch `main`, and **Auto-Deploy** is on.
3. Push any small change, or use Manual Deploy once more, and confirm the next push deploys on its own.

Sources: https://render.com/docs/github , https://render.com/docs/deploys

---

## Nothing else to configure

- **Cloudinary**: uploads go to the existing account under folder `flowdesk/task-images`; verified end to end on 21 Sept with the production credentials. No setting to change.
- **Vercel**: the frontend with the picker is already live (bundle `index-D7cuFgDJ.js`); Vercel deploys from `main` automatically.
- **Neon**: columns are added by the Render build.

---

## What was built (for reference)

- `POST /api/uploads` — one file, JPEG/PNG/PDF, 5 MB, Admin/Manager only, stored on Cloudinary. Tested: valid PNG → 201 with URL; wrong type → 400; 6 MB → 400; no token → 401.
- Task fields `attachmentUrl`, `attachmentKind`; accepted on create and edit; only URLs from our own Cloudinary account are accepted.
- Assignment and reassignment messages carry title, deadline (Indian time) and details on both the free-form and template paths; image as caption (window open) or header (window closed, flag on).
- WhatsApp photo forwarding uses the image template when the recipient's window is closed (flag on).
- New Task form: picker, preview, checks, upload before create; attachment shown on the task and flagged in the list.
- Tests: 542 backend unit tests, 50 frontend, all passing.
