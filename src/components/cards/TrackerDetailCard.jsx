import React from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

const DEFAULT_DATA = [
  { day: 'Mon', focus: 6, break: 2 },
  { day: 'Tue', focus: 4, break: 3 },
  { day: 'Wed', focus: 7, break: 4 },
  { day: 'Thu', focus: 3, break: 2 },
  { day: 'Fri', focus: 8, break: 3 },
  { day: 'Sat', focus: 2, break: 5 },
];

export default function TrackerDetailCard({ data = DEFAULT_DATA, onSeeAll }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="section-title">Tracker Detail</h2>
        <button onClick={onSeeAll} className="see-all">See All</button>
      </div>

      <div className="flex items-center justify-end gap-4 mb-1">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-500 dark:text-ink-400">
          <span className="h-2.5 w-2.5 rounded-full bg-orange-400" /> Focus
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-500 dark:text-ink-400">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> Break
        </span>
      </div>

      <div className="h-[210px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }} barCategoryGap="32%">
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
              hide
            />
            <YAxis hide />
            <Tooltip cursor={{ fill: 'rgba(60,46,116,.04)' }} />
            <Bar dataKey="focus" fill="#fb923c" radius={[14, 14, 14, 14]} />
            <Bar dataKey="break" fill="#cbd5e1" radius={[14, 14, 14, 14]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
