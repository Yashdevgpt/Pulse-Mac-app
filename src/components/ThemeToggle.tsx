import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ThemeToggleProps = {
  className?: string;
  showLabel?: boolean;
};

export default function ThemeToggle({ className, showLabel = true }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <Button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'glass-btn h-11 px-4 py-2',
        className,
      )}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <Sun className="h-4 w-4 stroke-[1.75] text-[var(--lux-gold)]" />
      ) : (
        <Moon className="h-4 w-4 stroke-[1.75] text-[var(--lux-gold)]" />
      )}
      {showLabel && <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>}
    </Button>
  );
}
