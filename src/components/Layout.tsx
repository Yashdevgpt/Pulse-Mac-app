import { Link, Outlet, useLocation } from 'react-router-dom';
import { Activity, BookOpen, Brain, LayoutDashboard, Radio, LogOut, ShieldAlert, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/sonner';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { db, AppUser } from '@/lib/db';
import { Button } from '@/components/ui/button';
import ThemeToggle from '@/components/ThemeToggle';

export default function Layout() {
  const location = useLocation();
  const user = auth.currentUser;
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  
  useEffect(() => {
    if (user) {
      db.getUserAccess(user).then(setAppUser);
    }
  }, [user]);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname]);

  const isAdmin = appUser?.status === 'admin';

  const navigation = [
    { name: 'Bridge', href: '/', icon: LayoutDashboard },
    { name: 'Fleet', href: '/fleet', icon: BookOpen },
    { name: 'Brain', href: '/brain', icon: Brain },
    { name: 'Watchtower', href: '/watchtower', icon: Radio },
  ];

  if (isAdmin) {
    navigation.push({ name: 'Admin', href: '/admin', icon: ShieldAlert });
  }

  return (
    <div className="min-h-screen bg-[var(--color-neo-bg)] text-[var(--color-neo-text)] lg:flex lg:h-screen lg:min-h-0 lg:overflow-hidden">
      {isMobileNavOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/45 lg:hidden"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col border-r-4 border-black bg-[var(--color-neo-surface)] shadow-[4px_0px_0px_0px_rgba(0,0,0,1)] transition-transform duration-200 lg:static lg:w-64 lg:max-w-none lg:translate-x-0',
          isMobileNavOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b-4 border-black bg-[var(--color-neo-yellow)] px-6">
          <div className="flex items-center">
            <Activity className="mr-3 h-8 w-8 text-black stroke-[3]" />
            <span className="text-2xl font-black uppercase tracking-tight text-black">Pulse</span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="neo-btn bg-transparent lg:hidden"
            onClick={() => setIsMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4 stroke-[3]" />
          </Button>
        </div>

        <div className="px-4 pt-4">
          <ThemeToggle className="hidden w-full justify-center lg:inline-flex" />
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

        <div className="border-t-4 border-black bg-[var(--color-neo-pink)] p-4">
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

      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <header className="sticky top-0 z-20 border-b-4 border-black bg-[var(--color-neo-surface)] lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Button
              variant="ghost"
              size="icon"
              className="neo-btn bg-[var(--color-neo-surface)]"
              onClick={() => setIsMobileNavOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5 stroke-[3]" />
            </Button>
            <div className="flex min-w-0 items-center gap-2">
              <Activity className="h-5 w-5 flex-shrink-0 text-black stroke-[3]" />
              <span className="truncate text-sm font-black uppercase tracking-tight text-black">Pulse</span>
            </div>
            <ThemeToggle showLabel={false} className="px-2.5" />
          </div>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
