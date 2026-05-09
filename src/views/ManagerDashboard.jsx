import React, { useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { directReports } from '../data/mockData.js';
import TodayTaskBoard from '../components/cards/TodayTaskBoard.jsx';
import ProjectCompletedCard from '../components/cards/ProjectCompletedCard.jsx';
import RankPerformanceCard from '../components/cards/RankPerformanceCard.jsx';
import TrackerDetailCard from '../components/cards/TrackerDetailCard.jsx';
import ChatCard from '../components/cards/ChatCard.jsx';
import KPIStrip from '../components/cards/KPIStrip.jsx';
import UpcomingDeadlinesCard from '../components/cards/UpcomingDeadlinesCard.jsx';
import WorkloadCard from '../components/cards/WorkloadCard.jsx';

export default function ManagerDashboard({ onOpenTask, onNavigate }) {
  const { tasks, activeUser, users } = useApp();
  const team = directReports(activeUser.id);
  const teamIds = team.map((u) => u.id);
  const teamTasks = useMemo(() => tasks.filter((t) => teamIds.includes(t.assignedTo)), [tasks, teamIds.join(',')]);

  const todayTasks = useMemo(() => {
    const order = { High: 0, Medium: 1, Low: 2 };
    return [...teamTasks]
      .filter((t) => t.status !== 'Done')
      .sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9));
  }, [teamTasks]);

  const performanceData = useMemo(() => team.map((u) => {
    const my = teamTasks.filter((t) => t.assignedTo === u.id);
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
  }).sort((a, b) => b.score - a.score), [team, teamTasks]);

  // Pretend the workload "users" pool is just the manager's reports
  const workloadUsers = team;

  return (
    <div className="space-y-5">
      <KPIStrip tasks={teamTasks} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <TodayTaskBoard tasks={todayTasks} onOpenTask={onOpenTask} onSeeAll={() => onNavigate?.('tasks')} />
        </div>
        <ProjectCompletedCard tasks={teamTasks} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <RankPerformanceCard data={performanceData} onSeeAll={() => onNavigate?.('team')} />
        <TrackerDetailCard onSeeAll={() => onNavigate?.('whatsapp')} />
        <ChatCard onSeeAll={() => onNavigate?.('whatsapp')} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <UpcomingDeadlinesCard tasks={teamTasks} onOpen={onOpenTask} onSeeAll={() => onNavigate?.('tasks')} />
        <WorkloadCard tasks={teamTasks} users={workloadUsers} onSeeAll={() => onNavigate?.('team')} />
      </div>
    </div>
  );
}
