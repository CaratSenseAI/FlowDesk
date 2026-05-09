import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import TodayTaskBoard from '../components/cards/TodayTaskBoard.jsx';
import ProjectCompletedCard from '../components/cards/ProjectCompletedCard.jsx';
import TrackerDetailCard from '../components/cards/TrackerDetailCard.jsx';
import ChatCard from '../components/cards/ChatCard.jsx';
import RankPerformanceCard from '../components/cards/RankPerformanceCard.jsx';
import KPIStrip from '../components/cards/KPIStrip.jsx';
import UpcomingDeadlinesCard from '../components/cards/UpcomingDeadlinesCard.jsx';

export default function EmployeeDashboard({ onOpenTask, onNavigate }) {
  const { tasks, activeUser, users } = useApp();

  const myTasks = useMemo(() => tasks.filter((t) => t.assignedTo === activeUser.id), [tasks, activeUser.id]);

  const todayTasks = useMemo(() => {
    const order = { High: 0, Medium: 1, Low: 2 };
    return [...myTasks]
      .filter((t) => t.status !== 'Done')
      .sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
  }, [myTasks]);

  const performanceData = useMemo(() => users
    .filter((u) => u.role === 'Employee')
    .map((u) => {
      const my = tasks.filter((t) => t.assignedTo === u.id);
      const done = my.filter((t) => t.status === 'Done').length;
      return {
        id: u.id,
        name: u.name.split(' ')[0],
        fullName: u.name,
        done,
        pending: my.filter((t) => t.status === 'Pending' || t.status === 'Delay').length,
        issues: my.filter((t) => t.status === 'Issue').length,
        score: my.length ? Math.round((done / my.length) * 100) : 0,
      };
    })
    .sort((a, b) => b.score - a.score), [tasks, users]);

  return (
    <div className="space-y-5">
      <KPIStrip tasks={myTasks} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <TodayTaskBoard tasks={todayTasks.length ? todayTasks : myTasks} onOpenTask={onOpenTask} onSeeAll={() => onNavigate?.('tasks')} />
        </div>
        <ProjectCompletedCard tasks={myTasks} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <RankPerformanceCard data={performanceData} onSeeAll={() => onNavigate?.('whatsapp')} />
        <TrackerDetailCard onSeeAll={() => onNavigate?.('whatsapp')} />
        <ChatCard onSeeAll={() => onNavigate?.('whatsapp')} />
      </div>

      <UpcomingDeadlinesCard tasks={myTasks} onOpen={onOpenTask} onSeeAll={() => onNavigate?.('tasks')} />
    </div>
  );
}
