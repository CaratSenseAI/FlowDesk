import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { StatusPieChart, PerformanceBarChart, CompletionTrend } from '../components/charts/Charts.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function AnalyticsView() {
  const { tasks, users } = useApp();
  const perf = useMemo(() => users.filter((u) => u.role === 'Employee').map((u) => {
    const my = tasks.filter((t) => t.assignedTo === u.id);
    return {
      name: u.name.split(' ')[0],
      done: my.filter((t) => t.status === 'Done').length,
      pending: my.filter((t) => t.status === 'Pending' || t.status === 'Delay').length,
      issues: my.filter((t) => t.status === 'Issue').length,
    };
  }), [tasks, users]);

  const trend = [
    { day: 'W1', completed: 18 },
    { day: 'W2', completed: 26 },
    { day: 'W3', completed: 31 },
    { day: 'W4', completed: 22 },
    { day: 'W5', completed: 38 },
    { day: 'W6', completed: 41 },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Analytics"
        title="Operational health"
        subtitle="Throughput, distribution, and trend across the last six weeks."
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1"><StatusPieChart tasks={tasks} /></div>
        <div className="lg:col-span-2"><PerformanceBarChart data={perf} /></div>
      </div>
      <CompletionTrend data={trend} />
    </div>
  );
}
