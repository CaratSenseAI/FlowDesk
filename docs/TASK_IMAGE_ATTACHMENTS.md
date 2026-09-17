# Task image attachments — plan and implementation

**Request (Ashish, 17 Sept 2026):** a task should be able to carry an image, uploaded when the task is created on the dashboard, and the person receiving the task should see that image on WhatsApp.

**Verdict:** possible. About half exists already. One WhatsApp rule shapes the design, and it needs one new message template approved on the Meta side before the feature can ship. Everything else is code.

---

## 1. What exists today

| Capability | Status | Where |
|---|---|---|
| Employee sends a photo on WhatsApp → stored on Cloudinary → shown on the task | ✅ works | `webhookController` → `mediaService.storeWhatsAppMedia`, `Activity.mediaUrl`, `TaskDetailsModal` |
| Manager forwards a photo on WhatsApp with "Ramesh ko bhejo" → task created with the photo, photo forwarded to Ramesh | ✅ works | `attachmentService`, `commandExecutor.deliverFile`, `whatsappService.sendMediaMessage` |
| Dashboard **New Task** form has an image picker | ❌ missing | `CreateTaskModal.jsx` |
| Task record has a field for an attachment | ❌ missing — only `Activity.mediaUrl` and `Message.mediaUrl` exist | `schema.prisma` |
| Assignment WhatsApp message carries the image | ❌ missing — `task_assignment` is text only | `notifyService`, `whatsappService` |
| Image shown on the task card / list | ❌ missing | `TaskTable.jsx`, `TaskDetailsModal.jsx` |

---

## 2. The WhatsApp rule that shapes the design

WhatsApp Cloud API allows a business to send a **free-form** message (text, image, document) only inside the **24-hour customer service window**, which opens each time the person messages the business number. Outside that window the only deliverable message is an **approved template**.

Consequences:

- An employee who replied to FlowDesk in the last 24 hours can receive the image as a plain image message. `sendMediaMessage` already does this.
- A new employee, or one who last replied more than 24 hours ago, can only receive the image inside a **template with an image header**. Today no such template exists, which is why `deliverFile` gives up and says "saved on the task, they've been notified to open it".
- "The receiver should also see the image" therefore requires a **media template**. This is ordinary, supported Meta functionality, not a workaround. Approval takes minutes to a day.

Limits to keep in mind (Meta): image ≤ 5 MB, JPEG or PNG; documents ≤ 100 MB; header image in a template must be publicly reachable by URL at send time (Cloudinary URLs qualify).

---

## 3. Steps for Aditya (non-code)

Do step 3.1 first. The code cannot be switched on until the template is approved.

### 3.1 Create the media template in Meta

1. Log in to **Meta Business Suite** (login in `CLAUDE.md`) → **WhatsApp Manager** → **Message templates** for the TDM WhatsApp Business Account.
2. **Create template**:
   - **Category:** Utility
   - **Name:** `task_assignment_image` (exactly this; the code will reference it)
   - **Language:** English
3. **Header:** choose **Media → Image**. Upload any sample image (a screenshot of a task is fine). Meta only uses it for review.
4. **Body:** keep the same wording and the same two parameters as the existing `task_assignment` template so the code can pass the same values:

   ```
   Hi {{1}}, you have been assigned a new task: {{2}}.
   The picture above shows what needs to be done.
   Reply here with *done*, *issue <reason>* or *delay <reason>* to update it.
   ```

   Parameter order matters: `{{1}}` = assignee name, `{{2}}` = task id. Meta renders positionally. Add sample values when prompted ("Ramesh", "TSK-12").
5. **Buttons (optional):** Quick reply "Done", "Need more time", "Issue" — same labels as on `task_assignment`, because `contactReplyService` matches on the label text. If unsure, add no buttons.
6. Submit. Repeat steps 2–6 with **Language: Hindi**, body:

   ```
   नमस्ते {{1}}, आपको एक नया काम दिया गया है: {{2}}।
   ऊपर की तस्वीर में देखें कि क्या करना है।
   अपडेट के लिए यहाँ *done*, *issue <कारण>* या *delay <कारण>* लिखें।
   ```

7. Wait for **Approved** on both. Check under Message templates → status column. Rejections are usually for a variable at the very start or end of the body, or two variables next to each other; the wording above avoids both.
8. Once approved, tell me. `WHATSAPP_TEMPLATES.md` gets a new row and the code switches on.

### 3.2 Confirm the product rules with Ashish

Decide and tell me:

- Maximum images per task: **one** (recommended for v1; more later if needed).
- Allowed types: **JPEG / PNG only**, or also PDF (Meta supports a document header template too, but that is a second template).
- Whether an image added **after** creation should be re-sent to the assignee (recommended: yes, as a plain image if the window is open, else nothing until they next reply).
- Whether **reassignment** should carry the image to the new person (recommended: yes).

### 3.3 Nothing else to set up

- **Cloudinary** already stores every WhatsApp photo; dashboard uploads go to the same account under `flowdesk/task-images`. Check quota under the Cloudinary dashboard once a month (free tier is 25 GB storage / 25 GB bandwidth).
- **Render:** no new environment variables. The feature is gated on template approval, which I will encode as `APPROVED_LANGS`-style constant, not a flag.
- **Vercel:** nothing. Frontend deploys from `main`.
- **Deploy:** backend needs a **Manual Deploy** on Render (auto-deploy is still broken — see `CLAUDE.md`). Frontend deploys itself.

---

## 4. Code implementation (Claude will do this)

Estimate: one working day including tests. Ships once 3.1 is approved.

