import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { initialTasks, initialNotifications, users, findUser } from '../data/mockData.js';

const AppContext = createContext(null);

const ROLE_TO_USER = {
  Admin:    'U001',
  Manager:  'U010',
  Employee: 'U102',
};

export function AppProvider({ children }) {
  // ---------- Theme ----------
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light';
    return localStorage.getItem('flowdesk-theme') || 'light';
  });
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark'); else root.classList.remove('dark');
    localStorage.setItem('flowdesk-theme', theme);
  }, [theme]);
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  // ---------- Role + active user ----------
  const [role, setRole] = useState('Admin');
  const activeUser = useMemo(() => findUser(ROLE_TO_USER[role]), [role]);

  // ---------- Tasks ----------
  const [tasks, setTasks] = useState(initialTasks);

  const addTask = useCallback((task) => {
    setTasks((prev) => [
      {
        id: `TSK-${1100 + prev.length}`,
        createdAt: new Date().toISOString(),
        escalationLevel: 0,
        activity: [{ at: new Date().toISOString(), by: task.assignedBy, type: 'created', text: 'Task created' }],
        ...task,
      },
      ...prev,
    ]);
  }, []);

  const updateTask = useCallback((id, patch, activityEntry) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        if (activityEntry) {
          next.activity = [
            ...(t.activity || []),
            { at: new Date().toISOString(), ...activityEntry },
          ];
        }
        return next;
      })
    );
  }, []);

  const setTaskStatus = useCallback((id, status, byUserId) => {
    updateTask(id, { status }, { by: byUserId, type: 'status', text: `Status changed to ${status}` });
  }, [updateTask]);

  const approveTask = useCallback((id, byUserId) => {
    updateTask(id, { status: 'Done', approved: true }, { by: byUserId, type: 'approval', text: 'Approved by manager' });
  }, [updateTask]);

  const rejectTask = useCallback((id, byUserId, reason = 'Needs rework') => {
    updateTask(id, { status: 'Pending', approved: false }, { by: byUserId, type: 'reject', text: `Rejected: ${reason}` });
  }, [updateTask]);

  const reassignTask = useCallback((id, newAssignee, byUserId) => {
    const u = findUser(newAssignee);
    updateTask(id, { assignedTo: newAssignee }, { by: byUserId, type: 'reassign', text: `Reassigned to ${u?.name ?? newAssignee}` });
  }, [updateTask]);

  const escalateTask = useCallback((id, byUserId) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        return {
          ...t,
          escalationLevel: (t.escalationLevel || 0) + 1,
          activity: [...(t.activity || []), { at: new Date().toISOString(), by: byUserId, type: 'escalation', text: 'Manually escalated' }],
        };
      })
    );
  }, []);

  // ---------- Notifications ----------
  const [notifications, setNotifications] = useState(initialNotifications);
  const markAllRead = useCallback(() => setNotifications((prev) => prev.map((n) => ({ ...n, unread: false }))), []);
  const unreadCount = notifications.filter((n) => n.unread).length;

  // ---------- Search ----------
  const [search, setSearch] = useState('');

  const value = {
    theme, toggleTheme,
    role, setRole, activeUser,
    users,
    tasks, addTask, updateTask, setTaskStatus, approveTask, rejectTask, reassignTask, escalateTask,
    notifications, markAllRead, unreadCount,
    search, setSearch,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
