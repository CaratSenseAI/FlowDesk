import React, { useMemo } from 'react';
import TaskTable from '../components/TaskTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useApp } from '../context/AppContext.jsx';
import { directReports } from '../data/mockData.js';

export default function TasksView({ onOpenTask, title }) {
  const { tasks, role, activeUser } = useApp();

  const list = useMemo(() => {
    if (role === 'Employee') return tasks.filter((t) => t.assignedTo === activeUser.id);
    if (role === 'Manager') {
      const teamIds = directReports(activeUser.id).map((u) => u.id);
      return tasks.filter((t) => teamIds.includes(t.assignedTo));
    }
    return tasks;
  }, [tasks, role, activeUser.id]);

  const heading = title || (role === 'Employee' ? 'My tasks' : role === 'Manager' ? 'Team tasks' : 'All tasks');

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Tasks"
        title={heading}
        subtitle="Filter, sort, and click any row to inspect details, escalate, or reassign."
        right={<span className="chip ring-1 ring-inset bg-ink-100 text-ink-700 ring-ink-200 dark:bg-white/[.06] dark:text-ink-200 dark:ring-white/[.08]">{list.length} total</span>}
      />
      <TaskTable tasks={list} onOpen={onOpenTask} />
    </div>
  );
}
