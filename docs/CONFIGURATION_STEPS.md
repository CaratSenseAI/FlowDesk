# Configuration steps — assignment message content and task images

**What this is.** Both features are built, pushed to `main` (commit `2ba993b`) and the frontend is already live on Vercel. Nothing an employee receives changes until you do the steps below, in this order. Each step says where the fact comes from; nothing here is assumed.

| Step | Where | Time | Blocks |
|---|---|---|---|
| 1 | Render → Manual Deploy | 2 min + build | everything |
| 2 | Meta WhatsApp Manager → create 3 templates (en + hi) | 30 min | step 4 |
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

## Step 2 — Create the three templates in Meta WhatsApp Manager

Login: Meta Business Suite with the Meta credentials in `CLAUDE.md`. Then **WhatsApp Manager → Message templates** (TDM WhatsApp Business Account) → **Create template**.

Rules that apply to all three (Meta's own documentation):

- Template names: "lowercase alphanumeric characters and underscores". Use the exact names below; the code sends by name.
- Every variable needs a sample value: "you must include an example value for each parameter".
- Positional variables: "ordered array index numbers, starting from 1" — `{{1}}`, `{{2}}` … in order, none skipped.
- A media header requires a sample file: "The example asset will be reviewed as part of template review." In WhatsApp Manager this is the image you upload under the Header section.
- Review: "Review can take up to 24 hours."
  Sources: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates and https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
- Widely reported rejection causes (BSP guides, not on Meta's page): a body that starts or ends with a variable, and two variables side by side. The bodies below avoid both. Sources: https://m.aisensy.com/blog/whatsapp-template-approval-process/ , https://help.spurnow.com/en/articles/11999432-whatsapp-template-rejected-common-reasons-and-how-to-fix

Create each template **twice**, once with Language **English** and once with **Hindi**, same name, same category, same buttons.

### 2a — `task_assignment_full` (Category: Utility, Header: none)

English body:
```
TASK ALLOTTED!

Hi {{1}}, a new task {{2}} has been assigned to you on FlowDesk.

Task: {{3}}
Deadline: {{4}}
Details: {{5}}

Reply here to update its status.
```
Hindi body:
```
नया काम!

नमस्ते {{1}}, FlowDesk पर आपको नया काम {{2}} दिया गया है।

काम: {{3}}
अंतिम तिथि: {{4}}
विवरण: {{5}}

अपडेट के लिए यहाँ जवाब दें।
```
Sample values (enter when asked): `Anshul Raibole` · `TSK-12` · `Godown stock check` · `20 Sept, 5:00 pm` · `Count all rolls in rack B`

Footer (optional): `Via FlowDesk`

Buttons — labels must be **exactly** these, because the code matches the tapped label:
- Quick reply: `Started/ In Progress`
- Quick reply: `Done`
- Visit website: label `Visit website`, URL `https://tdm-flowdesk.vercel.app`

### 2b — `task_assignment_image` (Category: Utility, Header: **Media → Image**)

Identical to 2a in body, samples, footer and buttons. The only difference is the header: choose **Media**, then **Image**, and upload any JPEG or PNG as the sample (a screenshot of a task is fine; it is used for review only).

What the code sends in this slot at runtime is the picture attached to the task, as a public Cloudinary link. Meta's Cloud API accepts an image header as `{"type":"header","parameters":[{"type":"image","image":{"link":"<public url>"}}]}` — the image must be a direct, publicly reachable URL. Sources: https://learn.microsoft.com/en-us/azure/communication-services/concepts/advanced-messaging/whatsapp/template-messages , https://docs.messangi.com/docs/creating-sending-whatsapp-media-message-template

Image limits enforced by Meta and mirrored in the upload endpoint: JPEG or PNG, **5 MB** maximum. Source: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media

### 2c — `task_reassigned_full` (Category: Utility, Header: none)

English body:
```
TASK REASSIGNED

Hi {{1}}, {{2}} has moved task {{3}} to you.

Task: {{4}}
Deadline: {{5}}

Reply here to update its status.
```
Hindi body:
```
काम बदला गया

नमस्ते {{1}}, {{2}} ने काम {{3}} आपको सौंपा है।

काम: {{4}}
अंतिम तिथि: {{5}}

अपडेट के लिए यहाँ जवाब दें।
```
Sample values: `Anshul Raibole` · `Aditya Shelke` · `TSK-12` · `Godown stock check` · `20 Sept, 5:00 pm`
Same three buttons as 2a.

---

## Step 3 — Wait for approval

- Status is shown in the Message templates list. Statuses per Meta: **Approved** means "you can begin sending it"; **In review / Pending** means "Review can take up to 24 hours"; **Rejected** means it "violates one or more policies". Source: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
- Typical experience reported by providers: utility templates often approve within minutes, occasionally up to 24 h for new accounts. Source: https://www.twilio.com/docs/whatsapp/tutorial/message-template-approvals-statuses
- You need **all six** (three names × two languages) at **Approved** before step 4. If one language is rejected, fix the wording and resubmit that one; the code falls back to English for any language that is not approved, but only if the English one exists.
- If Meta re-categorises a template as Marketing, appeal from the template's page; the bodies above describe a triggered work event, which is Utility.

---

## Step 4 — Switch the rich messages on in Render

Do this only after step 3 is complete for all six.

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
| A. Employee who has **not** replied in 24 h; create a task on the dashboard **without** an image | `task_assignment_full`: name, task id, title, deadline, details, three buttons |
| B. Same employee; create a task **with** an image | `task_assignment_image`: the picture on top, same text below |
| C. Employee replies anything (window now open); create a task **with** an image | A plain photo with the full message as its caption |
| D. Employee with open window; create a task **without** an image | Free text: title, deadline, details |
| E. Reassign a task to an employee with a closed window | `task_reassigned_full` |
| F. From WhatsApp, send a photo with "Anshul ko bhejo, kal tak theek karo" while Anshul's window is closed | Anshul gets `task_assignment_image` with that photo (previously the file was only saved) |

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
