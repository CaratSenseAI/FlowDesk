# Project Proposal — FlowDesk
### WhatsApp-Driven Hierarchical Task Operations Platform

| | |
|---|---|
| **Prepared for** | _<Client Name>_ |
| **Prepared by** | CaratSense |
| **Date** | 5 May 2026 |
| **Proposal Ref.** | CS-FD-2026-001 |
| **Validity** | 30 days from date above |
| **Primary contact** | claude@caratsense.in |

---

## 1. Executive Summary

CaratSense proposes to design, build, and deploy **FlowDesk** — a hierarchical
task-operations platform with first-class **WhatsApp integration**, tailored to
how field, ops, and frontline teams actually work in India.

A working **interactive prototype** (frontend, mock data, full role flows) has
already been built and demoed. This proposal covers the production build:
backend, WhatsApp Business API integration, auth, persistence, mobile
responsiveness, deployment, and 30-day post-launch support.

> **Live demo:** https://task-manager-three-orcin.vercel.app

The platform delivers four outcomes the client mentioned during the demo:

1. **No new app to learn** — employees update tasks by replying on WhatsApp.
2. **Visibility without micromanagement** — managers and admins see real-time
   status, escalations, and completion rates in one place.
3. **Auto-escalation** — overdue tasks bubble up the reporting line on their own.
4. **Auditable approvals** — every status change, escalation, and approval is
   logged with author + timestamp.

---

## 2. Understanding Your Requirements

Based on the demo conversation, the client operates with:

- A **3-tier reporting structure** — Admin → Manager / Lead → Employee
- Distributed teams who already live on WhatsApp; no appetite for another app
- A volume of **recurring + ad-hoc operational tasks** that frequently miss
  deadlines without anyone noticing in time
- A need for **manager-level approval** before a task is considered closed
- A need for **dynamic fields** on tasks (region, vendor, PO, etc.) that vary
  by task type
- Demand for a **single dashboard** that the leadership can open to know the
  state of operations without asking anyone

This proposal is built directly around those points.

---

## 3. Proposed Solution

A web-based dashboard (admin / manager / leadership) backed by a server that
listens to a WhatsApp Business number and writes every event to a single source
of truth.

### 3.1 Roles & permissions

| Role | Primary actions |
|---|---|
| **Admin** | Create tasks org-wide, see every metric, manage users & hierarchy, override escalations |
| **Manager / Lead** | Create + assign tasks to reports, approve / reject completed work, escalate to admin, view team analytics |
| **Employee** | View their own tasks, update status (Done / Issue / Delay) via WhatsApp **or** dashboard, request deadline changes |

Permissions are enforced server-side; role assignment lives in `users.role` with
`reportingTo` defining the tree.

### 3.2 Task lifecycle

```
Pending → Done (by employee) → Approved (by manager)
   ↓        ↓
 Issue    Rejected → back to Pending
   ↓
 Delay → re-escalates if new deadline missed
```

Auto-escalation rule: if a task is past its deadline and not in `Done` state,
its `escalationLevel` increments and a notification is dispatched to the
assignee's reporting manager. After a configurable grace period, it bumps
again to Admin.

### 3.3 WhatsApp integration

- A dedicated WhatsApp Business number, hosted via an approved
  **Business Solution Provider (BSP)** (Meta-listed).
- Outbound: each new assignment, status change, and escalation triggers a
  templated message to the relevant party.
- Inbound: replies are parsed for status keywords (`done`, `issue`, `delay`,
  free text comments). Voice notes are stored against the task; text replies
  drive state changes directly.
- All inbound messages are quoted into the dashboard's activity log so context
  is never lost.

### 3.4 Dashboard surfaces

Already designed and demoed:

