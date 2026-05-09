import React from 'react';
import { LayoutDashboard, ListChecks, Users2, ShieldCheck, MessagesSquare, BarChart3, Settings, LifeBuoy, CheckSquare } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

const NAV_BY_ROLE = {
  Admin: [
    { key: 'dashboard',   label: 'Dashboard',    icon: LayoutDashboard },
    { key: 'tasks',       label: 'All Tasks',    icon: ListChecks },
    { key: 'team',        label: 'Org & Teams',  icon: Users2 },
    { key: 'escalations', label: 'Escalations',  icon: ShieldCheck },
    { key: 'whatsapp',    label: 'WhatsApp Hub', icon: MessagesSquare },
    { key: 'analytics',   label: 'Analytics',    icon: BarChart3 },
  ],
  Manager: [
    { key: 'dashboard', label: 'Dashboard',    icon: LayoutDashboard },
    { key: 'tasks',     label: 'Team Tasks',   icon: ListChecks },
    { key: 'approvals', label: 'Approvals',    icon: CheckSquare },
    { key: 'team',      label: 'My Team',      icon: Users2 },
    { key: 'whatsapp',  label: 'WhatsApp Hub', icon: MessagesSquare },
  ],
  Employee: [
    { key: 'dashboard', label: 'My Day',   icon: LayoutDashboard },
    { key: 'tasks',     label: 'My Tasks', icon: ListChecks },
    { key: 'whatsapp',  label: 'WhatsApp', icon: MessagesSquare },
  ],
};

export default function Sidebar({ active, onNavigate }) {
  const { role, tasks } = useApp();
  const items = NAV_BY_ROLE[role] || [];
  const escalatedCount = tasks.filter((t) => t.escalationLevel > 0).length;
  const approvalsCount = tasks.filter((t) => t.status === 'Done' && !t.approved).length;

  const badgeFor = (key) => {
    if (key === 'escalations' && escalatedCount > 0) return escalatedCount;
    if (key === 'approvals'   && approvalsCount > 0) return approvalsCount;
    return null;
  };

  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col gap-1 border-r border-ink-200 dark:border-white/[.06] bg-white dark:bg-ink-900 px-3 py-5">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-2 py-1.5 mb-3">
        <div className="h-8 w-8 rounded-lg bg-brand-600 grid place-items-center text-white font-bold text-sm">
          F
        </div>
        <div>
          <p className="text-[15px] font-semibold text-ink-900 dark:text-ink-50 leading-tight">FlowDesk</p>
          <p className="text-[11px] text-ink-500 dark:text-ink-400 leading-tight">Task Operations</p>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {items.map((it) => {
          const Icon = it.icon;
          const isActive = active === it.key;
          const badge = badgeFor(it.key);
          return (
            <button
              key={it.key}
              onClick={() => onNavigate(it.key)}
              className={`group flex items-center justify-between rounded-lg px-2.5 py-2 text-sm font-medium transition-colors
                ${isActive
                  ? 'bg-ink-100 text-ink-900 dark:bg-white/[.08] dark:text-ink-50'
                  : 'text-ink-600 dark:text-ink-300 hover:bg-ink-50 dark:hover:bg-white/[.04] hover:text-ink-900 dark:hover:text-ink-50'}`}
            >
              <span className="flex items-center gap-2.5">
                <Icon className={`h-4 w-4 ${isActive ? 'text-brand-600 dark:text-brand-400' : 'text-ink-500 dark:text-ink-400'}`} />
                {it.label}
              </span>
              {badge ? (
                <span className="text-[11px] font-semibold rounded-md px-1.5 py-0.5 bg-ink-200 text-ink-700 dark:bg-white/[.10] dark:text-ink-100">
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 pt-3 border-t border-ink-200 dark:border-white/[.06]">
        <button className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-600 dark:text-ink-300 hover:bg-ink-50 dark:hover:bg-white/[.04]">
          <Settings className="h-4 w-4 text-ink-500 dark:text-ink-400" /> Settings
        </button>
        <button className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-600 dark:text-ink-300 hover:bg-ink-50 dark:hover:bg-white/[.04]">
          <LifeBuoy className="h-4 w-4 text-ink-500 dark:text-ink-400" /> Help & Docs
        </button>
      </div>
    </aside>
  );
}
