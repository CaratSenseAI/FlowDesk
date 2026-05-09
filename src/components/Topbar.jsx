import React, { useState } from 'react';
import { Search, Bell, Sun, Moon, Plus, ChevronDown } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import Avatar from './Avatar.jsx';
import NotificationsPanel from './NotificationsPanel.jsx';

export default function Topbar({ onCreateTask }) {
  const { theme, toggleTheme, role, setRole, activeUser, search, setSearch, unreadCount } = useApp();
  const [showNotif, setShowNotif] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200 dark:border-white/[.06] bg-white/90 dark:bg-ink-900/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
      <div className="px-5 py-2.5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Search */}
        <div className="flex items-center gap-3 lg:flex-1 lg:max-w-md">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
              placeholder="Search tasks, people, IDs…"
              className="input pl-9"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Role switcher */}
          <div className="flex items-center rounded-lg border border-ink-200 dark:border-white/[.08] bg-ink-50 dark:bg-white/[.03] p-0.5">
            {['Admin', 'Manager', 'Employee'].map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  role === r
                    ? 'bg-white dark:bg-ink-900 text-ink-900 dark:text-ink-50 shadow-soft'
                    : 'text-ink-500 dark:text-ink-400 hover:text-ink-800 dark:hover:text-ink-100'
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <button onClick={onCreateTask} className="btn-primary hidden md:inline-flex">
            <Plus className="h-4 w-4" />
            New Task
          </button>

          <button onClick={toggleTheme} className="btn-ghost h-9 w-9 p-0 justify-center" title="Toggle theme">
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <div className="relative">
            <button
              onClick={() => setShowNotif((s) => !s)}
              className="btn-ghost h-9 w-9 p-0 justify-center relative"
              title="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-ink-900" />
              )}
            </button>
            {showNotif && <NotificationsPanel onClose={() => setShowNotif(false)} />}
          </div>

          <div className="hidden sm:flex items-center gap-2 pl-2 ml-1 border-l border-ink-200 dark:border-white/[.08]">
            <Avatar user={activeUser} size="md" />
            <div className="leading-tight">
              <p className="text-xs font-medium text-ink-900 dark:text-ink-50">{activeUser?.name}</p>
              <p className="text-[11px] text-ink-500 dark:text-ink-400">{activeUser?.role}</p>
            </div>
            <ChevronDown className="h-4 w-4 text-ink-400" />
          </div>
        </div>
      </div>
    </header>
  );
}
