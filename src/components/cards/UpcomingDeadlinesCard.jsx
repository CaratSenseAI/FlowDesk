import React, { useMemo } from 'react';
import { CalendarClock, ArrowUpRight } from 'lucide-react';
import { findUser, isOverdue, daysUntil } from '../../data/mockData.js';
import Avatar from '../Avatar.jsx';

function deadlineChip(t) {
  if (isOverdue(t)) {
    return <span className="chip bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20">Overdue</span>;
  }
  const d = daysUntil(t.deadline);
  if (d <= 0) return <span className="chip bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20">Due today</span>;
  if (d <= 2) return <span className="chip bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20">{d}d left</span>;
  return <span className="chip bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20">{d}d left</span>;
}

export default function UpcomingDeadlinesCard({ tasks, onOpen, onSeeAll }) {
  const list = useMemo(() => {
    return [...tasks]
      .filter((t) => t.status !== 'Done')
      .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
      .slice(0, 5);
  }, [tasks]);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-navy-600 dark:text-neutral-300" />
          <h2 className="section-title">Upcoming Deadlines</h2>
        </div>
        <button onClick={onSeeAll} className="see-all">See All</button>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-neutral-400 text-center py-6">Nothing due soon.</p>
      ) : (
        <ul className="divide-y divide-ink-100 dark:divide-white/[.05]">
          {list.map((t) => {
            const u = findUser(t.assignedTo);
            return (
              <li key={t.id}>
                <button onClick={() => onOpen?.(t)} className="w-full flex items-center gap-3 py-3 text-left hover:bg-lavender-50 dark:hover:bg-white/[.03] -mx-2 px-2 rounded-xl transition-colors">
                  <Avatar user={u} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy-800 dark:text-white truncate">{t.title}</p>
                    <p className="num text-[11px] text-ink-500 dark:text-neutral-400">{t.id} · {u?.name?.split(' ')[0]}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {deadlineChip(t)}
                    <span className="num text-[11px] text-ink-500 dark:text-neutral-400">
                      {new Date(t.deadline).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-ink-400 dark:text-neutral-500" />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
