import React from 'react';

export default function PageHeader({ eyebrow, title, italic, subtitle, right }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between px-2 mb-4">
      <div className="max-w-2xl">
        {eyebrow && (
          <p className="text-xs font-medium text-navy-600 dark:text-accent-violet mb-1.5">{eyebrow}</p>
        )}
        <h1 className="text-[22px] font-semibold tracking-tight text-navy-800 dark:text-ink-50">
          {title}{italic ? ` ${italic}` : ''}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
