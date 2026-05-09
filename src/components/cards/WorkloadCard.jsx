import React, { useMemo } from 'react';
import { Users2 } from 'lucide-react';
import Avatar from '../Avatar.jsx';
import { findUser } from '../../data/mockData.js';

const STATUS_COLOR = {
  Done:    'bg-emerald-400',
  Pending: 'bg-sky-400',
  Delay:   'bg-amber-400',
  Issue:   'bg-rose-400',
};

export default function WorkloadCard({ tasks, users, onSeeAll }) {
  const data = useMemo(() => {
    const employees = users.filter((u) => u.role === 'Employee');
    const rows = employees.map((u) => {
      const my = tasks.filter((t) => t.assignedTo === u.id);
      const counts = {
        Done:    my.filter((t) => t.status === 'Done').length,
        Pending: my.filter((t) => t.status === 'Pending').length,
        Delay:   my.filter((t) => t.status === 'Delay').length,
        Issue:   my.filter((t) => t.status === 'Issue').length,
      };
      return { id: u.id, total: my.length, counts };
    });
    const max = Math.max(1, ...rows.map((r) => r.total));
    return { rows: rows.sort((a, b) => b.total - a.total), max };
  }, [tasks, users]);

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users2 className="h-4 w-4 text-navy-600 dark:text-neutral-300" />
          <h2 className="section-title">Workload Distribution</h2>
        </div>
        <button onClick={onSeeAll} className="see-all">See All</button>
      </div>

      <ul className="space-y-3">
        {data.rows.map((row) => {
          const u = findUser(row.id);
          const widthPct = (row.total / data.max) * 100;
          return (
            <li key={row.id} className="flex items-center gap-3">
              <Avatar user={u} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-navy-800 dark:text-white truncate">{u?.name}</span>
                  <span className="num text-xs text-ink-500 dark:text-neutral-400 whitespace-nowrap">{row.total} tasks</span>
                </div>
                <div className="relative flex h-2 rounded-full bg-lavender-100 dark:bg-white/[.05] overflow-hidden" style={{ width: `${widthPct}%`, minWidth: row.total ? '8%' : '0' }}>
                  {['Done', 'Pending', 'Delay', 'Issue'].map((status) => {
                    const c = row.counts[status];
                    if (!c) return null;
                    const pct = (c / row.total) * 100;
                    return <span key={status} className={`h-full ${STATUS_COLOR[status]}`} style={{ width: `${pct}%` }} title={`${status}: ${c}`} />;
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 pt-3 border-t border-ink-100 dark:border-white/[.06] flex items-center gap-4 text-[11px] text-ink-500 dark:text-neutral-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Done</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" /> Pending</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> Delay</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" /> Issue</span>
      </div>
    </div>
  );
}
