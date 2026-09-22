# Template 5 of 6 — `task_reassigned_full_en`

Do these steps in order. Do not skip any. When you finish, come back to the checklist in `docs/CONFIGURATION_STEPS.md`.

---

## Before you start

- Open **Meta Business Suite → WhatsApp Manager → Message templates**.
- Top right, the account selector must show **TDM Fabrics** (ID 1061511566555814). If it shows anything else, change it.
- Click the blue **Create template** button (top right of the list).

---

## Screen 1 — "Set up template"

1. In the row **Marketing / Utility / Authentication**, click **Utility**.
2. Below it, leave the first option **Custom** selected (the radio button that is already on). Do not choose any other option.
3. Click **Next** (bottom right).

---

## Screen 2 — "Edit template"

### Template name
4. In **Template name** type exactly (copy-paste it):

```
task_reassigned_full_en
```

### Language
5. In **Language**, open the dropdown and choose **English**. Not "English (US)".

### Header
6. Click **Text**. In the box that appears type exactly:

```
TASK REASSIGNED
```

### Body
7. Click inside the **Body** box, delete anything already there, and paste exactly this, including the blank lines:

```
Hi {{1}}, {{2}} has moved task {{3}} to you.

Task: {{4}}
Deadline: {{5}}

Reply here to update its status.
```

   The `{{1}}` … `{{5}}` are the variables. If the editor turns them into coloured chips, that is fine.

### Samples
8. A section called **Samples** (or **Add sample content**) appears under the body because it contains variables. There is one box per variable. Fill every box — the Submit button stays grey until all are filled:

| Box | Type this |
|---|---|
| {{1}} — the new employee's name | `Ramesh Kumar` |
| {{2}} — who moved the task | `Ashish` |
| {{3}} — the task number | `TSK-27` |
| {{4}} — the task title | `Shade check for cotton lot 4521` |
| {{5}} — the deadline | `24 Sept, 5:00 pm` |

### Footer
9. In **Footer** type:

```
Via FlowDesk
```

### Buttons
10. Click **Add a button**. Choose **Quick reply**. In the button text box type exactly:

```
Started/ In Progress
```

11. Click **Add a button** again. Choose **Quick reply**. Type exactly:

```
Done
```

12. Click **Add a button** again. Under **Call to action** choose **Visit website**. Fill:
    - Button text: `Visit website`
    - URL type: **Static**
    - Website URL: `https://tdm-flowdesk.vercel.app`

13. Make sure the buttons are in this order: Started/ In Progress, Done, Visit website. Drag to reorder if needed.

### Check the preview
14. The **Template preview** on the right should look like this:

```
TASK REASSIGNED

Hi Ramesh Kumar, Ashish has moved task TSK-27 to you.

Task: Shade check for cotton lot 4521
Deadline: 24 Sept, 5:00 pm

Reply here to update its status.
Via FlowDesk
[ Started/ In Progress ]  [ Done ]  [ Visit website ]
```

15. Click **Next** (bottom right).

---

## Screen 3 — "Submit for Review"

16. Click **Submit** (or **Submit for Review**).
17. You are back at the template list. `task_reassigned_full_en` shows with status **In review** or **Pending**.
18. Wait. When it changes to **Active – Quality pending**, this template is done.

---

## If something goes wrong

- **Submit is grey:** a sample box is empty, or a button text is missing. Scroll up and fill it.
- **Rejected:** open the template, read the reason shown, fix, and resubmit. The most common causes are a body starting or ending with a variable, or two variables next to each other — this body has neither.
- **Categorised as Marketing** after approval: it still works but costs more per message. Open the template and use **Appeal** / **Request category change** to Utility.

Next: open `docs/templates/06-task_reassigned_full_hi.md`.
