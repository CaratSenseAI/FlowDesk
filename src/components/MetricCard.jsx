import React from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

const ICON_TONES = {
  brand:   'text-brand-600 bg-brand-50 dark:bg-brand-500/10 dark:text-brand-300',
  emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300',
  rose:    'text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-300',
  amber:   'text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300',
  sky:     'text-sky-600 bg-sky-50 dark:bg-sky-500/10 dark:text-sky-300',
};

function Sparkline({ values = [4, 7, 5, 9, 6, 11, 8, 13, 12], stroke = '#4f46e5' }) {
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const w = 120, h = 28;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function MetricCard({ label, value, suffix, delta, icon: Icon, tone = 'brand', spark, kicker }) {
  const tone_cls = ICON_TONES[tone] || ICON_TONES.brand;
  const stroke = { brand:'#4f46e5', emerald:'#059669', rose:'#e11d48', amber:'#d97706', sky:'#0284c7' }[tone];
  const isUp = (delta ?? 0) >= 0;

  return (
    <div className="card p-5 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-ink-500 dark:text-ink-400">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-ink-900 dark:text-ink-50 tabular-nums">
            {value}
            {suffix && <span className="text-base font-medium text-ink-500 dark:text-ink-400 ml-0.5">{suffix}</span>}
          </p>
          {kicker && <p className="text-[11px] text-ink-500 dark:text-ink-400 mt-1">{kicker}</p>}
        </div>
        {Icon && (
          <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${tone_cls}`}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        {delta !== undefined ? (
          <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isUp ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
            {isUp ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {Math.abs(delta)}%
            <span className="text-ink-400 dark:text-ink-500 font-normal ml-1">vs last week</span>
          </span>
        ) : <span />}
        {spark && (
          <div className="w-24 opacity-70">
            <Sparkline values={spark} stroke={stroke} />
          </div>
        )}
      </div>
    </div>
  );
}
