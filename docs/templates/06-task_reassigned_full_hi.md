# Template 6 of 6 — `task_reassigned_full_hi`

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
task_reassigned_full_hi
```

### Language
5. In **Language**, open the dropdown and choose **Hindi**.

### Type of variable
6. Near the top there is a dropdown **Type of variable** with **Name** and **Number**. Leave it on **Name**. The variables below are named ones (`{{employee_name}}` etc.); Name is what accepts them.

### Header
7. Click **Text**. In the box that appears type exactly:

```
काम बदला गया
```

### Body
8. Click inside the **Body** box, delete anything already there, and paste exactly this, including the blank lines:

```
नमस्ते {{employee_name}}, {{moved_by}} ने काम {{task_id}} आपको सौंपा है।

काम: {{task_title}}
अंतिम तिथि: {{deadline}}

अपडेट के लिए यहाँ जवाब दें।
```

   The words in double curly brackets are the variables. They must be typed exactly as shown — lowercase, underscores, no spaces — because the code sends values under these names. If the editor turns them into coloured chips, that is fine.

### Samples
9. A section called **Samples** (or **Add sample content**) appears under the body because it contains variables. There is one box per variable, labelled with the variable's name. Fill every box — Submit stays grey until all are filled:

| Variable | Type this |
|---|---|
| `{{employee_name}}` | `रमेश कुमार` |
| `{{moved_by}}` | `आशीष` |
| `{{task_id}}` | `TSK-27` |
| `{{task_title}}` | `कॉटन लॉट 4521 का शेड चेक` |
| `{{deadline}}` | `24 सितंबर, शाम 5:00` |

### Footer
10. In **Footer** type:

```
Via FlowDesk
```

### Buttons
11. Click **Add a button**. Choose **Quick reply**. In the button text box type exactly:

```
Started/ In Progress
```

12. Click **Add a button** again. Choose **Quick reply**. Type exactly:

```
Done
```

13. Click **Add a button** again. Under **Call to action** choose **Visit website**. Fill:
    - Button text: `Visit website`
    - URL type: **Static**
    - Website URL: `https://tdm-flowdesk.vercel.app`

14. Make sure the buttons are in this order: Started/ In Progress, Done, Visit website. Drag to reorder if needed.

### Check the preview
15. The **Template preview** on the right should look like this:

```
काम बदला गया

नमस्ते रमेश कुमार, आशीष ने काम TSK-27 आपको सौंपा है।

काम: कॉटन लॉट 4521 का शेड चेक
अंतिम तिथि: 24 सितंबर, शाम 5:00

अपडेट के लिए यहाँ जवाब दें।
Via FlowDesk
[ Started/ In Progress ]  [ Done ]  [ Visit website ]
```

16. Click **Next** (bottom right) or **Submit for Review**.

---

## Screen 3 — "Submit for Review"

17. Click **Submit** (or **Submit for Review**).
18. You are back at the template list. `task_reassigned_full_hi` shows with status **In review** or **Pending**.
19. Wait. When it changes to **Active – Quality pending**, this template is done.

---

## If something goes wrong

- **Submit is grey:** a sample box is empty, or a button text is missing. Scroll up and fill it.
- **Red error under the body, "variable parameters with incorrect formatting … {{customer_name}}":** a variable was mistyped. Each must be exactly one of: `{{employee_name}}`, `{{moved_by}}`, `{{task_id}}`, `{{task_title}}`, `{{deadline}}` — lowercase, underscores, no spaces, no numbers-only names, and **Type of variable** must be on **Name**.
- **Rejected:** open the template, read the reason shown, fix, and resubmit. Common causes: a body starting or ending with a variable, or two variables next to each other — this body has neither.
- **Categorised as Marketing** after approval: it still works but costs more per message. Open the template and use **Appeal** / **Request category change** to Utility.

All six done — go to Step 4 in `docs/CONFIGURATION_STEPS.md`.
