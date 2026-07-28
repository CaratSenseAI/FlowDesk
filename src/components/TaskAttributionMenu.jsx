import React, { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';

const STATUS_TONE = {
  Done:    'bg-[#DCFCE7] text-[#166534]',
  Issue:   'bg-[#FEF2F2] text-[#B91C1C]',
  Delay:   'bg-[#FEF3C7] text-[#92400E]',
  Pending: 'bg-[#EFF6FF] text-[#1D4ED8]',
};

/**
 * Pick which task a message belongs to.
 *
 * Two entry points: an ambiguous message the system refused to guess at, and
 * correcting one it got wrong. Both matter — the whole reason messages can be
 * unattributed is that a wrong guess is worse than no guess, which only holds
 * if a human can resolve it in one click.
 */
export default function TaskAttributionMenu({ tasks, currentTaskId, onPick, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    // Deferred so the click that opened the menu doesn't immediately close it.
    const id = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onEsc);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-30 top-6 left-0 w-72 rounded-xl border border-[#E5E7EB] bg-white shadow-lg overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-[#F3F4F6] flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
          Link this message to
        </p>
        <button onClick={onClose} className="text-[#9CA3AF] hover:text-[#374151]">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ul className="max-h-56 overflow-y-auto thin-scrollbar divide-y divide-[#F9FAFB]">
        {tasks.length === 0 && (
          <li className="px-3 py-3 text-xs text-[#9CA3AF]">This person has no tasks.</li>
        )}
        {tasks.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => onPick(t.id)}
              className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-[#F9FAFB] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="num text-[11px] font-semibold text-[#4338CA]">{t.id}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${STATUS_TONE[t.status] ?? STATUS_TONE.Pending}`}>
                    {t.status}
                  </span>
                </div>
                <p className="text-xs text-[#374151] truncate mt-0.5">{t.title}</p>
              </div>
              {t.id === currentTaskId && <Check className="h-3.5 w-3.5 text-[#22C55E] shrink-0 mt-0.5" />}
            </button>
          </li>
        ))}
      </ul>

      {currentTaskId && (
        <button
          onClick={() => onPick(null)}
          className="w-full px-3 py-2.5 text-left text-xs text-[#6B7280] hover:bg-[#F9FAFB]
                     border-t border-[#F3F4F6] transition-colors"
        >
          Unlink from any task
        </button>
      )}
    </div>
  );
}
