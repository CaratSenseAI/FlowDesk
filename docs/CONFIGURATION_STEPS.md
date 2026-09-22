 

# Configuration steps — assignment message content and task images

**What this is.** Both features are built, pushed to `main` (named-variable version: latest commit on `main`) and the frontend is already live on Vercel. Nothing an employee receives changes until you do the steps below, in this order. Each step says where the fact comes from; nothing here is assumed.

| Step | Where                                                                      | Time            | Blocks        |
| ---- | -------------------------------------------------------------------------- | --------------- | ------------- |
| 1    | Render → Manual Deploy                                                    | 2 min + build   | everything    |
| 2    | Meta WhatsApp Manager (account**TDM Fabrics**) → create 6 templates | 30 min          | step 4        |
| 3    | Wait for Meta approval                                                     | minutes to 24 h | step 4        |
| 4    | Render → set`WA_RICH_TEMPLATES_APPROVED=true` → deploy                 | 2 min           | rich messages |
| 5    | Test on WhatsApp                                                           | 10 min          | —            |
| 6    | (once) Render ↔ GitHub reconnect so deploys become automatic              | 5 min           | convenience   |

---

## Step 1 — Deploy the backend on Render (do this first)

The frontend on Vercel already has the image picker. Until the backend is deployed, attaching a file to a task shows "Upload failed" because `/api/uploads` does not exist yet. Text tasks are unaffected.

1. Log in at https://dashboard.render.com with `tdm@caratsense.in`.
2. Open service **tdm-flowdesk-prod** → **Deploys** tab.
3. Open the **Manual Deploy** dropdown → **Deploy latest commit**. The deploy should reference the latest commit on `main` (see the Deploys page; the health endpoint below then reports the same short hash).
4. Wait for status **Live**. Confirm with:
   `https://tdm-flowdesk-prod.onrender.com/api/health` → `"commit"` equals the first seven characters of that commit.

The build runs `prisma db push`, which adds the two new task columns (`attachmentUrl`, `attachmentKind`) automatically.

> Render docs: the Manual Deploy dropdown offers "Deploy latest commit", "Deploy a specific commit", "Clear build cache & deploy" and "Restart service". Source: https://render.com/docs/deploys

---

## Step 2 — Create six templates in Meta WhatsApp Manager

> **One file per template, click by click:** `docs/templates/01-task_assignment_full_en.md` … `06-task_reassigned_full_hi.md`. Follow those in order; everything below is the reference behind them.

**Where.** Meta Business Suite → **WhatsApp Manager → Message templates**. In the account selector at the top right choose **TDM Fabrics** (ID `1061511566555814`). That is the account holding the production number +91 87967 99970; the others ("TDM Fabrics Bot", "TDM Fabrics Listing", "Test WhatsApp Business Account") are not used by FlowDesk. The list currently shows 23 templates; the ones FlowDesk sends today are there, e.g. `task_assignment_en`, `task_assignment_hi`, `task_escalation_en`.

**Naming — this matters.** Every template on this account is one language, and the language is part of the name: `task_assignment_en` and `task_assignment_hi` are two separate templates. The code builds the name the same way (`<base>_<lang>`), so create **six** templates with these exact names:

| # | Template name                | Language to pick | Header                          | Category |
| - | ---------------------------- | ---------------- | ------------------------------- | -------- |
| 1 | `task_assignment_full_en`  | English          | Text:`TASK ALLOTTED!`         | Utility  |
| 2 | `task_assignment_full_hi`  | Hindi            | Text:`नया काम!`         | Utility  |
| 3 | `task_assignment_image_en` | English          | **Media → Image**        | Utility  |
| 4 | `task_assignment_image_hi` | Hindi            | **Media → Image**        | Utility  |
| 5 | `task_reassigned_full_en`  | English          | Text:`TASK REASSIGNED`        | Utility  |
| 6 | `task_reassigned_full_hi`  | Hindi            | Text:`काम बदला गया` | Utility  |

Pick **English**, not "English (US)" — only `hello_world` uses English (US); all FlowDesk templates use plain English, which the code sends as language code `en`.

Rules from Meta's documentation that apply to all six:

