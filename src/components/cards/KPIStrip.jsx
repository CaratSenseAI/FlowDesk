import React from 'react';
import { TrendingUp, TrendingDown, Activity, CheckCircle2, Timer, ShieldAlert } from 'lucide-react';
import { isOverdue } from '../../data/mockData.js';

function Sparkline({ values, stroke = '#2c1f5b' }) {
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const w = 90, h = 28;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = values[values.length - 1];
  const lastY = h - ((last - min) / range) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={w} cy={lastY} r="2" fill={stroke} />
    </svg>
  );
}

function Tile({ label, value, suffix, delta, icon: Icon, accent, spark, sparkColor, kicker }) {
  const isUp = (delta ?? 0) >= 0;
  return (
    <div className="kpi">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-ink-500 dark:text-neutral-400 uppercase tracking-wide">{label}</p>
          <p className="num mt-1.5 text-[26px] leading-none font-semibold text-navy-800 dark:text-white">
            {value}{suffix && <span className="text-base font-medium text-ink-500 dark:text-neutral-400 ml-0.5">{suffix}</span>}
          </p>
        </div>
        <span className={`shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="flex items-end justify-between gap-3 mt-1">
        <div className="flex flex-col gap-0.5">
          {delta !== undefined && (
            <span className={`inline-flex items-center gap-1 text-xs font-medium ${isUp ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
              {isUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {Math.abs(delta)}%
            </span>
          )}
          {kicker && <span className="text-[11px] text-ink-500 dark:text-neutral-400">{kicker}</span>}
        </div>
        {spark && <div className="w-20 opacity-80"><Sparkline values={spark} stroke={sparkColor} /></div>}
      </div>
    </div>
  );
}

export default function KPIStrip({ tasks }) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'Done').length;
  const completion = total ? Math.round((done / total) * 100) : 0;

  // On-time = done tasks where the latest "status" activity happened on/before deadline
  const doneTasks = tasks.filter((t) => t.status === 'Done');
  const onTimeCount = doneTasks.filter((t) => {
    const lastStatus = [...(t.activity || [])].reverse().find((a) => a.type === 'status');
    const closedAt = lastStatus ? new Date(lastStatus.at).getTime() : Date.now();
    return closedAt <= new Date(t.deadline).getTime();
  }).length;
  const onTimePct = doneTasks.length ? Math.round((onTimeCount / doneTasks.length) * 100) : 0;

  // Average cycle time (created → first status update) in days
  const cycleSamples = tasks.map((t) => {
    const start = new Date(t.createdAt).getTime();
    const closed = (t.activity || []).find((a) => a.type === 'status');
    const end = closed ? new Date(closed.at).getTime() : Date.now();
    return Math.max(0, (end - start) / (1000 * 60 * 60 * 24));
  });
  const avgCycle = cycleSamples.length ? (cycleSamples.reduce((a, b) => a + b, 0) / cycleSamples.length) : 0;

  const overdueCount = tasks.filter(isOverdue).length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Tile
        label="Active Tasks"      value={total}                     delta={12}
        icon={Activity}            accent="bg-pastel-purple text-violet-700"
        spark={[8,10,9,12,11,14,13,16,total]}  sparkColor="#7c3aed"
        kicker={`${tasks.filter(t=>t.status!=='Done').length} in motion`}
      />
      <Tile
        label="Completion Rate"    value={completion}      suffix="%" delta={4}
        icon={CheckCircle2}        accent="bg-pastel-mint text-emerald-700"
        spark={[42,48,55,52,60,64,68,72,completion]}  sparkColor="#059669"
        kicker={`${done} of ${total} closed`}
      />
      <Tile
        label="On-time Delivery"   value={onTimePct}       suffix="%" delta={onTimePct >= 75 ? 6 : -3}
        icon={Timer}               accent="bg-pastel-blue text-sky-700"
        spark={[68,70,74,72,78,80,76,82,onTimePct]}  sparkColor="#0284c7"
        kicker={`avg cycle ${avgCycle.toFixed(1)} d`}
      />
      <Tile
        label="Overdue / Escalated" value={overdueCount}              delta={-8}
        icon={ShieldAlert}         accent="bg-pastel-peach text-orange-700"
        spark={[6,5,7,4,5,3,4,2,overdueCount]}  sparkColor="#ea580c"
        kicker={`${tasks.filter(t=>t.escalationLevel>0).length} escalated`}
      />
    </div>
  );
}
