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
      'min-h-screen bg-[var(--color-neo-bg)] text-[var(--color-neo-text)] lg:flex lg:h-screen lg:min-h-0 lg:overflow-hidden',
      isNavOpen ? 'pulse-nav-open' : 'pulse-nav-closed'
    )}>
      {isNavOpen && (
        <aside className="flex w-full shrink-0 flex-col border-r-4 border-black bg-[var(--color-neo-surface)] shadow-[4px_0px_0px_0px_rgba(0,0,0,1)] lg:w-64">
          <div className="app-drag flex h-16 items-center justify-between gap-3 border-b-4 border-black bg-[var(--color-neo-yellow)] px-5">
            <Link
              to="/"
              className="app-no-drag flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 pr-2 text-black transition-transform hover:translate-x-[1px] hover:translate-y-[1px]"
              aria-label="Go to Bridge"
            >
              <Activity className="h-8 w-8 shrink-0 text-black stroke-[3]" />
              <span className="truncate text-2xl font-black uppercase tracking-tight text-black">Pulse</span>
            </Link>
            <Button
              variant="ghost"
              size="icon-sm"
              className="app-no-drag neo-btn shrink-0 bg-[var(--color-neo-yellow)]"
              onClick={() => setIsNavOpen(false)}
              aria-label="Close navigation"
            >
              <X className="h-4 w-4 stroke-[3]" />
            </Button>
          </div>

          <div className="px-4 pt-4">
            <ThemeToggle className="w-full justify-center" />
          </div>

          <nav className="flex-1 space-y-2 px-4 py-4">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={cn(
                    'group flex items-center rounded-xl border-3 px-4 py-3 text-sm font-bold transition-all',
                    isActive
                      ? 'translate-x-[2px] translate-y-[2px] border-black bg-[var(--color-neo-cyan)] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                      : 'border-transparent text-zinc-600 hover:bg-zinc-100 hover:text-black'
                  )}
                >
                  <item.icon
                    className={cn(
                      isActive ? 'text-black' : 'text-zinc-500 group-hover:text-black',
                      'mr-3 h-5 w-5 flex-shrink-0 -ml-1 stroke-[2.5] transition-colors'
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t-4 border-black bg-[var(--color-neo-violet)] p-4">
            <div className="neo-box flex items-center justify-between bg-[var(--color-neo-surface)] p-3">
              <div className="flex min-w-0 items-center">
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="Avatar" className="h-9 w-9 rounded-lg border-2 border-black" referrerPolicy="no-referrer" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-black bg-black text-sm font-bold text-white">
                    {appUser?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
                  </div>
                )}
                <div className="ml-3 min-w-0">
                  <p className="truncate text-sm font-bold text-black">{appUser?.name || user?.email?.split('@')[0] || 'User'}</p>
                  <p className="truncate text-xs font-medium text-zinc-600">{user?.email}</p>
                </div>
              </div>
              <button onClick={() => signOut(auth)} className="rounded-md p-1 text-black transition-transform hover:scale-110 hover:text-red-600" aria-label="Sign out">
                <LogOut className="h-5 w-5 stroke-[3]" />
              </button>
            </div>
          </div>
        </aside>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        {!isNavOpen && (
          <header className="app-drag border-b-4 border-black bg-[var(--color-neo-surface)]">
            <div className="flex items-center justify-between gap-3 px-4 py-3 lg:pl-20">
              <Button
                variant="ghost"
                size="icon"
                className="app-no-drag neo-btn bg-[var(--color-neo-surface)]"
                onClick={() => setIsNavOpen(true)}
                aria-expanded={false}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5 stroke-[3]" />
              </Button>
              <Link
                to="/"
                className="app-no-drag flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-black transition-transform hover:translate-x-[1px] hover:translate-y-[1px]"
                aria-label="Go to Bridge"
              >
                <Activity className="h-5 w-5 flex-shrink-0 text-black stroke-[3]" />
                <span className="truncate text-sm font-black uppercase tracking-tight text-black">Pulse</span>
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
