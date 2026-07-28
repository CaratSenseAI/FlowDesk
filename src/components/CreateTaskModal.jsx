import React, { useState, useRef } from 'react';
import Modal from './Modal.jsx';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

/** Marks a field the form won't submit without. */
const Req = () => <span className="text-[#EF4444] ml-0.5" title="Required">*</span>;

const inputCls = (invalid) =>
  `fd-input${invalid ? ' border-[#EF4444] ring-1 ring-[#EF4444]' : ''}`;

export default function CreateTaskModal({ open, onClose }) {
  const { users, role, activeUser, addTask } = useApp();
  const [title,      setTitle]      = useState('');
  const [description,setDescription]= useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [priority,   setPriority]   = useState('Medium');
  const [deadline,   setDeadline]   = useState(
    () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [fields, setFields] = useState([{ key: 'Channel', value: 'WhatsApp' }]);
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState(null);
  const refs = { title: useRef(null), assignedTo: useRef(null), deadline: useRef(null) };

  const eligibleAssignees = users.filter((u) => {
    if (role === 'Admin')   return u.role !== 'Admin';
    if (role === 'Manager') return u.reportingTo === activeUser?.id;
    return false;
  });

  const reset = () => {
    setTitle(''); setDescription(''); setAssignedTo(''); setPriority('Medium');
    setDeadline(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
    setFields([{ key: 'Channel', value: 'WhatsApp' }]);
    setError(''); setInvalidField(null);
  };

  const fail = (field, message) => {
    setInvalidField(field);
    setError(message);
    refs[field]?.current?.focus();
  };

  const submit = (e) => {
    e.preventDefault();
    setError('');
    setInvalidField(null);

    // Validated with a message rather than a disabled button — a dead button
    // gives no clue which field is missing.
    if (!title.trim())  return fail('title', 'Give the task a title.');
    if (!assignedTo)    return fail('assignedTo', 'Choose who this task is for.');
    if (!deadline)      return fail('deadline', 'Set a deadline.');
    const customFields = fields.reduce(
      (acc, f) => (f.key ? { ...acc, [f.key]: f.value } : acc),
      {}
    );
    addTask({
      title, description, assignedTo, priority,
      assignedBy: activeUser.id,
      status: 'Pending',
      deadline: new Date(deadline + 'T17:00:00').toISOString(),
      customFields,
    });
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create new task"
      subtitle="Send to a teammate — they'll get a WhatsApp notification instantly."
      maxWidth="max-w-2xl"
      footer={
        <>
          <button className="fd-btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="fd-btn-primary"
            onClick={submit}
            disabled={false}
          >
            <Plus className="h-4 w-4" /> Create Task
          </button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[11px] text-[#9CA3AF]">Fields marked <Req /> are required.</p>

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-100">
            <span className="text-[#EF4444] mt-0.5 shrink-0">⚠</span>
            <p className="text-xs font-medium text-[#B91C1C]">{error}</p>
          </div>
        )}

        <div>
          <label className="label">Title<Req /></label>
          <input
            ref={refs.title}
            className={inputCls(invalidField === 'title')}
            value={title}
            onChange={(e) => { setTitle(e.target.value); setInvalidField(null); }}
            placeholder="e.g. Reconcile failed refunds"
          />
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            rows={3}
            className="fd-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Provide context, links, or expectations…"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Assignee<Req /></label>
            <select
              ref={refs.assignedTo}
              className={inputCls(invalidField === 'assignedTo')}
              value={assignedTo}
              onChange={(e) => { setAssignedTo(e.target.value); setInvalidField(null); }}
            >
              <option value="">Select…</option>
              {eligibleAssignees.map((u) => (
                <option key={u.id} value={u.id}>{u.name} — {u.role}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Priority</label>
            <select
              className="fd-input"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
            </select>
          </div>
          <div>
            <label className="label">Deadline<Req /></label>
            <input
              ref={refs.deadline}
              type="date"
              className={inputCls(invalidField === 'deadline')}
              value={deadline}
              onChange={(e) => { setDeadline(e.target.value); setInvalidField(null); }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label !mb-0">Custom Fields</label>
            <button
              type="button"
              onClick={() => setFields((f) => [...f, { key: '', value: '' }])}
              className="text-xs font-semibold text-[#1E1B3A] hover:underline inline-flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Add Field
            </button>
          </div>
          <div className="space-y-2">
            {fields.map((f, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input
                  className="fd-input col-span-4"
                  placeholder="Key (e.g. Region)"
                  value={f.key}
                  onChange={(e) =>
                    setFields((arr) => arr.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
                  }
                />
                <input
                  className="fd-input col-span-7"
                  placeholder="Value"
                  value={f.value}
                  onChange={(e) =>
                    setFields((arr) => arr.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  onClick={() => setFields((arr) => arr.filter((_, j) => j !== i))}
                  className="col-span-1 flex items-center justify-center w-9 h-9 rounded-full text-[#9CA3AF] hover:text-[#B91C1C] hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}
