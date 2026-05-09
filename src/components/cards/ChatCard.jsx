import React from 'react';
import { Play } from 'lucide-react';
import Avatar from '../Avatar.jsx';
import { findUser } from '../../data/mockData.js';

function Waveform({ bars = 28 }) {
  return (
    <div className="flex items-center gap-[3px] h-5">
      {Array.from({ length: bars }).map((_, i) => {
        const h = 3 + ((i * 37) % 18);
        return <span key={i} className="w-[2px] rounded-full bg-navy-700/60 dark:bg-ink-200/60" style={{ height: `${h}px` }} />;
      })}
    </div>
  );
}

export default function ChatCard({ onSeeAll }) {
  const sender = findUser('U102'); // Sneha
  const me     = findUser('U001'); // Aarav

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="section-title">Chat</h2>
        <button onClick={onSeeAll} className="see-all">See All</button>
      </div>

      <div className="space-y-4">
        {/* outgoing text */}
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-500 dark:text-ink-400">{me?.name?.split(' ')[0]} {me?.name?.split(' ')[1]}</span>
            <Avatar user={me} size="sm" />
          </div>
          <div className="rounded-2xl rounded-tr-sm bg-pastel-purple px-3.5 py-2 text-sm text-navy-800 max-w-[80%]">
            Hello, can you check the latest work?
          </div>
          <span className="num text-[10px] text-ink-400">12:20</span>
        </div>

        {/* incoming voice note */}
        <div className="flex flex-col items-start gap-1.5">
          <div className="flex items-center gap-2">
            <Avatar user={sender} size="sm" />
            <span className="text-xs text-ink-500 dark:text-ink-400">{sender?.name?.split(' ')[0]}</span>
          </div>
          <div className="rounded-2xl rounded-tl-sm bg-pastel-peach px-3 py-2 flex items-center gap-3 max-w-[85%]">
            <button className="h-8 w-8 rounded-full bg-white grid place-items-center text-orange-500 shadow-soft">
              <Play className="h-3.5 w-3.5 fill-current" />
            </button>
            <Waveform />
            <span className="num text-xs text-navy-800/80">00:41</span>
          </div>
          <span className="num text-[10px] text-ink-400">12:20</span>
        </div>
      </div>
    </div>
  );
}
