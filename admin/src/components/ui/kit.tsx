'use client';

/**
 * The panel's primitives — small enough to read in one sitting, styled once
 * here so pages never re-derive focus rings, radii, or the "primary =
 * brand-gradient" rule.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/util';
import { roleLabel } from '@/lib/roles';

/* ------------------------------------------------------------------ panel */

export function Panel({
  children,
  className,
  lit = true,
}: {
  children: ReactNode;
  className?: string;
  /** Top-edge highlight — on by default, off for nested/quiet surfaces. */
  lit?: boolean;
}) {
  return (
    <div className={cn('panel', lit && 'edge-lit', className)}>{children}</div>
  );
}

/* ----------------------------------------------------------------- button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'whatsapp';

const BUTTON_TONES: Record<ButtonVariant, string> = {
  // The ONE primary action per view wears the gradient; everything else stays
  // on the quiet ink ladder so hierarchy survives a glance.
  primary:
    'brand-gradient text-white shadow-[0_12px_32px_-14px_rgb(99_102_241/0.85)] hover:brightness-110',
  secondary:
    'border border-line-strong bg-ink-800 text-mist-200 hover:border-brand-400/50 hover:text-mist-50',
  ghost: 'text-mist-400 hover:bg-white/5 hover:text-mist-50',
  danger:
    'border border-signal-rose/30 bg-signal-rose/10 text-signal-rose hover:bg-signal-rose/20',
  whatsapp: 'border border-[#25D366]/35 bg-[#25D366]/12 text-[#25D366] hover:bg-[#25D366]/20',
};

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45 active:scale-[0.98]',
        BUTTON_TONES[variant],
        className
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------- chip */

export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-all duration-150',
        active
          ? 'border-brand-400/60 bg-brand-500/15 text-brand-400 shadow-[0_0_24px_-8px_rgb(99_102_241/0.6)]'
          : 'border-line bg-white/[0.03] text-mist-400 hover:border-line-strong hover:text-mist-200',
        className
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ badge */

const ROLE_TONES: Record<string, string> = {
  developer: 'bg-violet-400/12 text-violet-400 border-violet-400/30',
  superAdmin: 'bg-brand-500/15 text-brand-400 border-brand-400/35',
  admin: 'bg-signal-sky/10 text-signal-sky border-signal-sky/30',
  karykarta: 'bg-signal-emerald/10 text-signal-emerald border-signal-emerald/30',
};

export function RoleBadge({ role }: { role: string | null }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide',
        ROLE_TONES[role ?? ''] ?? 'border-line bg-white/[0.03] text-mist-400'
      )}
    >
      {roleLabel(role)}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tones: Record<string, string> = {
    pending: 'bg-signal-amber/10 text-signal-amber border-signal-amber/30',
    in_progress: 'bg-signal-sky/10 text-signal-sky border-signal-sky/30',
    completed: 'bg-signal-emerald/10 text-signal-emerald border-signal-emerald/30',
    issue: 'bg-signal-rose/10 text-signal-rose border-signal-rose/30',
    voted: 'bg-signal-emerald/10 text-signal-emerald border-signal-emerald/30',
    notVoted: 'bg-signal-rose/10 text-signal-rose border-signal-rose/30',
    unknown: 'bg-white/[0.04] text-mist-400 border-line',
    right: 'bg-brand-500/12 text-brand-400 border-brand-400/30',
    centerRight: 'bg-brand-400/10 text-brand-400 border-brand-400/25',
    center: 'bg-white/[0.05] text-mist-200 border-line-strong',
    centerLeft: 'bg-violet-400/10 text-violet-400 border-violet-400/25',
    left: 'bg-violet-400/12 text-violet-400 border-violet-400/30',
  };
  const label = status.replace(/_/g, ' ');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize',
        tones[status] ?? 'border-line bg-white/[0.03] text-mist-400'
      )}
    >
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ forms */

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-mist-600">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-mist-600">{hint}</span> : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-line bg-ink-900/80 px-3.5 py-2.5 text-sm text-mist-50 placeholder:text-mist-600 transition-colors focus:border-brand-400/60 focus:bg-ink-900';

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(CONTROL, className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(CONTROL, 'appearance-none bg-ink-800', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(CONTROL, 'min-h-[76px] resize-y', className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ state */

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      {icon ? (
        <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-line bg-white/[0.03] text-mist-600">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-mist-200">{title}</p>
      {detail ? <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-mist-600">{detail}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden />;
}

/** An avatar disc showing initials — deterministic hue by identity seed. */
export function Initials({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '?')
      .join('') || '?';
  const sizes = {
    sm: 'size-7 text-[10px]',
    md: 'size-9 text-xs',
    lg: 'size-12 text-sm',
  } as const;
  // Seeded from the name so the same person keeps their colour everywhere.
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return (
    <span
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold text-white/90 ring-1 ring-white/15',
        sizes[size]
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 42) % 360} 60% 32%))`,
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}