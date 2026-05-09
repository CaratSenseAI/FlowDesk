import React from 'react';
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from 'recharts';

function StatRow({ color, label, value }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        <p className="text-sm text-ink-600 dark:text-ink-300">{label}</p>
      </div>
      <p className="num text-[28px] font-semibold text-navy-800 dark:text-ink-50 mt-0.5">{value}%</p>
    </div>
  );
}

export default function ProjectCompletedCard({ tasks }) {
  const total = tasks.length || 1;
  const done = tasks.filter((t) => t.status === 'Done').length;
  const inProgress = tasks.filter((t) => t.status === 'Pending' || t.status === 'Delay').length;
  const backlog = tasks.filter((t) => t.status === 'Issue' || t.escalationLevel > 0).length;

  const donePct = Math.round((done / total) * 100);
  const inProgressPct = Math.round((inProgress / total) * 100);
  const backlogPct = Math.round((backlog / total) * 100);

  // RadialBarChart renders innermost first → list innermost ring first
  const data = [
    { name: 'Backlog',    uv: backlogPct,    fill: '#7dd3fc' },
    { name: 'In Progress',uv: inProgressPct, fill: '#fb923c' },
    { name: 'Done',       uv: donePct,       fill: '#a78bfa' },
  ];

  return (
    <div className="card p-5 h-full">
      <div className="flex items-start justify-between">
        <h2 className="section-title">Project Completed</h2>
        <p className="text-xs text-ink-500 dark:text-ink-400">Total project <span className="num text-navy-800 dark:text-ink-50 font-semibold">{total}</span></p>
      </div>

      <div className="grid grid-cols-2 gap-4 mt-5 items-center">
        <div className="space-y-4">
          <StatRow color="#a78bfa" label="Project Done"  value={donePct} />
          <StatRow color="#fb923c" label="In Progress"   value={inProgressPct} />
          <StatRow color="#7dd3fc" label="Backlog"       value={backlogPct} />
        </div>

        <div className="relative h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="40%"
              outerRadius="100%"
              data={data}
              startAngle={90}
              endAngle={-270}
              barSize={14}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
              <RadialBar
                dataKey="uv"
                background={{ fill: 'rgba(60,46,116,.07)' }}
                cornerRadius={20}
              />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
