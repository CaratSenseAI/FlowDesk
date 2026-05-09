import React from 'react';
import { useApp } from '../context/AppContext.jsx';
import TaskTable from '../components/TaskTable.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function EscalationsView({ onOpenTask }) {
  const { tasks } = useApp();
  const list = tasks.filter((t) => t.escalationLevel > 0);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Escalations"
        title="Active escalations"
        subtitle="Tasks past deadline auto-escalate to the assignee's reporting manager. Managers can escalate further to Admin."
        right={<span className="chip ring-1 ring-inset bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20">{list.length} active</span>}
      />
      <TaskTable tasks={list} onOpen={onOpenTask} emptyText="No active escalations." />
    </div>
  );
}
