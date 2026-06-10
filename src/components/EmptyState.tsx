import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type EmptyStateProps = {
  icon?: LucideIcon;
  iconClassName?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Optional actions rendered under the description. */
  children?: ReactNode;
  className?: string;
};

// Standard empty/idle state: glass panel, soft gold icon, serif message.
export default function EmptyState({
  icon: Icon,
  iconClassName,
  title,
  description,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('glass-panel px-6 py-20 text-center', className)}>
      {Icon && (
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]">
          <Icon className={cn('h-7 w-7 stroke-[1.75] text-[var(--lux-gold)]', iconClassName)} />
        </div>
      )}
      <p className="font-display text-2xl font-semibold text-[var(--lux-text)]">{title}</p>
      {description && (
        <p className="mx-auto mt-3 max-w-xl text-sm text-[var(--lux-muted)]">{description}</p>
      )}
      {children && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{children}</div>}
    </div>
  );
}
