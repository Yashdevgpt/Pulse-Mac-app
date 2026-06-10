import { Link, Outlet, useLocation } from 'react-router-dom';
import { Activity, Archive, BookOpen, Brain, LayoutDashboard, Radio, LogOut, ShieldAlert, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { db, AppUser } from '@/lib/db';
import { Button } from '@/components/ui/button';
import ThemeToggle from '@/components/ThemeToggle';

const NAV_STORAGE_KEY = 'pulse:nav-open:v1';

export default function Layout() {
  const location = useLocation();
  const user = auth.currentUser;
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [isNavOpen, setIsNavOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(NAV_STORAGE_KEY) !== 'false';
  });

  useEffect(() => {
    if (user) {
      db.getUserAccess(user).then(setAppUser);
    }
  }, [user]);

  useEffect(() => {
    window.localStorage.setItem(NAV_STORAGE_KEY, String(isNavOpen));
  }, [isNavOpen]);

  const isAdmin = appUser?.status === 'admin';

  const navigation = [
    { name: 'Bridge', href: '/', icon: LayoutDashboard },
    { name: 'Fleet', href: '/fleet', icon: BookOpen },
    { name: 'Brain', href: '/brain', icon: Brain },
    { name: 'Watchtower', href: '/watchtower', icon: Radio },
    { name: 'Archive', href: '/archive', icon: Archive },
  ];

  if (isAdmin) {
    navigation.push({ name: 'Admin', href: '/admin', icon: ShieldAlert });
  }

  return (
    <div className={cn(
      'min-h-screen text-[var(--lux-text)] lg:flex lg:h-screen lg:min-h-0 lg:overflow-hidden',
      isNavOpen ? 'pulse-nav-open' : 'pulse-nav-closed'
    )}>
      {isNavOpen && (
        <aside className="glass-strong flex w-full shrink-0 flex-col border-0 border-r border-[var(--lux-border)] lg:w-64">
          <div className="app-drag flex h-16 items-center justify-between gap-3 border-b border-[var(--lux-border)] px-5">
            <Link
              to="/"
              className="app-no-drag flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 pr-2 transition-opacity hover:opacity-80"
              aria-label="Go to Bridge"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]">
                <Activity className="h-5 w-5 stroke-[1.75] text-[var(--lux-gold)]" />
              </span>
              <span className="font-display truncate text-2xl font-semibold tracking-tight text-[var(--lux-text)]">Pulse</span>
            </Link>
            <Button
              variant="ghost"
              size="icon-sm"
              className="app-no-drag shrink-0 text-[var(--lux-muted)] hover:text-[var(--lux-text)]"
              onClick={() => setIsNavOpen(false)}
              aria-label="Close navigation"
            >
              <X className="h-4 w-4 stroke-[1.75]" />
            </Button>
          </div>

          <div className="px-4 pt-4">
            <ThemeToggle className="w-full justify-center" />
          </div>

          <nav className="flex-1 space-y-1.5 px-4 py-4">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={cn(
                    'group flex items-center rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                    isActive
                      ? 'border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)] text-[var(--lux-gold)] shadow-[0_8px_22px_-12px_var(--lux-gold-glow)]'
                      : 'border-transparent text-[var(--lux-muted)] hover:bg-[var(--lux-fill)] hover:text-[var(--lux-text)]'
                  )}
                >
                  <item.icon
                    className={cn(
                      isActive ? 'text-[var(--lux-gold)]' : 'text-[var(--lux-soft)] group-hover:text-[var(--lux-text)]',
                      'mr-3 h-5 w-5 flex-shrink-0 -ml-1 stroke-[1.75] transition-colors'
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-[var(--lux-border)] p-4">
            <div className="glass-panel flex items-center justify-between p-3">
              <div className="flex min-w-0 items-center">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="Avatar" className="h-9 w-9 rounded-full border border-[var(--lux-border-strong)]" referrerPolicy="no-referrer" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)] text-sm font-semibold text-[var(--lux-gold)]">
                    {appUser?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
                  </div>
                )}
                <div className="ml-3 min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--lux-text)]">{appUser?.name || user?.email?.split('@')[0] || 'User'}</p>
                  <p className="truncate text-xs text-[var(--lux-muted)]">{user?.email}</p>
                </div>
              </div>
              <button onClick={() => signOut(auth)} className="rounded-md p-1 text-[var(--lux-muted)] transition-colors hover:text-[var(--lux-ruby)]" aria-label="Sign out">
                <LogOut className="h-5 w-5 stroke-[1.75]" />
              </button>
            </div>
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        {!isNavOpen && (
          <header className="app-drag glass-strong border-0 border-b border-[var(--lux-border)]">
            <div className="flex items-center justify-between gap-3 px-4 py-3 lg:pl-20">
              <Button
                variant="ghost"
                size="icon"
                className="app-no-drag glass-btn"
                onClick={() => setIsNavOpen(true)}
                aria-expanded={false}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5 stroke-[1.75]" />
              </Button>
              <Link
                to="/"
                className="app-no-drag flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 transition-opacity hover:opacity-80"
                aria-label="Go to Bridge"
              >
                <Activity className="h-5 w-5 flex-shrink-0 stroke-[1.75] text-[var(--lux-gold)]" />
                <span className="font-display truncate text-base font-semibold tracking-tight text-[var(--lux-text)]">Pulse</span>
              </Link>
              <div className="h-11 w-11" aria-hidden="true" />
            </div>
          </header>
        )}

        <main className="min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
