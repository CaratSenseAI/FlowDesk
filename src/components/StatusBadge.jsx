import React from 'react';
import { CheckCircle2, Clock3, AlertTriangle, AlertOctagon, Flame } from 'lucide-react';

const STATUS_MAP = {
  Done:    { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20', Icon: CheckCircle2 },
  Pending: { cls: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20',                       Icon: Clock3 },
  Delay:   { cls: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20',           Icon: AlertTriangle },
  Issue:   { cls: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20',                  Icon: AlertOctagon },
};

export default function StatusBadge({ status }) {
  const m = STATUS_MAP[status] || STATUS_MAP.Pending;
  const Icon = m.Icon;
  return (
    <span className={`chip ring-1 ring-inset ${m.cls}`}>
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

const PRIORITY_MAP = {
  High:   'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20',
  Medium: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20',
  Low:    'bg-ink-100 text-ink-700 ring-ink-200 dark:bg-white/[.06] dark:text-ink-200 dark:ring-white/[.08]',
};

export function PriorityBadge({ priority }) {
  const cls = PRIORITY_MAP[priority] || PRIORITY_MAP.Low;
  return (
    <span className={`chip ring-1 ring-inset ${cls}`}>
      {priority === 'High' && <Flame className="h-3 w-3" />}
      {priority}
    </span>
  );
}
