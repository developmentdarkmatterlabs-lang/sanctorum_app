import Link from 'next/link';

type ExitLinkProps = {
  href: string;
  label?: string;
};

/** Way out of the office, back to wherever the user came from. */
export default function ExitLink({ href, label = 'Exit' }: ExitLinkProps) {
  return (
    <Link
      href={href}
      className="group -mx-1 flex min-h-[24px] items-center gap-1.5 rounded border border-[var(--border-primary)] bg-[var(--surface-tertiary)] px-2 py-[3px] font-mono text-[11px] text-[var(--content-secondary)] transition-colors hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent-primary)]"
    >
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="h-3 w-3 flex-none"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9.5 2.5H3.5v11h6" />
        <path d="M7 8h6.5M11 5.5L13.5 8 11 10.5" />
      </svg>
      {label}
    </Link>
  );
}