- Names: "lowercase alphanumeric characters and underscores". Sources: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
- Every variable needs a sample value: "you must include an example value for each parameter." The reviewer reads the body with the samples filled in, so realistic textile-business values (below) make it obvious this is a work notification, which is what keeps it in the Utility category.
- Named variables: "Parameters using the named format must be unique, single strings, composed of lowercase characters and underscores, wrapped in double curly brackets." In WhatsApp Manager this is **Type of variable = Name**. At send time each value carries `parameter_name`, e.g. `{"type":"text","parameter_name":"employee_name","text":"Ramesh Kumar"}`. Source: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
- A media header needs a sample file at submission: "The example asset will be reviewed as part of template review."
- Review: "Review can take up to 24 hours."
- Widely reported rejection causes (BSP guides, not stated on Meta's page): a body that starts or ends with a variable, and two variables side by side. The bodies below avoid both. Sources: https://m.aisensy.com/blog/whatsapp-template-approval-process/ , https://help.spurnow.com/en/articles/11999432-whatsapp-template-rejected-common-reasons-and-how-to-fix

Buttons — identical on all six, and the labels must be **exactly** these because the code matches the tapped label text (they are the same three the current `task_assignment_en` has):

- Quick reply: `Started/ In Progress`
- Quick reply: `Done`
- Visit website: label `Visit website`, URL `https://tdm-flowdesk.vercel.app`

Footer (optional, matches today's message): `Via FlowDesk`

### Click-by-click in the Create template wizard

The wizard has three stages shown at the top: **Set up template → Edit template → Submit for Review**. Do this once per template, six times in total.

**Stage 1 — Set up template**
1. Message templates → **Create template** (top right).
2. Category row: click **Utility** (not Marketing, not Authentication).
3. Under Utility, keep the default option **Custom** ("Send messages about an existing order or account" / the first radio button). Do not pick Order status or any other special type.
4. Click **Next**.

**Stage 2 — Edit template**
5. **Template name**: type the exact name from the table (for example `task_assignment_full_en`). Lowercase and underscores only.
6. **Language**: open the dropdown and pick **English** for `_en` templates, **Hindi** for `_hi` templates. Never "English (US)".
6a. **Type of variable**: this dropdown (Name / Number) sits above the header. Leave it on **Name**. The templates use named variables (`{{employee_name}}` …) and the code sends each value with Meta's `parameter_name`.
7. **Header**: 
   - Templates 1, 2, 5, 6 → choose **Text**, type the header text from the table (`TASK ALLOTTED!`, `नया काम!`, `TASK REASSIGNED`, `काम बदला गया`).
   - Templates 3, 4 → choose **Media**, then **Image**, then **Choose file / Upload** and select your fabric photo. This is the sample the reviewer sees.
8. **Body**: paste the body text for that template. The variables are named — `{{employee_name}}`, `{{task_id}}`, `{{task_title}}`, `{{deadline}}`, `{{details}}` (reassignment: `{{moved_by}}` instead of `{{details}}`) — typed exactly, lowercase with underscores. Keep the blank lines; they become line breaks in the message.
9. **Samples**: as soon as the body contains variables (and for an image header) WhatsApp Manager shows a **Samples** / **Add sample content** section. Fill one box per variable with the sample values from the table for that template. Every box must be filled or the Submit button stays disabled.
10. **Footer** (optional): type `Via FlowDesk`.
11. **Buttons**: click **Add a button**.
    - Choose **Quick reply** → button text `Started/ In Progress`.
    - **Add a button** again → **Quick reply** → `Done`.
    - **Add a button** again → **Visit website** (under "Call to action") → button text `Visit website`, URL type **Static**, URL `https://tdm-flowdesk.vercel.app`.
    - Order: the two quick replies first, the website button last, as on the current `task_assignment_en`.
12. Check the **Template preview** on the right: header, five filled-in lines, footer, three buttons.
13. Click **Next** (or **Submit for Review** / **Submit**, depending on the wizard version).

**Stage 3 — Submit for Review**
14. Confirm and submit. The template appears in the list with status **In review** or **Pending**.
15. Repeat from step 1 for the next template. When all six show **Active – Quality pending**, go to Step 4 of this guide.

If a field label differs slightly from the above, the order is what matters: category → type → name → language → header → body → samples → footer → buttons → submit.

### Templates 1 and 3 — `task_assignment_full_en` and `task_assignment_image_en`

Same body, same samples, same buttons. Template 1 has **Header: Text** `TASK ALLOTTED!`. Template 3 has **Header: Media → Image**, and the sample you upload should be a clear photo of a fabric — a folded bolt or a swatch on a plain background, JPEG or PNG, under 5 MB, no text written on it. The reviewer sees the sample image together with the sample text, so the text below is written to match a fabric photo.

Body:

```
Hi {{employee_name}}, a new task {{task_id}} has been assigned to you on FlowDesk.

Task: {{task_title}}
Deadline: {{deadline}}
Details: {{details}}

Reply here to update its status.
```

Sample values, realistic for a textile business (enter these exactly when WhatsApp Manager asks for examples):

| Variable  | Sample value                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `{{employee_name}}` | Ramesh Kumar                                                                                                    |
| `{{task_id}}` | TSK-27                                                                                                          |
| `{{task_title}}` | Shade check for cotton lot 4521                                                                                 |
| `{{deadline}}` | 24 Sept, 5:00 pm                                                                                                |
| `{{details}}` | Compare the attached fabric photo with the rolls in godown rack B and confirm the shade matches before dispatch |

For template 1 (no image) use the same values except `{{details}}`: `Count the rolls of cotton lot 4521 in godown rack B and note any damaged pieces`.

### Templates 2 and 4 — `task_assignment_full_hi` and `task_assignment_image_hi`

Language **Hindi**. Template 2: Header Text `नया काम!`. Template 4: Header Media → Image with a sample file.

Body:

```
नमस्ते {{employee_name}}, FlowDesk पर आपको नया काम {{task_id}} दिया गया है।

काम: {{task_title}}
अंतिम तिथि: {{deadline}}
विवरण: {{details}}

अपडेट के लिए यहाँ जवाब दें।
```

Sample values:

| Variable  | Sample value                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `{{employee_name}}` | रमेश कुमार                                                                                                                                                      |
| `{{task_id}}` | TSK-27                                                                                                                                                                   |
| `{{task_title}}` | कॉटन लॉट 4521 का शेड चेक                                                                                                                                  |
| `{{deadline}}` | 24 सितंबर, शाम 5:00                                                                                                                                             |
| `{{details}}` | साथ भेजी गई कपड़े की फोटो को गोदाम रैक B के रोल से मिलाएँ और डिस्पैच से पहले शेड की पुष्टि करें |

For template 2 (no image) use the same values except `{{details}}`: `गोदाम रैक B में कॉटन लॉट 4521 के रोल गिनें और खराब पीस नोट करें`.

### Template 5 — `task_reassigned_full_en`

Language English. Header Text `TASK REASSIGNED`.

```
Hi {{employee_name}}, {{moved_by}} has moved task {{task_id}} to you.

Task: {{task_title}}
Deadline: {{deadline}}

Reply here to update its status.
```

Sample values: `employee_name` Ramesh Kumar · `moved_by` Ashish · `task_id` TSK-27 · `task_title` Shade check for cotton lot 4521 · `deadline` 24 Sept, 5:00 pm

### Template 6 — `task_reassigned_full_hi`

Language Hindi. Header Text `काम बदला गया`.

```
नमस्ते {{employee_name}}, {{moved_by}} ने काम {{task_id}} आपको सौंपा है।

काम: {{task_title}}
अंतिम तिथि: {{deadline}}

अपडेट के लिए यहाँ जवाब दें।
```

Sample values: `employee_name` रमेश कुमार · `moved_by` आशीष · `task_id` TSK-27 · `task_title` कॉटन लॉट 4521 का शेड चेक · `deadline` 24 सितंबर, शाम 5:00

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

| Test                                                                                                        | Expected on the employee's phone                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A. Employee who has**not** replied in 24 h; create a task on the dashboard **without** an image | `task_assignment_full_en` (or `_hi` per the employee's language): name, task id, title, deadline, details, three buttons |
| B. Same employee; create a task**with** an image                                                      | `task_assignment_image_en`/`_hi`: the picture on top, same text below                                                    |
| C. Employee replies anything (window now open); create a task**with** an image                        | A plain photo with the full message as its caption                                                                           |
| D. Employee with open window; create a task**without** an image                                       | Free text: title, deadline, details                                                                                          |
| E. Reassign a task to an employee with a closed window                                                      | `task_reassigned_full_en`/`_hi`                                                                                          |
| F. From WhatsApp, send a photo with "Anshul ko bhejo, kal tak theek karo" while Anshul's window is closed   | Anshul gets`task_assignment_image_en`/`_hi` with that photo (previously the file was only saved)                         |

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
