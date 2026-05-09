import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext.jsx';
import TopNav from './components/TopNav.jsx';
import ProjectHeader from './components/ProjectHeader.jsx';
import TaskDetailsModal from './components/TaskDetailsModal.jsx';
import CreateTaskModal from './components/CreateTaskModal.jsx';

import AdminDashboard from './views/AdminDashboard.jsx';
import ManagerDashboard from './views/ManagerDashboard.jsx';
import EmployeeDashboard from './views/EmployeeDashboard.jsx';
import TasksView from './views/TasksView.jsx';
import TeamView from './views/TeamView.jsx';
import WhatsAppHub from './views/WhatsAppHub.jsx';
import ApprovalsView from './views/ApprovalsView.jsx';
import EscalationsView from './views/EscalationsView.jsx';
import AnalyticsView from './views/AnalyticsView.jsx';

function Shell() {
  const { role } = useApp();
  const [active, setActive] = useState('dashboard');
  const [openTask, setOpenTask] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => { setActive('dashboard'); }, [role]);

  const renderView = () => {
    if (active === 'dashboard') {
      if (role === 'Admin')   return <AdminDashboard onOpenTask={setOpenTask} onNavigate={setActive} />;
      if (role === 'Manager') return <ManagerDashboard onOpenTask={setOpenTask} onNavigate={setActive} />;
      return <EmployeeDashboard onOpenTask={setOpenTask} onNavigate={setActive} />;
    }
    if (active === 'tasks')       return <TasksView onOpenTask={setOpenTask} />;
    if (active === 'team')        return <TeamView />;
    if (active === 'approvals')   return <ApprovalsView onOpenTask={setOpenTask} />;
    if (active === 'escalations') return <EscalationsView onOpenTask={setOpenTask} />;
    if (active === 'whatsapp')    return <WhatsAppHub />;
    if (active === 'analytics')   return <AnalyticsView />;
    return null;
  };

  const showProjectHeader = active === 'dashboard';

  return (
    <div className="min-h-screen w-full">
      <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-5 space-y-5">
        <TopNav active={active} onNavigate={setActive} />
        {showProjectHeader && <ProjectHeader onNewTask={() => setCreateOpen(true)} />}
        <div className="animate-fade-in pb-6">{renderView()}</div>
        <p className="text-center text-[11px] text-navy-700/60 dark:text-neutral-500 pt-2">
          © FlowDesk · WhatsApp Task Operations · demo build
        </p>
      </div>

      <TaskDetailsModal task={openTask} onClose={() => setOpenTask(null)} />
      <CreateTaskModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
