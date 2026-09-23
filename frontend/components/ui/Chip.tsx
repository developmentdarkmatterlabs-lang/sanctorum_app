import type { ButtonHTMLAttributes } from 'react';

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

/** Small monospace toggle button used across the top bar. */
export default function Chip({ active = false, className = '', ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={[
        'cursor-pointer rounded border px-2 py-[3px] font-mono text-[11px] transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]',
        active
          ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
          : 'border-[var(--border-primary)] text-[var(--content-secondary)] hover:border-[var(--accent-secondary)] hover:text-[var(--content-primary)]',
        'bg-[var(--surface-tertiary)]',
        'disabled:cursor-default disabled:opacity-40',
        className,
      ].join(' ')}
      {...props}
    />
  );
}
