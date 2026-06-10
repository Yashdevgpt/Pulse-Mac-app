import React, { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, User } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Activity, LogOut, KeyRound, Mail } from 'lucide-react';
import { db } from '@/lib/db';
import { syncAiKeysFromServer } from '@/lib/aiKeys';
import { toast } from 'sonner';
import ThemeToggle from '@/components/ThemeToggle';

// Configure via VITE_BOOTSTRAP_ADMIN_EMAIL. Fallback preserves existing
// production deployments. Must match the value in src/lib/db.ts and firestore.rules.
const BOOTSTRAP_ADMIN_EMAIL = (
  import.meta.env.VITE_BOOTSTRAP_ADMIN_EMAIL || 'sagargpt23@gmail.com'
).trim().toLowerCase();

export function AuthWrapper({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessStatus, setAccessStatus] = useState<'pending' | 'approved' | 'admin' | 'rejected' | null>(null);

  // Login Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Restore AI keys from the on-disk store (survives app restarts,
        // unlike localStorage whose origin changes with the server port).
        void syncAiKeysFromServer().catch((error) => {
          console.warn('Could not restore AI keys from local store:', error);
        });
        try {
          const access = await db.getUserAccess(currentUser);
          setAccessStatus(access.status);
        } catch (error) {
          console.error("Error checking access:", error);
          setAccessStatus('pending');
        }
      } else {
        setAccessStatus(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      toast.error('Please enter both email and password.');
      return;
    }
    setIsSubmitting(true);
    try {
      // First try to sign in
      await signInWithEmailAndPassword(auth, normalizedEmail, password);
    } catch (error: any) {
      console.error("Error signing in", error);
      
      if (normalizedEmail === BOOTSTRAP_ADMIN_EMAIL) {
        toast.error('Admin sign-in failed. Check the password or use Forgot Password.');
        return;
      }

      // If the user doesn't exist, create them!
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found') {
        try {
          toast.info('Account not found. Creating a new account...');
          await createUserWithEmailAndPassword(auth, normalizedEmail, password);
          toast.success('Account created successfully!');
        } catch (createError: any) {
          console.error("Error creating user", createError);
          if (createError.code === 'auth/email-already-in-use') {
            toast.error('Invalid password. Please try again or reset your password.');
          } else if (createError.code === 'auth/password-does-not-meet-requirements') {
            toast.error('Password must meet Firebase requirements, including an uppercase character.');
          } else if (createError.code === 'auth/weak-password') {
            toast.error('Password is too weak. Please use at least 6 characters.');
          } else {
            toast.error(createError.message || 'Failed to create account.');
          }
        }
      } else {
        toast.error(error.message || 'Failed to sign in. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      toast.error('Please enter your email address first.');
      return;
    }
    setIsSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      toast.success('Password reset link sent to your email!');
      setIsResetting(false);
    } catch (error: any) {
      console.error("Error resetting password", error);
      toast.error('Failed to send reset link. Check the email address.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center">
          <Activity className="w-12 h-12 text-[var(--lux-gold)] mb-4 stroke-[1.75]" />
          <p className="lux-label">Loading Pulse...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen p-4 sm:p-6">
        <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center">
          <div className="w-full space-y-4">
            <div className="flex justify-end">
              <ThemeToggle className="w-auto px-3" />
            </div>

            <div className="glass-panel w-full p-6 text-center sm:p-8">
              <div className="flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)] shadow-[0_14px_38px_-14px_var(--lux-gold-glow)]">
                  <Activity className="h-9 w-9 stroke-[1.5] text-[var(--lux-gold)]" />
                </div>
              </div>

              <div className="mt-6 space-y-2">
                <h1 className="font-display text-5xl font-semibold tracking-tight text-[var(--lux-text)]">Pulse</h1>
                <p className="text-[var(--lux-muted)]">
                  {isResetting ? 'Reset your password' : 'Authorized personnel only.'}
                </p>
              </div>

              {isResetting ? (
                <form onSubmit={handleResetPassword} className="mt-8 space-y-4 text-left">
                  <div className="space-y-2">
                    <label className="lux-label">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--lux-soft)] stroke-[1.75]" />
                      <Input
                        type="email"
                        placeholder="Enter your email"
                        autoComplete="email"
                        className="h-12 pl-10 text-lg"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="glass-btn glass-btn-gold mt-4 w-full py-6 text-lg"
                  >
                    {isSubmitting ? 'Sending...' : 'Send Reset Link'}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setIsResetting(false)}
                    className="mt-4 w-full text-sm font-medium text-[var(--lux-muted)] underline decoration-1 underline-offset-4 transition-colors hover:text-[var(--lux-gold)]"
                  >
                    Back to Login
                  </button>
                </form>
              ) : (
                <form onSubmit={handleSignIn} className="mt-8 space-y-4 text-left">
                  <div className="space-y-2">
                    <label className="lux-label">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--lux-soft)] stroke-[1.75]" />
                      <Input
                        type="email"
                        placeholder="admin@pulse.com"
                        autoComplete="email"
                        className="h-12 pl-10 text-lg"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="lux-label">Password</label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--lux-soft)] stroke-[1.75]" />
                      <Input
                        type="password"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        className="h-12 pl-10 text-lg"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <p className="text-xs text-[var(--lux-soft)]">
                      New accounts need a password with an uppercase character.
                    </p>
                  </div>

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="glass-btn glass-btn-gold mt-6 w-full py-6 text-lg"
                  >
                    {isSubmitting ? 'Authenticating...' : 'Sign In'}
                  </Button>

                  <button
                    type="button"
                    onClick={() => setIsResetting(true)}
                    className="mt-4 w-full text-sm font-medium text-[var(--lux-muted)] underline decoration-1 underline-offset-4 transition-colors hover:text-[var(--lux-gold)]"
                  >
                    Forgot Password?
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (accessStatus === 'pending' || accessStatus === 'rejected') {
    return (
      <div className="min-h-screen p-4 sm:p-6">
        <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center">
          <div className="w-full space-y-4">
            <div className="flex justify-end">
              <ThemeToggle className="w-auto px-3" />
            </div>
            <div className="glass-panel w-full space-y-6 p-8 text-center">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]">
                  <Activity className="h-8 w-8 stroke-[1.5] text-[var(--lux-gold)]" />
                </div>
              </div>
              <div className="space-y-2">
                <h1 className="font-display text-2xl font-semibold text-[var(--lux-text)]">
                  {accessStatus === 'pending' ? 'You are on the waitlist!' : 'Access Denied'}
                </h1>
                <p className="text-[var(--lux-muted)]">
                  {accessStatus === 'pending'
                    ? `Thanks for joining! Your account (${user.email}) has been added to our waitlist. We will notify you as soon as a spot opens up.`
                    : `Your account (${user.email}) has been denied access.`}
                </p>
              </div>
              <Button
                onClick={() => auth.signOut()}
                className="glass-btn w-full"
              >
                <LogOut className="mr-2 h-4 w-4 stroke-[1.75]" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
