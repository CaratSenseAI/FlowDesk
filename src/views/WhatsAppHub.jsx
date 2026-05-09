import React, { useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { findUser, isOverdue } from '../data/mockData.js';
import Avatar from '../components/Avatar.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { MessageCircle, Send, CheckCheck } from 'lucide-react';

const SAMPLE_THREAD = [
  { from: 'them', text: 'TSK-1044 — gateway is throwing 502 on bulk fetch. Looking now.', time: '09:14' },
  { from: 'me',   text: 'Thanks Karan. Try the failover endpoint, ping me if you need access.', time: '09:16' },
  { from: 'them', text: 'On it. ETA 30 mins.', time: '09:17' },
  { from: 'them', text: 'Done. Settlement queue is draining.', time: '09:51' },
];

export default function WhatsAppHub() {
  const { tasks } = useApp();
  const [activeId, setActiveId] = useState(tasks[0]?.id);
  const active = tasks.find((t) => t.id === activeId);
  const partner = active ? findUser(active.assignedTo) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="WhatsApp Hub"
        title="Live conversations"
        subtitle="Every task gets its own thread. Replies sync to status, comments, and escalations."
      />

      <div className="card overflow-hidden grid grid-cols-1 md:grid-cols-3 h-[68vh]">
        <aside className="border-r border-ink-200 dark:border-white/[.06] overflow-y-auto">
          <ul className="divide-y divide-ink-100 dark:divide-white/[.04]">
            {tasks.map((t) => {
              const u = findUser(t.assignedTo);
              const overdue = isOverdue(t);
              const isActive = t.id === activeId;
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setActiveId(t.id)}
                    className={`w-full flex items-start gap-3 px-3 py-3 text-left transition-colors ${isActive ? 'bg-ink-50 dark:bg-white/[.04]' : 'hover:bg-ink-50/60 dark:hover:bg-white/[.02]'}`}
                  >
                    <Avatar user={u} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-ink-900 dark:text-ink-50 truncate">{u?.name}</p>
                        <span className="num text-[10px] text-ink-400">{t.id}</span>
                      </div>
                      <p className="text-xs text-ink-500 dark:text-ink-400 truncate">{t.title}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        {overdue && <span className="chip bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">overdue</span>}
                        <span className="chip bg-ink-100 text-ink-700 dark:bg-white/[.06] dark:text-ink-200">{t.status}</span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <section className="md:col-span-2 flex flex-col bg-ink-50/50 dark:bg-white/[.01]">
          {active ? (
            <>
              <div className="flex items-center gap-3 px-4 py-3 border-b border-ink-200 dark:border-white/[.06] bg-white/80 dark:bg-neutral-900">
                <Avatar user={partner} size="md" />
                <div className="min-w-0">
                  <p className="font-medium text-ink-900 dark:text-ink-50">{partner?.name}</p>
                  <p className="num text-[11px] text-ink-500 dark:text-ink-400 inline-flex items-center gap-1">
                    <MessageCircle className="h-3 w-3 text-emerald-500" /> Thread for {active.id} · {active.title}
                  </p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {SAMPLE_THREAD.map((m, i) => (
                  <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${m.from === 'me' ? 'bg-brand-600 text-white rounded-br-md' : 'bg-white dark:bg-neutral-900 text-ink-800 dark:text-neutral-100 rounded-bl-md border border-ink-200 dark:border-white/[.06]'}`}>
                      {m.text}
                      <div className={`mt-1 num text-[10px] flex items-center gap-1 ${m.from === 'me' ? 'text-white/80 justify-end' : 'text-ink-400 dark:text-ink-500'}`}>
                        {m.time} {m.from === 'me' && <CheckCheck className="h-3 w-3" />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 border-t border-ink-200 dark:border-white/[.06] bg-white/80 dark:bg-neutral-900 flex items-center gap-2">
                <input className="input" placeholder={`Message ${partner?.name?.split(' ')[0]} on WhatsApp…`} />
                <button className="btn-success"><Send className="h-4 w-4" /> Send</button>
              </div>
            </>
          ) : (
            <div className="flex-1 grid place-items-center text-sm text-ink-500">Select a thread to see the conversation.</div>
          )}
        </section>
      </div>
    </div>
  );
}
