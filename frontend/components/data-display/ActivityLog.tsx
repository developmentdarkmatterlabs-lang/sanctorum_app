import { useEffect, useRef } from 'react';
import type { LogEntry } from '@/lib/office/types';

export default function ActivityLog({ entries }: { entries: LogEntry[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div
      ref={ref}
      role="log"
      aria-live="polite"
      className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2 font-mono text-[11px] leading-[1.7] text-[var(--content-secondary)]"
    >
      {entries.map((entry) => (
        <div key={entry.id}>
          <span className="text-[var(--content-tertiary)]">{entry.time}</span>{' '}
          <b className="font-semibold text-[var(--content-primary)]">{entry.name}</b>{' '}
          {entry.message}
        </div>
      ))}
    </div>
  );
}
