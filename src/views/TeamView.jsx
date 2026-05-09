import React from 'react';
import { useApp } from '../context/AppContext.jsx';
import Avatar from '../components/Avatar.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { directReports } from '../data/mockData.js';

function PersonNode({ user, depth = 0 }) {
  const { tasks } = useApp();
  const reports = directReports(user.id);
  const my = tasks.filter((t) => t.assignedTo === user.id);
  const done = my.filter((t) => t.status === 'Done').length;
  const score = my.length ? Math.round((done / my.length) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="card p-3 flex items-center gap-3">
        <Avatar user={user} size="lg" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-ink-900 dark:text-ink-50 truncate">{user.name}</p>
          <p className="text-[11px] text-ink-500 dark:text-ink-400">{user.role} · {user.email}</p>
        </div>
        {my.length > 0 && (
          <div className="hidden sm:flex items-center gap-2">
            <div className="h-1.5 w-32 rounded-full bg-ink-100 dark:bg-white/[.06] overflow-hidden">
              <div className="h-full bg-brand-600" style={{ width: `${score}%` }} />
            </div>
            <span className="num text-xs font-medium tabular-nums text-ink-700 dark:text-ink-200">{score}%</span>
          </div>
        )}
        <span className="chip ring-1 ring-inset bg-ink-100 text-ink-700 ring-ink-200 dark:bg-white/[.06] dark:text-ink-200 dark:ring-white/[.08]">
          {my.length} {my.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>
      {reports.length > 0 && (
        <div className="ml-5 border-l border-ink-200 dark:border-white/[.08] pl-5 space-y-3">
          {reports.map((r) => <PersonNode key={r.id} user={r} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

export default function TeamView() {
  const { users, role, activeUser } = useApp();
  const root = role === 'Admin' ? users.find((u) => u.role === 'Admin') : activeUser;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Org Chart"
        title={role === 'Admin' ? 'Organization' : 'My team'}
        subtitle="Hierarchy drives escalation. Tasks bubble up to whoever each person reports to."
      />
      {root && <PersonNode user={root} />}
    </div>
  );
}
