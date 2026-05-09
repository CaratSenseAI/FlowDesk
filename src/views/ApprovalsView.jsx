import React from 'react';
import { useApp } from '../context/AppContext.jsx';
import { directReports, findUser } from '../data/mockData.js';
import Avatar from '../components/Avatar.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { CheckSquare } from 'lucide-react';

export default function ApprovalsView({ onOpenTask }) {
  const { tasks, activeUser, role, approveTask, rejectTask } = useApp();

  const scope = role === 'Admin'
    ? tasks
    : tasks.filter((t) => directReports(activeUser.id).some((u) => u.id === t.assignedTo));

  const pending = scope.filter((t) => t.status === 'Done' && !t.approved);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Approvals"
        title="Pending your review"
        subtitle="Employees mark tasks as Done via WhatsApp. Approve or send back for rework."
        right={<span className="chip ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20">{pending.length} waiting</span>}
      />

      {pending.length === 0 ? (
        <div className="card p-12 text-center">
          <CheckSquare className="h-7 w-7 mx-auto text-emerald-500 mb-2" />
          <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">Inbox zero.</p>
          <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">New approvals will appear here as they come in.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {pending.map((t) => {
            const u = findUser(t.assignedTo);
            return (
              <li key={t.id} className="card p-4 flex flex-wrap items-center gap-3 animate-fade-in">
                <Avatar user={u} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-ink-900 dark:text-ink-50 truncate">{t.title}</p>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="num text-[11px] text-ink-500 dark:text-ink-400">{t.id} · submitted by {u?.name}</p>
                  <p className="text-sm text-ink-700 dark:text-ink-200 mt-1 line-clamp-2">{t.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => approveTask(t.id, activeUser.id)} className="btn-success">Approve</button>
                  <button onClick={() => rejectTask(t.id, activeUser.id)} className="btn-soft">Reject</button>
                  <button onClick={() => onOpenTask(t)} className="btn-ghost">Details</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
