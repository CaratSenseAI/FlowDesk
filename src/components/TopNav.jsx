import React, { useState } from 'react';
import { Search, Bell, Sun, Moon, ChevronDown } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import Avatar from './Avatar.jsx';
import NotificationsPanel from './NotificationsPanel.jsx';

const NAV_BY_ROLE = {
  Admin:    [['dashboard','Dashboard'], ['tasks','Tasks'], ['analytics','Analytic'], ['team','Team'], ['escalations','Escalations'], ['whatsapp','Tracker']],
  Manager:  [['dashboard','Dashboard'], ['tasks','Tasks'], ['approvals','Approvals'], ['team','Team'], ['whatsapp','Tracker']],
  Employee: [['dashboard','My Day'], ['tasks','My Tasks'], ['whatsapp','Tracker']],
};

export default function TopNav({ active, onNavigate }) {
  const { theme, toggleTheme, role, setRole, activeUser, search, setSearch, unreadCount } = useApp();
  const [showNotif, setShowNotif] = useState(false);
  const [showRole, setShowRole] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const items = NAV_BY_ROLE[role] || [];

  return (
    <div className="relative z-40 flex items-center justify-between gap-4 bg-white dark:bg-neutral-900 rounded-full px-4 py-2 shadow-soft border border-white/80 dark:border-white/[.06]">
      {/* Brand */}
      <div className="flex items-center gap-2 pl-2 pr-3 shrink-0">
        <div className="h-8 w-8 rounded-xl bg-navy-600 grid place-items-center text-white font-bold text-sm">F</div>
        <p className="text-[20px] font-semibold tracking-tight text-navy-800 dark:text-ink-50">FlowDesk</p>
      </div>

      {/* Nav items */}
      <nav className="flex items-center gap-0.5 flex-1 justify-center min-w-0 overflow-x-auto">
        {items.map(([key, label]) => {
          const isActive = active === key;
          return (
            <button
              key={key}
              onClick={() => onNavigate(key)}
              className={`nav-pill ${isActive ? 'nav-pill-active' : 'nav-pill-inactive'}`}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-2 shrink-0">
        {showSearch ? (
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => !search && setShowSearch(false)}
              placeholder="Search…"
              className="input pl-9 py-1.5"
            />
          </div>
        ) : (
          <button onClick={() => setShowSearch(true)} className="h-9 w-9 grid place-items-center rounded-full text-ink-600 dark:text-ink-300 hover:bg-lavender-100 dark:hover:bg-white/[.06]">
            <Search className="h-4 w-4" />
          </button>
        )}

        <div className="relative">
          <button
            onClick={() => setShowNotif((s) => !s)}
            className="h-9 w-9 grid place-items-center rounded-full text-ink-600 dark:text-ink-300 hover:bg-lavender-100 dark:hover:bg-white/[.06] relative"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-navy-800" />
            )}
          </button>
          {showNotif && <NotificationsPanel onClose={() => setShowNotif(false)} />}
        </div>

        <button onClick={toggleTheme} className="h-9 w-9 grid place-items-center rounded-full text-ink-600 dark:text-ink-300 hover:bg-lavender-100 dark:hover:bg-white/[.06]" title="Toggle theme">
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <div className="h-7 w-px bg-ink-200 dark:bg-white/[.10] mx-1" />

        {/* Role + User */}
        <div className="relative">
          <button
            onClick={() => setShowRole((s) => !s)}
            className="flex items-center gap-2.5 pl-1 pr-3 py-1 rounded-full hover:bg-lavender-50 dark:hover:bg-white/[.04] transition-colors"
          >
            <Avatar user={activeUser} size="md" />
            <div className="text-left leading-tight">
              <p className="text-sm font-medium text-navy-800 dark:text-ink-50">{activeUser?.name?.split(' ')[0]} {activeUser?.name?.split(' ')[1]?.[0]}</p>
              <p className="text-[11px] text-ink-500 dark:text-ink-400">{activeUser?.email}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-ink-400" />
          </button>
          {showRole && (
            <div className="absolute right-0 top-full mt-2 w-56 card p-2 z-50">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 px-2 py-1">Switch role</p>
              {['Admin', 'Manager', 'Employee'].map((r) => (
                <button
                  key={r}
                  onClick={() => { setRole(r); setShowRole(false); }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm ${role === r ? 'bg-navy-600 text-white' : 'text-ink-700 hover:bg-lavender-100 dark:text-ink-200 dark:hover:bg-white/[.06]'}`}
                >
                  {r} view
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
