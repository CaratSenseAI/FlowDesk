import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, subtitle, children, footer, maxWidth = 'max-w-2xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6">
      <div className="absolute inset-0 bg-ink-950/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className={`relative w-full ${maxWidth} card p-0 max-h-[92vh] flex flex-col animate-pop-in`}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-ink-200 dark:border-white/[.06]">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-ink-900 dark:text-ink-50 truncate">{title}</h3>
            {subtitle && <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost h-8 w-8 p-0 justify-center"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-ink-200 dark:border-white/[.06] bg-ink-50/60 dark:bg-white/[.02] rounded-b-xl flex flex-wrap items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