### 4.1 Data model

`backend/prisma/schema.prisma`, on `Task`:

```prisma
  /// Cloudinary URL of the image attached when the task was created or edited.
  /// Distinct from Activity.mediaUrl, which is proof the worker sent back.
  attachmentUrl  String?
  attachmentKind String?  // "image" | "document"
```

Render's build runs `prisma db push`, so the column appears on deploy. Add both fields to `taskInclude`/select lists in `taskService.ts` and to `normaliseTask` in `AppContext.jsx`.

### 4.2 Upload endpoint

New route `POST /api/uploads` (auth required, Admin/Manager). Accepts `multipart/form-data` with one `file` field.

- Add `multer` (memory storage, `limits: { fileSize: 5 * 1024 * 1024 }`, `fileFilter` allowing `image/jpeg`, `image/png`, and `application/pdf` if 3.2 says so).
- Pass the buffer to the existing `uploadBufferToCloudinary(buffer, id, 'flowdesk/task-images')`.
- Respond `{ url, kind }`. The frontend then sends `attachmentUrl` in the normal create/update JSON, so the task endpoints stay JSON-only.
- Register in `src/index.ts` **after** the raw webhook parser and the JSON parser, like the other routers.

### 4.3 Task create / update / reassign

- `taskController.createTask`: accept `attachmentUrl`, `attachmentKind` in the body; pass through to `taskService.create`. Validate the URL host is `res.cloudinary.com` so a caller cannot make the server send an arbitrary link.
- `taskController.updateTask`: same two fields, editable by Admin/Manager only.
- `taskService.create` / `reassign`: include the attachment in the `notifyAssignment` call (`task: { id, title, attachmentUrl, attachmentKind }`).
- Record an `Activity` of type `attachment` with `mediaUrl` when an image is added on edit, so it shows in the timeline the same way a worker's photo does.

### 4.4 Sending the image on WhatsApp

`whatsappService.ts`:

- Add `TEMPLATE.ASSIGNMENT_IMAGE = 'task_assignment_image'` and `sendTaskAssignmentWithImage(to, assigneeName, taskId, imageUrl, lang)`.
- Extend `sendWhatsAppLocalized` with an optional `header` argument so the request becomes:

  ```ts
  components: [
    { type: 'header', parameters: [{ type: 'image', image: { link: imageUrl } }] },
    { type: 'body',   parameters: [{ type: 'text', text: assigneeName }, { type: 'text', text: taskId }] },
  ]
  ```

- Document the new row in `WHATSAPP_TEMPLATES.md` (params: assignee name, task id; header: image).

`notifyService.notifyAssignment`:

```
if task has attachment and kind === 'image':
    if session open  → sendMediaMessage(image, caption = "New task TSK-12: <title>")  (free-form, richer)
    else             → sendTaskAssignmentWithImage(...)                                  (template with image header)
else: current behaviour
```

Record the `Message` row with `kind: 'image'`, `mediaUrl`, and delivery status exactly as `deliverFile` does today, so the Tracker shows it and failures are visible.

For `kind === 'document'` (only if 3.2 allows PDFs): free-form `sendMediaMessage` when the window is open; otherwise fall back to the text template plus a line "a document is attached, reply to receive it", since a document-header template would be a third approval.

### 4.5 Reuse in the WhatsApp forwarding path

`commandExecutor.deliverFile`: when the window is shut, call the new image template instead of giving up. The reply to the manager changes from "saved on the task, they've been notified" to "sent". One-line change once 4.4 exists.

### 4.6 Frontend

- `CreateTaskModal.jsx`: an **Add image** control (`<input type="file" accept="image/jpeg,image/png">`), client-side size check (5 MB), preview thumbnail, remove button. On submit: upload first via `POST /api/uploads`, then create the task with `attachmentUrl`. Disable the Create button while uploading; show the upload error inline.
- `AppContext.addTask` / `updateTask`: pass the two new fields through; `normaliseTask` maps them.
- `TaskDetailsModal.jsx`: show the attachment at the top of the details (reuse `AttachmentPreview`), with an **Open** link.
- `TaskTable.jsx` and `TodayTaskBoard.jsx`: a small paperclip/image icon on tasks that have one.
- Edit task: same picker to add or replace.

### 4.7 Tests

- Backend unit: `notifyService` chooses free-form vs template correctly for open/closed windows, with and without an attachment; `sendWhatsAppLocalized` builds the header component; upload route rejects >5 MB and wrong MIME types.
- Backend integration (`tests/integration`): create a task with an attachment → `Message` row has `kind: image` and the right template name when the window is closed.
- Frontend unit: modal blocks submit while uploading; shows the error from a failed upload.

### 4.8 Rollout order

1. Template submitted (3.1) — you.
2. Code merged to `main` with the image template name behind the approval check — me.
3. Template approved — Meta.
4. Manual Deploy on Render — you (one click); Vercel deploys itself.
5. Test: create a task with an image for Anshul (who has not messaged in 24 h) → he receives the template with the image at the top. Then he replies "done" → window open → create another task with an image → he receives a plain image with caption.

---

## 5. Acceptance criteria to show Ashish

- [ ] New Task on the dashboard accepts a JPEG/PNG up to 5 MB and shows a preview before saving.
- [ ] The assignee receives the image on WhatsApp within a minute, whether or not they have messaged recently.
- [ ] The image is visible on the task in the dashboard and in the Tracker conversation, with delivery status.
- [ ] Reassigning the task sends the image to the new person.
- [ ] A failed delivery is visible in the Tracker with the reason, never silent.
