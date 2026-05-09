import React from 'react';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  AreaChart, Area,
} from 'recharts';

const STATUS_COLORS = {
  Done:    '#10b981',
  Pending: '#0ea5e9',
  Delay:   '#f59e0b',
  Issue:   '#f43f5e',
};

function ChartCard({ title, subtitle, children, height = 320 }) {
  return (
    <div className="card p-5 animate-fade-in" style={{ height }}>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{title}</p>
        {subtitle && <p className="text-[11px] text-ink-500 dark:text-ink-400">{subtitle}</p>}
      </div>
      <div style={{ height: `calc(100% - 2.25rem)` }}>{children}</div>
    </div>
  );
}

export function StatusPieChart({ tasks }) {
  const counts = ['Done', 'Pending', 'Delay', 'Issue'].map((s) => ({
    name: s,
    value: tasks.filter((t) => t.status === s).length,
  }));

  return (
    <ChartCard title="Tasks by Status" subtitle="Live snapshot">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={counts} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="none">
            {counts.map((entry) => (
              <Cell key={entry.name} fill={STATUS_COLORS[entry.name]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function PerformanceBarChart({ data }) {
  return (
    <ChartCard title="Throughput by Person" subtitle="Done · Pending · Issues">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,.15)" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'rgba(99,102,241,.05)' }} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="done"    stackId="a" fill="#10b981" />
          <Bar dataKey="pending" stackId="a" fill="#0ea5e9" />
          <Bar dataKey="issues"  stackId="a" fill="#f43f5e" radius={[4,4,0,0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CompletionTrend({ data }) {
  return (
    <ChartCard title="Completion Trend" subtitle="Last 7 days" height={280}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.18}/>
              <stop offset="100%" stopColor="#4f46e5" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,.15)" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip />
          <Area type="monotone" dataKey="completed" stroke="#4f46e5" strokeWidth={2} fill="url(#trendFill)" dot={false} activeDot={{ r: 4, fill: '#4f46e5' }} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
