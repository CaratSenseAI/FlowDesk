import React from 'react';
import { findUser } from '../../data/mockData.js';
import { AvatarStack } from '../Avatar.jsx';

const PALETTE = [
  { bg: 'bg-pastel-blue',   bar: 'bg-sky-400',   pill: 'bg-white/80 text-sky-700' },
  { bg: 'bg-pastel-purple', bar: 'bg-violet-400',pill: 'bg-white/80 text-violet-700' },
  { bg: 'bg-pastel-peach',  bar: 'bg-orange-400',pill: 'bg-white/80 text-orange-700' },
  { bg: 'bg-pastel-mint',   bar: 'bg-emerald-400',pill: 'bg-white/80 text-emerald-700' },
];

function TaskTile({ task, palette, onOpen }) {
  // Synthetic progress so the "10/20" look feels real
  const total = 20;
  const completedMap = { Done: 20, Pending: 8, Delay: 6, Issue: 4 };
  const completed = completedMap[task.status] ?? 10;
  const pct = (completed / total) * 100;

  // Pull a few teammates for the avatar pile
  const team = [findUser(task.assignedTo), findUser(task.assignedBy)].filter(Boolean);

  return (
    <button
      onClick={() => onOpen?.(task)}
      className={`group flex flex-col text-left ${palette.bg} rounded-[20px] p-5 min-h-[210px] hover:shadow-card transition-shadow`}
    >
      <span className={`chip self-start ${palette.pill} font-medium`}>{task.priority} Priority</span>

      <h3 className="mt-4 text-[22px] leading-tight font-semibold text-navy-800 line-clamp-2">
        {task.title}
      </h3>

      <div className="mt-auto pt-4 flex items-end justify-between gap-3">
        <AvatarStack userList={team} max={3} />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-white/60 overflow-hidden">
          <div className={`h-full ${palette.bar} rounded-full transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <span className="num text-xs font-semibold text-navy-700 tabular-nums">{completed}/{total}</span>
      </div>
    </button>
  );
}

export default function TodayTaskBoard({ tasks, onOpenTask, onSeeAll }) {
  const top = tasks.slice(0, 3);
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">Today Task</h2>
        <button onClick={onSeeAll} className="see-all">See All</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {top.map((t, i) => (
          <TaskTile key={t.id} task={t} palette={PALETTE[i % PALETTE.length]} onOpen={onOpenTask} />
        ))}
      </div>
    </div>
  );
}
