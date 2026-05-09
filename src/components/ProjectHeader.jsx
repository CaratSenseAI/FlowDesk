import React from 'react';
import { Plus, Copy } from 'lucide-react';
import { AvatarStack } from './Avatar.jsx';
import { useApp } from '../context/AppContext.jsx';

export default function ProjectHeader({ onNewTask }) {
  const { users } = useApp();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-2">
      <div>
        <h1 className="text-[22px] font-semibold text-navy-800 dark:text-ink-50 tracking-tight">
          CaratSense × Client Team
        </h1>
        <p className="text-sm text-ink-500 dark:text-ink-400 inline-flex items-center gap-1.5">
          WhatsApp-driven task operations · ID FD-2026-OPS
          <button className="inline-flex items-center justify-center h-5 w-5 rounded text-ink-400 hover:text-navy-600 hover:bg-lavender-100 dark:hover:bg-white/[.06] transition-colors" title="Copy ID">
            <Copy className="h-3 w-3" />
          </button>
        </p>
      </div>
      <div className="flex items-center gap-3">
        <AvatarStack userList={users.filter((u) => u.role !== 'Admin')} max={3} />
        <div className="h-7 w-px bg-ink-200 dark:bg-white/[.10]" />
        <button onClick={onNewTask} className="btn-primary">
          <Plus className="h-4 w-4" />
          New Task
        </button>
      </div>
    </div>
  );
}
