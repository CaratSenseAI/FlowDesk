# FlowDesk — WhatsApp Task Manager (UI Demo)

A frontend-only, fully interactive demo of a hierarchical task-management dashboard
integrated with WhatsApp. Built for showcase: realistic mock data, role switching,
charts, modals, dark mode, and a clean SaaS feel.

## Stack

- **React 18** (functional components, hooks, Context API)
- **Vite 6** (dev server + build)
- **Tailwind CSS 3** (utility-first styling, custom `brand` + `ink` palettes, dark mode)
- **Recharts** (pie / bar / area charts)
- **lucide-react** (icons)

> No backend. All data is in [src/data/mockData.js](src/data/mockData.js) and
> mutations live in React state via [src/context/AppContext.jsx](src/context/AppContext.jsx).

## Run it

```bash
npm install
npm run dev
```

The dev server opens at <http://localhost:5173> automatically.

To produce a static build:

```bash
npm run build
npm run preview
```

## What's inside

### Role switching (top-right segmented control)

- **Admin** — Aarav Mehta · `U001`
- **Manager** — Priya Sharma · `U010`
- **Employee** — Sneha Pillai · `U102`

Switching the role rewires the sidebar, the dashboard, the task scope (all / team /
mine), and the actions you can take on a task (approve, reassign, escalate, update
status).

### Per-role dashboards

| Role     | Dashboard                                                                           |
| -------- | ----------------------------------------------------------------------------------- |
| Admin    | Total tasks, completion rate, overdue, escalated, status pie, throughput bar, completion trend, live WhatsApp activity, employee performance table, escalations, all tasks |
| Manager  | Team metrics, pending approvals (inline approve/reject), team roster with completion bars, delayed tasks, all team tasks, status pie, throughput bar |
| Employee | My day metrics, "Today's Focus" cards with inline status buttons, recent updates, all my tasks |

### Other views (sidebar)

- **Tasks** — filterable, sortable table, scoped by role
- **Org & Teams / My Team** — hierarchy tree with tasks-per-person stats
- **Approvals** — manager/admin only, approve or reject completed work
- **Escalations** — active escalations across the org
- **WhatsApp Hub** — chat-style thread view per task with input box
- **Analytics** — pie + bar + 6-week trend

### Task details modal

Click any task row or card to open. Shows status, priority, custom fields, full
activity timeline, hierarchy strip, deadline math (days until / days overdue), and
an embedded WhatsApp reply box. Footer actions are role-aware:

- Employee on own task → **Mark Done**, **Report Issue**, **Request Delay**
- Manager / Admin on team task → **Approve**, **Reject**, **Reassign**, **Escalate**

### Create-task form

`+ New Task` (top-right) opens a modal with title, description, assignee (filtered
by role hierarchy), priority, deadline, and **dynamic custom fields** (key/value
pairs you can add or remove). The new task is prepended to the global state and
visible immediately across every dashboard.

### Bonus features

- 🌙 Dark mode toggle (persisted in `localStorage`)
- 🔔 Notifications panel (unread count, mark-all-read, click-outside dismiss)
- 🔎 Global search bar (filters task tables by ID, title, or assignee)
- 🔥 Overdue tasks highlighted in rose tint with flame badge
- 🎨 Status badges color-coded: Done · Pending · Delay · Issue
- ⚡ Hover states + animations on cards, modals, and rows

## Project structure

```
src/
├── App.jsx                       # role-aware shell + view router
├── main.jsx                      # React entry
├── index.css                     # Tailwind layers + design tokens
├── context/
│   └── AppContext.jsx            # global state: role, theme, tasks, notifications
├── data/
│   └── mockData.js               # users, tasks, notifications, helpers
├── components/
│   ├── Avatar.jsx                # gradient avatar + AvatarStack
│   ├── Sidebar.jsx               # role-driven nav
│   ├── Topbar.jsx                # search, role switch, theme, notifications, profile
│   ├── NotificationsPanel.jsx
│   ├── MetricCard.jsx
│   ├── StatusBadge.jsx           # status + priority chips
│   ├── TaskTable.jsx             # filter + sort + search-aware table
│   ├── Modal.jsx                 # accessible modal shell
│   ├── TaskDetailsModal.jsx      # role-aware actions + activity timeline
│   ├── CreateTaskModal.jsx       # dynamic custom fields
│   └── charts/Charts.jsx         # pie, bar, area
└── views/
    ├── AdminDashboard.jsx
    ├── ManagerDashboard.jsx
    ├── EmployeeDashboard.jsx
    ├── TasksView.jsx
    ├── TeamView.jsx
    ├── ApprovalsView.jsx
    ├── EscalationsView.jsx
    ├── AnalyticsView.jsx
    └── WhatsAppHub.jsx
```

## Notes

- All "API calls" are synchronous state updates in `AppContext`; swap with real
  fetches when you're ready to wire a backend.
- The hierarchy lives entirely in `mockData.users[].reportingTo`. Change the
  `ROLE_TO_USER` map in `AppContext.jsx` to demo a different person per role.
- Tailwind's `darkMode: 'class'` is toggled by adding/removing `dark` on `<html>`.