- KPI strip (active tasks, completion %, on-time %, overdue / escalated)
- Today's priority tasks
- Project-completion donut (3-segment)
- Rank Performance leaderboard
- Tracker (focus vs. break sessions)
- Live chat / WhatsApp pulse
- Upcoming Deadlines list
- Workload Distribution per teammate
- Drill-down task modal with full activity timeline + role-aware actions
- Org chart view
- Approvals queue (manager-only)
- Escalations queue (admin)

### 3.5 Custom fields

Tasks support arbitrary key-value metadata at creation time, persisted as JSON
on the task record and rendered in the detail modal. No schema changes needed
for new field types.

---

## 4. Scope

### 4.1 In scope

| # | Deliverable |
|---|---|
| 1 | Production-ready frontend dashboard (extending the existing prototype) |
| 2 | Backend API (auth, tasks, users, hierarchy, activity log, notifications) |
| 3 | PostgreSQL schema + migrations |
| 4 | WhatsApp Business API integration via BSP (Wati / Gupshup / AiSensy) |
| 5 | Role-based access control (Admin, Manager, Employee) |
| 6 | Auto-escalation engine (cron + configurable rules) |
| 7 | Approval workflow with rejection feedback |
| 8 | Custom fields on tasks |
| 9 | Notifications: in-app + WhatsApp (email optional add-on) |
| 10 | Reports / CSV export of tasks, escalations, performance |
| 11 | Mobile-responsive web (works in any phone browser) |
| 12 | Light + dark theme |
| 13 | Deployment on Vercel (frontend) + managed Postgres + a small Node service |
| 14 | Documentation: admin guide, API reference, runbook |
| 15 | UAT support, training session, 30-day post-launch warranty |

### 4.2 Out of scope (available as paid add-ons)

- Native iOS / Android apps
- SSO with corporate Identity Providers (Okta, Azure AD)
- Multi-tenant white-labeled deployment
- Advanced BI dashboards beyond what's built (Looker / Metabase setup)
- Voice-note transcription
- AI summarization of task threads
- Integration with ERP / CRM / accounting tools (Zoho, Tally, SAP)

### 4.3 Client-supplied items

| Item | Owner |
|---|---|
| Verified WhatsApp Business account & display name | Client |
| Domain name + DNS access | Client |
| BSP account & monthly conversation fees | Client |
| User list with roles and reporting hierarchy | Client |
| Brand assets (logo, colors) for white-label theming | Client |
| Stakeholder availability for weekly review (1 hr / week) | Client |

---

## 5. Technical Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       Web Dashboard                          │
│           React 18 · Vite · Tailwind · Recharts              │
│                  Hosted on Vercel (CDN)                      │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS / JSON
┌───────────────────────────▼──────────────────────────────────┐
│                       FlowDesk API                           │
│                Node.js · Express · TypeScript                │
│      ┌──────────┐  ┌──────────┐  ┌─────────────────────┐    │
│      │ Auth     │  │ Tasks    │  │ Escalation Cron     │    │
│      │ (JWT)    │  │ Service  │  │ (every 15 min)      │    │
│      └──────────┘  └──────────┘  └─────────────────────┘    │
└─────┬─────────────────────────────────────┬────────────────┘
      │                                     │
      ▼                                     ▼
