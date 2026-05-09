import React, { useState } from 'react';
import Modal from './Modal.jsx';
import StatusBadge, { PriorityBadge } from './StatusBadge.jsx';
import Avatar from './Avatar.jsx';
import { findUser, isOverdue, daysUntil } from '../data/mockData.js';
import { useApp } from '../context/AppContext.jsx';
import { ShieldAlert, CheckCircle2, XCircle, RefreshCw, MessageCircle, Clock3 } from 'lucide-react';

function ActivityItem({ entry }) {
  const u = findUser(entry.by);
  const time = new Date(entry.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const tone = {
    created:    'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
    comment:    'bg-ink-100 text-ink-700 dark:bg-white/[.06] dark:text-ink-100',
    status:     'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    escalation: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
    approval:   'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
    reject:     'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
    reassign:   'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  }[entry.type] || 'bg-ink-100 text-ink-700 dark:bg-white/[.06] dark:text-ink-100';

  return (
    <li className="flex gap-3">
      {u ? <Avatar user={u} size="sm" /> : (
        <span className="inline-flex h-7 w-7 rounded-full bg-ink-200 dark:bg-white/[.10] items-center justify-center text-[10px] font-bold text-ink-600 dark:text-ink-200">SYS</span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink-800 dark:text-ink-100">
          <span className="font-medium">{u?.name || 'System'}</span>{' '}
          <span className="text-ink-500 dark:text-ink-400">— {entry.text}</span>
        </p>
        <div className="mt-1 flex items-center gap-2">
          <span className={`chip ${tone}`}>{entry.type}</span>
          <span className="text-[11px] text-ink-400 dark:text-ink-500">{time}</span>
        </div>
      </div>
    </li>
  );
}

export default function TaskDetailsModal({ task, onClose }) {
  const { role, activeUser, users, setTaskStatus, approveTask, rejectTask, reassignTask, escalateTask } = useApp();
  const [comment, setComment] = useState('');
  if (!task) return null;

  const assignee = findUser(task.assignedTo);
  const assigner = findUser(task.assignedBy);
  const overdue = isOverdue(task);
  const days = daysUntil(task.deadline);

  const isMyTask = task.assignedTo === activeUser?.id;
  const isMyReport = users.some((u) => u.id === task.assignedTo && u.reportingTo === activeUser?.id);
  const canApprove = role !== 'Employee' && (isMyReport || role === 'Admin') && task.status === 'Done';
  const canReassign = role !== 'Employee' && (isMyReport || role === 'Admin');
  const canEscalate = role !== 'Admin' && (isMyTask || isMyReport);

  const employeesOfRole = users.filter((u) => u.role === 'Employee' && (role === 'Admin' || u.reportingTo === activeUser?.id));

  return (
    <Modal
      open={!!task}
      onClose={onClose}
      title={task.title}
      subtitle={`${task.id} • Assigned by ${assigner?.name}`}
      maxWidth="max-w-3xl"
      footer={
        <div className="flex flex-wrap items-center justify-between w-full gap-2">
          <div className="flex flex-wrap gap-2">
            {role === 'Employee' && isMyTask && task.status !== 'Done' && (
              <>
                <button className="btn-success" onClick={() => setTaskStatus(task.id, 'Done', activeUser.id)}>
                  <CheckCircle2 className="h-4 w-4" /> Mark Done
                </button>
                <button className="btn-soft" onClick={() => setTaskStatus(task.id, 'Issue', activeUser.id)}>
                  <ShieldAlert className="h-4 w-4" /> Report Issue
                </button>
                <button className="btn-soft" onClick={() => setTaskStatus(task.id, 'Delay', activeUser.id)}>
                  <Clock3 className="h-4 w-4" /> Request Delay
                </button>
              </>
            )}
            {canApprove && (
              <>
                <button className="btn-success" onClick={() => approveTask(task.id, activeUser.id)}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </button>
                <button className="btn-danger" onClick={() => rejectTask(task.id, activeUser.id)}>
                  <XCircle className="h-4 w-4" /> Reject
                </button>
              </>
            )}
            {canEscalate && (
              <button className="btn-soft" onClick={() => escalateTask(task.id, activeUser.id)}>
                <ShieldAlert className="h-4 w-4" /> Escalate
              </button>
            )}
            {canReassign && employeesOfRole.length > 0 && (
              <select
                onChange={(e) => e.target.value && reassignTask(task.id, e.target.value, activeUser.id)}
                className="input max-w-[200px]"
                defaultValue=""
              >
                <option value="" disabled>Reassign to…</option>
                {employeesOfRole.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost">Close</button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="md:col-span-2 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {overdue && <span className="chip bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">Overdue</span>}
            {task.escalationLevel > 0 && (
              <span className="chip bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-500/10 dark:text-fuchsia-300">
                Escalated · L{task.escalationLevel}
              </span>
            )}
          </div>

          <p className="text-sm text-ink-700 dark:text-ink-200 leading-relaxed">{task.description}</p>

          <div>
            <p className="label">Custom Fields</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(task.customFields || {}).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-ink-50 dark:bg-white/[.04] px-3 py-2 border border-ink-100 dark:border-white/[.06]">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">{k}</p>
                  <p className="text-sm text-ink-800 dark:text-ink-100 font-medium">{v}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="label">Activity</p>
            <ul className="space-y-3">
              {task.activity?.map((a, i) => <ActivityItem key={i} entry={a} />)}
            </ul>
          </div>

          <div>
            <p className="label">WhatsApp Thread</p>
            <div className="rounded-xl border border-ink-200 dark:border-white/[.06] bg-emerald-50/30 dark:bg-emerald-500/[.04] p-3 space-y-2">
              <div className="flex items-start gap-2">
                <MessageCircle className="h-4 w-4 text-emerald-600 mt-1" />
                <p className="text-sm">
                  <span className="font-semibold">{assignee?.name}:</span>{' '}
                  <span className="text-ink-700 dark:text-ink-200">“On it — will share an update by EOD.”</span>
                </p>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input value={comment} onChange={(e) => setComment(e.target.value)} className="input" placeholder="Reply via WhatsApp…" />
                <button className="btn-success" onClick={() => setComment('')}>Send</button>
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <p className="label">Assignee</p>
            <div className="flex items-center gap-3">
              <Avatar user={assignee} size="lg" />
              <div>
                <p className="text-sm font-semibold text-ink-900 dark:text-ink-50">{assignee?.name}</p>
                <p className="text-[11px] text-ink-500 dark:text-ink-400">{assignee?.role} · {assignee?.id}</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <p className="label">Deadline</p>
            <p className={`text-lg font-bold tabular-nums ${overdue ? 'text-rose-600 dark:text-rose-300' : 'text-ink-900 dark:text-ink-50'}`}>
              {new Date(task.deadline).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
            <p className="text-xs text-ink-500 dark:text-ink-400">
              {overdue ? `${Math.abs(days)} day(s) overdue` : days === 0 ? 'Due today' : `${days} day(s) remaining`}
            </p>
          </div>
          <div className="card p-4">
            <p className="label">Hierarchy</p>
            <ol className="text-sm space-y-2">
              <li className="flex items-center gap-2"><Avatar user={assigner} size="sm" /> <span>{assigner?.name}</span> <span className="text-ink-400 text-[11px]">({assigner?.role})</span></li>
              <li className="ml-3 border-l-2 border-dashed border-ink-300 dark:border-white/[.10] pl-3 py-1 text-[11px] text-ink-500 flex items-center gap-1"><RefreshCw className="h-3 w-3" /> assigned</li>
              <li className="flex items-center gap-2"><Avatar user={assignee} size="sm" /> <span>{assignee?.name}</span> <span className="text-ink-400 text-[11px]">({assignee?.role})</span></li>
            </ol>
          </div>
        </aside>
      </div>
    </Modal>
  );
}
