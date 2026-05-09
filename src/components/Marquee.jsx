import React from 'react';

/**
 * Infinite horizontal ticker. Pass items as an array of nodes.
 * Renders the list twice and uses the .marquee-track CSS animation.
 */
export default function Marquee({ items, className = '' }) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div className="absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-white dark:from-ink-950 to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-white dark:from-ink-950 to-transparent z-10 pointer-events-none" />
      <div className="marquee-track py-2">
        {[...items, ...items].map((node, i) => (
          <div key={i} className="flex items-center gap-2 whitespace-nowrap text-sm">
            {node}
          </div>
        ))}
      </div>
    </div>
  );
}
