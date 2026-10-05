import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import Avatar from '../components/Avatar.jsx';
import AddMemberModal from '../components/AddMemberModal.jsx';
import EditMemberModal from '../components/EditMemberModal.jsx';
import { directReports } from '../data/mockData.js';
import { groupOrg } from '../lib/orgChart.js';
import { UserPlus, Pencil, Crown, Users } from 'lucide-react';

function ProgressBar({ pct }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 rounded-full bg-[#F3F4F6] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-[#22C55E]' : 'bg-[#3B82F6]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="num text-xs font-semibold text-[#374151] w-8 text-right shrink-0">
        {pct}%
      </span>
    </div>
  );
}

function PersonRow({ user, depth = 0, isAdmin, onEdit, nest = true }) {
  const { tasks } = useApp();
  const reports   = nest ? directReports(user.id) : [];
  const my        = tasks.filter((t) => t.assignedTo === user.id);
  const done      = my.filter((t) => t.status === 'Done').length;
  const score     = my.length ? Math.round((done / my.length) * 100) : 0;

  const roleStyle = {
    Admin:    { bg: 'bg-[#EDE9FE]', text: 'text-[#6D28D9]' },
    Manager:  { bg: 'bg-[#DBEAFE]', text: 'text-[#1D4ED8]' },
    Employee: { bg: 'bg-[#F3F4F6]', text: 'text-[#374151]' },
  }[user.role] || { bg: 'bg-[#F3F4F6]', text: 'text-[#374151]' };

  return (
    <div>
      <div className="fd-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-md transition-shadow group">
        {/* Left: avatar + info */}
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <Avatar user={user} size={depth === 0 ? 'lg' : 'md'} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-[#111827] text-sm">{user.name}</p>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${roleStyle.bg} ${roleStyle.text}`}>
                {user.role}
              </span>
            </div>
            <p className="text-xs text-[#9CA3AF] mt-0.5">{user.email}</p>
            {user.phone && (
              <p className="text-xs text-[#9CA3AF] mt-0.5">📱 {user.phone}</p>
            )}
          </div>
        </div>

        {/* Right: progress + edit button */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="sm:min-w-[180px] sm:max-w-[240px] w-full">
            {user.role !== 'Admin' ? (
              <>
                <ProgressBar pct={score} />
                <p className="text-xs text-[#9CA3AF] mt-1">
                  {my.length} task{my.length !== 1 ? 's' : ''} · {done} done
                  {my.filter(t => t.escalationLevel > 0).length > 0 && (
                    <span className="ml-2 text-[#B91C1C]">
                      · {my.filter(t => t.escalationLevel > 0).length} escalated
                    </span>
                  )}
                </p>
              </>
            ) : (
              <p className="text-xs text-[#9CA3AF]">
                {my.length} task{my.length !== 1 ? 's' : ''} assigned · manages the whole team
              </p>
            )}
          </div>

          {/* Edit button — Admin only, appears on hover */}
          {isAdmin && (
            <button
              onClick={() => onEdit(user)}
              title="Edit member"
              className="opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 rounded-full
                         flex items-center justify-center text-[#6B7280]
                         hover:bg-[#EDE9FE] hover:text-[#6D28D9]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Direct reports — indented */}
      {reports.length > 0 && (
        <div
          className={`mt-3 space-y-3 ${
            depth === 0
              ? 'ml-6 pl-5 border-l-2 border-[#E5E7EB]'
              : 'ml-4 pl-4 border-l border-[#E5E7EB]'
          }`}
        >
          {reports.map((r) => (
            <PersonRow key={r.id} user={r} depth={depth + 1} isAdmin={isAdmin} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TeamView() {
  const { users, role, activeUser, tasks } = useApp();
  const [addOpen,    setAddOpen]    = useState(false);
  const [editTarget, setEditTarget] = useState(null); // user being edited

  const isAdmin = role === 'Admin';

  // Admins see the whole organisation in bands; a Manager or Employee sees
  // their own branch, which is still a tree.
  const org  = useMemo(() => groupOrg(users), [users]);
  const root = isAdmin ? null : activeUser;

  const stats = useMemo(() => {
    const live      = users.filter((u) => !u.deactivatedAt);
    const admins    = live.filter((u) => u.role === 'Admin').length;
    const managers  = live.filter((u) => u.role === 'Manager').length;
    const employees = live.filter((u) => u.role === 'Employee').length;
    const activeTaskCount = tasks.filter((t) => t.status !== 'Done').length;
    return { admins, managers, employees, activeTaskCount };
  }, [users, tasks]);

  return (
    <div className="space-y-5">
      <AddMemberModal open={addOpen}    onClose={() => setAddOpen(false)} />
      <EditMemberModal user={editTarget} onClose={() => setEditTarget(null)} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#9CA3AF]">Org Chart</p>
          <h2 className="text-xl font-bold text-[#111827] mt-0.5">Organization</h2>
          <p className="text-sm text-[#6B7280] mt-0.5">
            Admins run the whole team and can assign work to anyone, including each other.
            Managers run their own reports. Overdue tasks escalate to the person each member reports to.
          </p>
        </div>
        {isAdmin && (
          <button
            className="fd-btn-primary shrink-0 self-start"
            onClick={() => setAddOpen(true)}
          >
            <UserPlus className="h-4 w-4" />
            Add Member
          </button>
        )}
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Admins',        value: stats.admins,          bg: '#EDE9FE', color: '#7C3AED' },
          { label: 'Managers',      value: stats.managers,        bg: '#DBEAFE', color: '#1D4ED8' },
          { label: 'Employees',     value: stats.employees,       bg: '#F3F4F6', color: '#374151' },
          { label: 'Active Tasks',  value: stats.activeTaskCount, bg: '#DCFCE7', color: '#166534' },
        ].map(({ label, value, bg, color }) => (
          <div key={label} className="fd-card p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: bg }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">{label}</p>
              <p className="text-xl font-bold text-[#111827] leading-none mt-0.5">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Admin view: three bands. Others: their own branch as a tree. */}
      {isAdmin ? (
        <div className="space-y-6">
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Crown className="h-4 w-4 text-[#6D28D9]" />
              <p className="text-xs font-semibold uppercase tracking-widest text-[#6D28D9]">Admins</p>
              <p className="text-xs text-[#9CA3AF]">· manage everyone, assign to anyone — including each other</p>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {org.admins.map((u) => (
                <PersonRow key={u.id} user={u} isAdmin={isAdmin} onEdit={setEditTarget} nest={false} />
              ))}
            </div>
          </section>

          {org.managers.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4 text-[#1D4ED8]" />
                <p className="text-xs font-semibold uppercase tracking-widest text-[#1D4ED8]">Managers</p>
                <p className="text-xs text-[#9CA3AF]">· each with their own reports</p>
              </div>
              <div className="space-y-3">
                {org.managers.map((m) => (
                  <PersonRow key={m.id} user={m} isAdmin={isAdmin} onEdit={setEditTarget} />
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-[#374151]" />
              <p className="text-xs font-semibold uppercase tracking-widest text-[#374151]">Team</p>
              <p className="text-xs text-[#9CA3AF]">· {org.team.length} member{org.team.length !== 1 ? 's' : ''}, reporting to the admins</p>
            </div>
            {org.team.length === 0 ? (
              <div className="fd-card p-6 text-sm text-[#9CA3AF] text-center">No team members yet — use Add Member.</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {org.team.map((u) => (
                  <PersonRow key={u.id} user={u} depth={1} isAdmin={isAdmin} onEdit={setEditTarget} nest={false} />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="space-y-3">
          {root && (
            <PersonRow user={root} isAdmin={isAdmin} onEdit={setEditTarget} />
          )}
        </div>
      )}
    </div>
  );
}
