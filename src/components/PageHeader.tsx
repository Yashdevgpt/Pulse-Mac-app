import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type PageHeaderProps = {
  icon: LucideIcon;
  /** Optional override for the icon tile, e.g. a different tint. */
  iconClassName?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned slot for page-level actions (search, export, ...). */
  actions?: ReactNode;
  /** One-line header: small icon tile, title and subtitle on a single row. */
  compact?: boolean;
  className?: string;
};

// Standard page header: gold glass icon tile + serif display title +
// subtitle, with an optional actions slot. Every page uses this so the top
// of the app keeps the same rhythm everywhere.
export default function PageHeader({
  icon: Icon,
  iconClassName,
  title,
  subtitle,
  actions,
  compact = false,
  className,
}: PageHeaderProps) {
  if (compact) {
    return (
      <div className={cn('mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]',
              iconClassName
            )}
          >
            <Icon className="h-5 w-5 stroke-[1.75] text-[var(--lux-gold)]" />
          </div>
          <h1 className="font-display min-w-0 max-w-full truncate text-2xl font-semibold tracking-tight text-[var(--lux-text)]">
            {title}
          </h1>
          {subtitle && (
            <p
              className="hidden min-w-0 truncate text-sm text-[var(--lux-muted)] md:block"
              title={typeof subtitle === 'string' ? subtitle : undefined}
            >
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
    );
  }

  return (
    <div className={cn('mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="flex min-w-0 items-start gap-4">
        <div
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)] shadow-[0_10px_26px_-12px_var(--lux-gold-glow)]',
            iconClassName
          )}
        >
          <Icon className="h-6 w-6 stroke-[1.75] text-[var(--lux-gold)]" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[var(--lux-text)] sm:text-4xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1.5 max-w-2xl text-sm text-[var(--lux-muted)] sm:text-base">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}
