# FlowDesk — Application Flowcharts

Visual reference for how the WhatsApp-driven task manager works.
All diagrams use [Mermaid](https://mermaid.js.org) and render natively
on GitHub, in VS Code (with the Markdown Preview Mermaid Support extension),
and on most static-doc renderers.

---

## 1. High-level user flow (role-aware)

```mermaid
flowchart TD
    Start([User opens FlowDesk]) --> Auth{Role?}

    Auth -->|Admin| AD[Admin Dashboard]
    Auth -->|Manager| MD[Manager Dashboard]
    Auth -->|Employee| ED[Employee Dashboard]

    AD --> AD1[KPI strip · Org-wide stats]
    AD --> AD2[Today Task · all teams]
    AD --> AD3[Project Completed donut]
    AD --> AD4[Rank Performance leaderboard]
    AD --> AD5[Workload Distribution]
    AD --> AD6[Escalations queue]

    MD --> MD1[KPI strip · Team-only stats]
    MD --> MD2[Today Task · team]
    MD --> MD3[Pending Approvals]
    MD --> MD4[Workload Distribution]
    MD --> MD5[Upcoming Deadlines]

    ED --> ED1[KPI strip · My stats]
    ED --> ED2[Today Task · mine]
    ED --> ED3[Project Completed · mine]
    ED --> ED4[Upcoming Deadlines · mine]

    AD2 --> Open[(Open Task Modal)]
    MD2 --> Open
    ED2 --> Open
    AD6 --> Open
    MD3 --> Open
    MD5 --> Open
    ED4 --> Open

    Open --> Action{Action available\nfor my role?}
    Action -->|Employee · own task| Status[Mark Done · Issue · Delay]
    Action -->|Manager / Admin · team task| Approve[Approve · Reject · Reassign · Escalate]

    Status --> Persist[(Update task state)]
    Approve --> Persist
```

---

## 2. Task lifecycle (state machine)

```mermaid
stateDiagram-v2
    [*] --> Pending : Created by Admin / Manager

    Pending --> Done : Employee marks done (WhatsApp or UI)
    Pending --> Issue : Employee reports blocker
    Pending --> Delay : Employee requests delay
    Pending --> Pending : Reassigned

    Issue --> Pending : Manager unblocks
    Delay --> Pending : New deadline accepted

    Done --> Pending : Manager rejects (sends back for rework)
    Done --> Approved : Manager approves

    Approved --> [*]

    Pending --> Escalated : Deadline missed (auto)
    Issue --> Escalated : Manager escalates to Admin
    Delay --> Escalated : Manager escalates to Admin
    Escalated --> Pending : Admin reassigns / extends
    Escalated --> Done : Resolved at higher level
```

---

## 3. Escalation flow (hierarchy bubbling)

```mermaid
flowchart LR
    E[Employee task] -- deadline missed --> Auto{{Auto-escalate L0 → L1}}
    Auto --> M[Reporting Manager]
    M -- still blocked --> Manual{{Manual escalate L1 → L2}}
    Manual --> A[Admin]
    A -- resolves / reassigns --> Resolved([Resolved])

    classDef level0 fill:#dde6f9,stroke:#0284c7,color:#0f172a;
    classDef level1 fill:#fad6c4,stroke:#ea580c,color:#0f172a;
    classDef level2 fill:#f7d8e2,stroke:#be123c,color:#0f172a;

    class E level0
    class M level1
    class A level2
```

---

## 4. Approval flow (Manager review loop)

```mermaid
sequenceDiagram
    autonumber
    actor EMP as Employee
    participant WA as WhatsApp Bot
    participant SVC as FlowDesk
    actor MGR as Manager

    EMP->>WA: "TSK-1042 done"
    WA->>SVC: Update status = Done (unapproved)
    SVC-->>MGR: Notification — pending review
    MGR->>SVC: Open task in Approvals view

    alt Approve
        MGR->>SVC: Approve
        SVC->>EMP: Confirmation push (WhatsApp)
    else Reject
        MGR->>SVC: Reject + reason
        SVC->>EMP: Reverts to Pending + reason in thread
    end
```

---

## 5. WhatsApp ↔ FlowDesk integration

```mermaid
flowchart TB
    subgraph WA[WhatsApp]
        Msg[Inbound message]
        Note[Voice note / text]
    end

    subgraph BOT[Bot Layer]
        Parse[Parse intent]
        Route[Route by task ID]
    end

    subgraph CORE[FlowDesk Core]
        State[(Task state)]
        Hierarchy[(Hierarchy graph)]
        Activity[(Activity log)]
    end

    subgraph UI[Dashboard]
        Live[Live activity feed]
        Cards[Task cards / tables]
        Notif[Notifications panel]
    end

    Msg --> Parse
    Note --> Parse
    Parse --> Route
    Route -->|status change| State
    Route -->|comment| Activity
    Route -->|escalation trigger| Hierarchy
    State --> Live
    State --> Cards
    Activity --> Live
    Hierarchy --> Notif
    State --> Notif
```

---

## 6. Component / data architecture (frontend)

```mermaid
flowchart LR
    subgraph Data[Mock data layer]
        Users[(users[])]
        Tasks[(tasks[])]
        Notifs[(notifications[])]
    end

    subgraph Context[AppContext.jsx]
        Provider[useApp - role · theme · tasks · search · CRUD ops]
    end

    Data --> Provider

    subgraph Shell[App.jsx]
        TopNav
        ProjectHeader
        Router{active view}
    end

    Provider --> Shell

    Router --> Admin[AdminDashboard]
    Router --> Manager[ManagerDashboard]
    Router --> Employee[EmployeeDashboard]
    Router --> Tasks2[TasksView]
    Router --> Team[TeamView]
    Router --> Approvals[ApprovalsView]
    Router --> Esc[EscalationsView]
    Router --> WA[WhatsAppHub]
    Router --> Analytics[AnalyticsView]

    subgraph Cards[Reusable cards]
        KPI[KPIStrip]
        Today[TodayTaskBoard]
        Donut[ProjectCompletedCard]
        Rank[RankPerformanceCard]
        Tracker[TrackerDetailCard]
        Chat[ChatCard]
        Deadlines[UpcomingDeadlinesCard]
        Workload[WorkloadCard]
    end

    Admin --> Cards
    Manager --> Cards
    Employee --> Cards

    subgraph Modals[Overlays]
        TDM[TaskDetailsModal]
        CTM[CreateTaskModal]
        Notif2[NotificationsPanel]
    end

    Cards -. open .-> TDM
    ProjectHeader -. + New Task .-> CTM
    TopNav -. bell .-> Notif2
```

---

## 7. Create-task flow (Admin / Manager)

```mermaid
flowchart TD
    Btn[Click + New Task] --> Modal[CreateTaskModal opens]
    Modal --> Fill[Fill title · description · deadline · priority]
    Fill --> Pick{Assignee picker\nfiltered by role}
    Pick -->|Admin| AnyNonAdmin[Any Manager or Employee]
    Pick -->|Manager| MyReports[My direct reports only]
    AnyNonAdmin --> Custom[Add dynamic custom fields]
    MyReports --> Custom
    Custom --> Submit{Submit}
    Submit -->|Valid| Persist[(Prepend to tasks state)]
    Submit -->|Invalid| Modal
    Persist --> Push[Push WhatsApp notification to assignee]
    Persist --> Refresh[Dashboard re-renders]
```

---

## 8. Auto-escalation cron (conceptual)

```mermaid
flowchart LR
    Tick[Hourly cron tick] --> Scan[Scan all open tasks]
    Scan --> Check{deadline < now\n&& status ≠ Done?}
    Check -->|no| Skip[/skip/]
    Check -->|yes| Bump[Increment escalationLevel]
    Bump --> NewOwner{Currently assigned to?}
    NewOwner -->|Employee| Mgr[Notify reporting manager]
    NewOwner -->|Manager| Adm[Notify admin]
    NewOwner -->|Admin| Stay[Stay at L2 · alert only]
    Mgr --> Log[(Append activity entry)]
    Adm --> Log
    Stay --> Log
```

---

### Where each diagram lives in the code

| Diagram | Source of truth |
|---|---|
| Role-based view routing | [`src/App.jsx`](src/App.jsx) `renderView()` |
| Task state mutations | [`src/context/AppContext.jsx`](src/context/AppContext.jsx) — `setTaskStatus`, `approveTask`, `rejectTask`, `escalateTask`, `reassignTask` |
| Escalation level math | [`src/data/mockData.js`](src/data/mockData.js) — `isOverdue`, task `escalationLevel` |
| Approval queue | [`src/views/ApprovalsView.jsx`](src/views/ApprovalsView.jsx) |
| Hierarchy lookup | `directReports(managerId)` in [mockData.js](src/data/mockData.js) |

> All "WhatsApp" interactions are simulated via UI buttons + activity-log entries
> in this demo. The diagrams above describe the intended production behavior
> when the bot integration is wired in.
