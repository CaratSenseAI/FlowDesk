import React, { useMemo, useState } from 'react';
import { ArrowUpDown, ChevronUp, ChevronDown, Filter, Flame, Clock3 } from 'lucide-react';
import { findUser, isOverdue, daysUntil } from '../data/mockData.js';
import StatusBadge, { PriorityBadge } from './StatusBadge.jsx';
import Avatar from './Avatar.jsx';
import { useApp } from '../context/AppContext.jsx';

function DeadlineCell({ task }) {
  const overdue = isOverdue(task);
  const d = daysUntil(task.deadline);
  const date = new Date(task.deadline).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return (
    <div className="flex items-center gap-2">
      <Clock3 className={`h-4 w-4 ${overdue ? 'text-rose-500' : 'text-ink-400'}`} />
      <div className="leading-tight">
        <p className={`text-sm font-medium ${overdue ? 'text-rose-600 dark:text-rose-300' : 'text-ink-800 dark:text-ink-100'}`}>{date}</p>
        <p className="text-[11px] text-ink-500 dark:text-ink-400">
          {overdue ? `${Math.abs(d)}d overdue` : d === 0 ? 'Due today' : `in ${d}d`}
        </p>
      </div>
    </div>
  );
}

function SortHeader({ label, dir, onClick }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 hover:text-ink-700 dark:hover:text-ink-100">
      {label}
      {dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : dir === 'desc' ? <ChevronDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-60" />}
    </button>
  );
}

export default function TaskTable({ tasks, onOpen, emptyText = 'No tasks match your filters.', dense = false }) {
  const { search } = useApp();
  const [statusFilter, setStatusFilter] = useState('All');
  const [sort, setSort] = useState({ key: 'deadline', dir: 'asc' });

  const filtered = useMemo(() => {
    let list = tasks;
    if (statusFilter !== 'All') list = list.filter((t) => t.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          (findUser(t.assignedTo)?.name || '').toLowerCase().includes(q)
      );
    }
    const { key, dir } = sort;
    list = [...list].sort((a, b) => {
      let av = a[key], bv = b[key];
      if (key === 'assignedTo') { av = findUser(av)?.name || ''; bv = findUser(bv)?.name || ''; }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [tasks, statusFilter, search, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const dirFor = (k) => (sort.key === k ? sort.dir : null);

  return (
    <div className="card overflow-hidden animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-ink-200 dark:border-white/[.06]">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-ink-400" />
          <span className="text-xs font-medium text-ink-500 dark:text-ink-400">Filter</span>
          <div className="flex flex-wrap gap-1 ml-1">
            {['All', 'Pending', 'Done', 'Delay', 'Issue'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs font-medium rounded-md px-2.5 py-1 border transition-colors ${
                  statusFilter === s
                    ? 'bg-ink-900 text-white border-ink-900 dark:bg-white dark:text-ink-900 dark:border-white'
                    : 'border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-white/[.08] dark:text-ink-300 dark:hover:bg-white/[.04]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-500 dark:text-ink-400">{filtered.length} of {tasks.length}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-head"><SortHeader label="Task" dir={dirFor('title')} onClick={() => toggleSort('title')} /></th>
              <th className="table-head"><SortHeader label="Assignee" dir={dirFor('assignedTo')} onClick={() => toggleSort('assignedTo')} /></th>
              <th className="table-head"><SortHeader label="Status" dir={dirFor('status')} onClick={() => toggleSort('status')} /></th>
              <th className="table-head"><SortHeader label="Priority" dir={dirFor('priority')} onClick={() => toggleSort('priority')} /></th>
              <th className="table-head"><SortHeader label="Deadline" dir={dirFor('deadline')} onClick={() => toggleSort('deadline')} /></th>
              <th className="table-head text-right">Esc.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100 dark:divide-white/[.04]">
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-500 dark:text-ink-400">{emptyText}</td></tr>
            )}
            {filtered.map((t) => {
              const assignee = findUser(t.assignedTo);
              const overdue = isOverdue(t);
              return (
                <tr
                  key={t.id}
                  onClick={() => onOpen?.(t)}
                  className="row-hover cursor-pointer"
                >
                  <td className={`table-cell ${dense ? 'py-2' : ''}`}>
                    <div className="flex items-start gap-2">
                      <div>
                        <p className="font-medium text-ink-900 dark:text-ink-50">{t.title}</p>
                        <p className="num text-[11px] text-ink-500 dark:text-ink-400 mt-0.5">{t.id}</p>
                      </div>
                      {overdue && <Flame className="h-3.5 w-3.5 text-rose-500 mt-1" />}
                    </div>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <Avatar user={assignee} size="sm" />
                      <span className="font-medium">{assignee?.name}</span>
                    </div>
                  </td>
                  <td className="table-cell"><StatusBadge status={t.status} /></td>
                  <td className="table-cell"><PriorityBadge priority={t.priority} /></td>
                  <td className="table-cell"><DeadlineCell task={t} /></td>
                  <td className="table-cell text-right">
                    <span className={`chip num ${t.escalationLevel > 0 ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' : 'bg-ink-100 text-ink-600 dark:bg-white/[.06] dark:text-ink-300'}`}>
                      L{t.escalationLevel || 0}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
