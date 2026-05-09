import React from 'react';
import Avatar from '../Avatar.jsx';
import { findUser } from '../../data/mockData.js';

export default function RankPerformanceCard({ data, onSeeAll }) {
  const top = data.slice(0, 3);
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">Rank Performance</h2>
        <button onClick={onSeeAll} className="see-all">See All</button>
      </div>
      <ul className="space-y-4">
        {top.map((row) => {
          const u = findUser(row.id);
          const points = 100 + row.done * 5 + (row.score % 20);
          return (
            <li key={row.id} className="flex items-center gap-3">
              <Avatar user={u} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-navy-800 dark:text-ink-50 truncate">{u?.name}</p>
                <p className="text-xs text-ink-500 dark:text-ink-400 truncate">{u?.role === 'Manager' ? 'Team Lead' : 'Specialist'}</p>
              </div>
              <span className="num text-sm font-semibold text-navy-800 dark:text-ink-50">{points} <span className="text-ink-500 font-normal">Point</span></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