┌────────────────┐                 ┌─────────────────────┐
│ PostgreSQL     │                 │ WhatsApp BSP        │
│ (managed)      │                 │ webhook + send API  │
│ Users · Tasks  │                 │ (Wati / Gupshup /   │
│ Activity log   │                 │  AiSensy)           │
└────────────────┘                 └─────────────────────┘
```

**Stack rationale**

- **React + Vite + Tailwind** — already invested in the prototype; fastest path
  to production-quality UI; CDN-deployable on Vercel for sub-second loads
- **Node.js + TypeScript** — same language as the frontend; fastest team velocity
- **PostgreSQL** — relational data (tasks, users, activity) with JSONB for
  custom fields; easy to back up, easy to hire for
- **BSP layer** — avoids direct Meta complexity; standard rate cards; switchable
  later

A more detailed component diagram and data-flow set is included in
[FLOWCHART.md](FLOWCHART.md) — covering task lifecycle, escalation, approval,
and create-task flows.

---

## 6. Project Plan

A **10-week** delivery, broken into four phases.

| Phase | Weeks | Outcomes |
|---|---|---|
| **1. Discovery & Design Lock** | 1 | Stakeholder workshops, finalize hierarchy, lock visual design (already 80% done from the demo), agree custom-field taxonomy |
| **2. Backend & Data Model** | 2–4 | Auth, RBAC, task service, activity log, escalation engine, seed scripts, API docs |
| **3. WhatsApp Integration** | 5–6 | BSP setup, template approvals (Meta), inbound webhook parser, outbound send service, end-to-end test on a sandbox number |
| **4. Frontend Hardening + UAT** | 7–9 | Wire frontend to real API, mobile QA, acceptance testing, training, runbooks |
| **Go-live + Hyper-care** | Week 10 + 30 days | Production deploy, monitored launch, daily standups for first 2 weeks, ticket triage |

Milestone reviews at the end of each phase, with the client's stakeholder.

---

## 7. Team

| Role | Allocation | Responsibilities |
|---|---|---|
| Tech Lead / Architect | 50% | Design decisions, code review, BSP setup |
| Senior Full-stack Engineer | 100% | API, frontend integration, deployment |
| Frontend Engineer | 75% | Dashboard polish, responsive QA, theming |
| QA Engineer | 50% (W6 onward) | Manual + scripted regression on each role |
| Project Manager | 25% | Weekly status, risk register, client comms |

All resources are CaratSense in-house; no offshore subcontracting.

---

## 8. Commercials

> Pricing is in INR, exclusive of GST (18%). Third-party fees (BSP conversation
> charges, hosting, domain) are pass-through and billed at cost.

### 8.1 One-time build fee — Recommended package

| Line item | Amount (INR) |
|---|---:|
| Discovery & design lock | 1,25,000 |
| Backend (API, RBAC, escalation, schema) | 5,50,000 |
| WhatsApp integration (BSP + templates + parser) | 2,75,000 |
| Frontend production hardening (off the existing prototype) | 2,50,000 |
| QA, UAT support, training | 1,25,000 |
| Deployment & go-live | 75,000 |
| **One-time total** | **₹14,00,000** |

A 10% discount is applied to the line-item sum, reflecting the head-start the
existing prototype provides.

### 8.2 Recurring costs (post go-live)

| Item | Estimate (INR / month) |
|---|---:|
| Application hosting (Vercel Pro + small Node service) | 4,000 |
| Managed PostgreSQL (Neon / Supabase / Render) | 3,500 |
| Domain + email forwarding | 200 |
| BSP conversation fees (depends on volume; avg estimate at 5,000 msgs/mo) | 7,500 |
| **Estimated monthly run-rate** | **~₹15,000** |

### 8.3 Optional support retainer

| Tier | Scope | Monthly fee (INR) |
|---|---|---:|
| **Bronze** | Bug fixes, security patches, dependency updates. 8 hrs/mo. | 18,000 |
| **Silver** | Bronze + minor enhancements (≤ 4 days/mo) + monthly review call | 45,000 |
| **Gold** | Silver + dedicated point-of-contact, 4-hr critical-issue SLA, quarterly roadmap workshop | 90,000 |

> First 30 days of post-launch support are included in the build fee at no extra
> cost. The retainer kicks in from day 31.

### 8.4 Payment milestones

| Milestone | % of build fee |
|---|---:|
| Signing of agreement (kick-off) | 25% |
| Phase 2 sign-off (backend + data model) | 25% |
| Phase 3 sign-off (WhatsApp end-to-end on sandbox) | 25% |
| Go-live + 30-day acceptance | 25% |

Invoices payable within 15 days of issue.

---

## 9. Assumptions

1. The client will provide a single point of contact empowered to make
   product decisions within 48 hours of a request.
2. WhatsApp Business account verification is the client's responsibility;
   timelines assume verification completes within 2 weeks of signing.
3. Up to 3 message templates submitted to Meta for approval; additional
   templates are billed separately.
4. The reporting hierarchy is up to 4 levels deep and ≤ 500 active users at
   launch. Beyond that, capacity planning is a separate exercise.
5. Custom fields are key-value (string) initially; typed fields (date, file,
   currency) are an enhancement.

---

## 10. Acceptance Criteria

The build is considered accepted when, on the production environment:

- [ ] An admin can create a user, set their role and reporting manager
- [ ] A manager can create a task, assign it to a report, and see it in WhatsApp
- [ ] An employee can mark a task `done` via a WhatsApp reply, and the
      dashboard reflects it within 5 seconds
- [ ] A task missed past its deadline auto-escalates and the manager receives
      a WhatsApp notification
- [ ] A manager can approve / reject a completed task; rejection routes the
      task back to `Pending` with the rejection reason in the activity log
- [ ] All four KPIs on the admin dashboard match the underlying data in spot
      checks (sample of 20 tasks)
- [ ] Dashboard loads in under 2 seconds on a mid-tier Android phone over 4G
- [ ] No P1 / P2 defects open at sign-off; ≤ 5 P3 defects with agreed
      remediation timelines

---

## 11. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| WhatsApp template rejection by Meta | Medium | High | Submit templates by week 4 with multiple variants prepared |
| Hierarchy changes mid-build | Medium | Medium | Designed the user model to support runtime hierarchy edits |
| BSP outage | Low | High | Wrap BSP behind an interface; switch provider in 1–2 days if needed |
| Team-availability shocks | Low | Medium | Each role has a designated backup engineer briefed weekly |

---

## 12. Why CaratSense

- A **working, polished prototype already in your hands** — this is not a deck;
  the demo URL above is the actual product foundation.
- **Indian context first** — pricing in INR, INR GST handling, IST timezones,
  WhatsApp-first workflows.
- **No black-box stack** — open-source frontend & backend; you own the code
  and the database from day one.
- **Honest scoping** — we tell you what's out of scope upfront, so you don't
  pay for change requests that should have been flagged earlier.

---

## 13. Next Steps

1. Client to review and confirm scope alignment, or flag changes in writing.
2. Sign mutual NDA + master service agreement (templates ready; 3 working days).
3. Sign statement of work referencing this proposal.
4. CaratSense issues kick-off invoice; on receipt, week 1 begins the next
   working day.

---

### Appendix A — Tech stack reference

| Layer | Choice | Notes |
|---|---|---|
| Framework | React 18 + Vite 6 | Already in use |
| Styling | Tailwind CSS 3 | Already in use, themed |
| Charts | Recharts | Already in use |
| Icons | Lucide | Already in use |
| Backend | Node.js 20 + Express + TypeScript | New |
| Database | PostgreSQL 15 (managed) | New |
| Auth | JWT + bcrypt | New |
| Background jobs | node-cron | For escalations |
| WhatsApp | Wati / Gupshup / AiSensy (BSP) | Client to pick |
| Hosting | Vercel (FE) + Render / Railway (API + DB) | Already deployed (FE) |
| Monitoring | UptimeRobot + Sentry (free tier) | New |

### Appendix B — Demo access

The current prototype is live and role-aware. Switch between Admin / Manager /
Employee from the top-right of the dashboard:

> https://task-manager-three-orcin.vercel.app

Default users (mock):

| Role | Display name |
|---|---|
| Admin | Aarav Mehta |
| Manager | Priya Sharma |
| Employee | Sneha Pillai |

### Appendix C — Reference documents

- [README.md](README.md) — code structure, run instructions
- [FLOWCHART.md](FLOWCHART.md) — task lifecycle, escalation, approval, integration diagrams

---

_Submitted by **CaratSense** — claude@caratsense.in_
