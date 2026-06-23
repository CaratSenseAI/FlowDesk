import React from 'react';
import { findUser } from '../../data/mockData.js';
import { AvatarStack } from '../Avatar.jsx';

// Tile accents (light + dark) — purely cosmetic, rotated per slot
const TILE_STYLES = [
  {
    bg:   'bg-[#EEF2FF] dark:bg-[#1a2032]',
    pill: 'bg-[#DBEAFE] text-[#1D4ED8] dark:bg-[#1e3a5f] dark:text-[#93c5fd]',
  },
  {
    bg:   'bg-[#F5F3FF] dark:bg-[#211c33]',
    pill: 'bg-[#EDE9FE] text-[#6D28D9] dark:bg-[#332a5c] dark:text-[#c4b5fd]',
  },
  {
    bg:   'bg-[#FFF3EC] dark:bg-[#2a1f1a]',
    pill: 'bg-[#FFEDD5] text-[#C2410C] dark:bg-[#3d2a1c] dark:text-[#fdba74]',
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Real deadline indicator derived from task.deadline
function deadlineInfo(deadline) {
  if (!deadline) return { text: 'No deadline', cls: 'text-[#9CA3AF]' };
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / DAY_MS);
  if (days < 0)   return { text: `${-days}d overdue`,  cls: 'text-[#DC2626] dark:text-[#f87171]' };
  if (days === 0) return { text: 'Due today',          cls: 'text-[#B45309] dark:text-[#fbbf24]' };
  if (days === 1) return { text: 'Due tomorrow',       cls: 'text-[#B45309] dark:text-[#fbbf24]' };
  return { text: `Due in ${days}d`, cls: 'text-[#6B7280]' };
}

const STATUS_DOT = {
  Done:    'bg-[#22C55E]',
  Pending: 'bg-[#3B82F6]',
  Delay:   'bg-[#F59E0B]',
  Issue:   'bg-[#EF4444]',
};

function TaskTile({ task, style, onOpen }) {
  const team = [findUser(task.assignedTo), findUser(task.assignedBy)].filter(Boolean);
  const due  = deadlineInfo(task.deadline);

  return (
    <button
      onClick={() => onOpen?.(task)}
      className={`group flex flex-col text-left ${style.bg} rounded-2xl p-5 min-h-[210px] border border-black/5 dark:border-white/5 hover:shadow-md transition-shadow w-full`}
    >
      {/* Priority pill */}
      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full w-fit ${style.pill}`}>
        {task.priority} Priority
      </span>

      {/* Title */}
      <h3 className="mt-4 text-lg font-bold text-[#111827] leading-snug line-clamp-2 flex-1">
        {task.title}
      </h3>

      {/* Team + status */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <AvatarStack userList={team} max={3} />
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#6B7280]">
          <span className={`h-2 w-2 rounded-full ${STATUS_DOT[task.status] || 'bg-[#9CA3AF]'}`} />
          {task.status}
        </span>
      </div>

      {/* Real deadline */}
      <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/5">
        <span className={`num text-xs font-semibold ${due.cls}`}>{due.text}</span>
      </div>
    </button>
  );
}

function PlaceholderTile() {
  return (
    <div className="flex flex-col rounded-2xl p-5 min-h-[210px] bg-[#F3F4F6] border border-dashed border-[#E5E7EB]">
      <span className="inline-flex items-center w-fit text-xs font-semibold px-2.5 py-1 rounded-full bg-[#E5E7EB] text-[#9CA3AF]">
        —
      </span>
      <p className="mt-4 text-sm font-medium text-[#9CA3AF] flex-1">No task</p>
      <div className="mt-3 h-1.5 rounded-full bg-[#E5E7EB]" />
    </div>
  );
}

export default function TodayTaskBoard({ tasks, onOpenTask, onSeeAll }) {
  const top = tasks.slice(0, 3);
  const fillers = Math.max(0, 3 - top.length);

  return (
    <div className="fd-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-[#111827]">Today Task</h2>
        <button onClick={onSeeAll} className="text-xs font-semibold text-[#1E1B3A] hover:underline">
          See All
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {top.map((t, i) => (
          <TaskTile
            key={t.id}
            task={t}
            style={TILE_STYLES[i % TILE_STYLES.length]}
            onOpen={onOpenTask}
          />
        ))}
        {Array.from({ length: fillers }).map((_, i) => (
          <PlaceholderTile key={`ph-${i}`} />
        ))}
      </div>
    </div>
  );
}
