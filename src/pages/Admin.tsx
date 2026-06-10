import { useState, useEffect } from 'react';
import { db, AppUser } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Check, X, ShieldAlert, Shield, ShieldOff, Edit2, Save, Trash2, KeyRound, Eye, EyeOff } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { auth } from '@/lib/firebase';
import { getAiKeys, saveAiKeysEverywhere, clearAiKeysEverywhere } from '@/lib/aiKeys';

export default function Admin() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [openrouterKeyInput, setOpenrouterKeyInput] = useState('');
  const [showGemini, setShowGemini] = useState(false);
  const [showOpenrouter, setShowOpenrouter] = useState(false);
  const [keysSavedAt, setKeysSavedAt] = useState<number | null>(null);

  useEffect(() => {
    loadUsers();
    const stored = getAiKeys();
    setGeminiKeyInput(stored.geminiKey);
    setOpenrouterKeyInput(stored.openrouterKey);

    // The on-disk key sync at sign-in is async and may finish after this
    // panel mounts; refresh the inputs when the local key cache changes.
    const refreshFromStore = () => {
      const latest = getAiKeys();
      setGeminiKeyInput(latest.geminiKey);
      setOpenrouterKeyInput(latest.openrouterKey);
    };
    window.addEventListener('pulse:ai-keys:changed', refreshFromStore);
    return () => window.removeEventListener('pulse:ai-keys:changed', refreshFromStore);
  }, []);

  const handleSaveKeys = async () => {
    try {
      await saveAiKeysEverywhere({ geminiKey: geminiKeyInput, openrouterKey: openrouterKeyInput });
      setKeysSavedAt(Date.now());
      toast.success('AI keys saved on this Mac — they now survive app restarts');
    } catch (error: any) {
      toast.error(error?.message || 'Could not save AI keys.');
    }
  };

  const handleClearKeys = async () => {
    try {
      await clearAiKeysEverywhere();
      setGeminiKeyInput('');
      setOpenrouterKeyInput('');
      setKeysSavedAt(null);
      toast.message('AI keys cleared from this Mac');
    } catch (error: any) {
      toast.error(error?.message || 'Could not clear AI keys.');
    }
  };

  const maskedHint = (value: string) =>
    value ? `Saved (${value.length} chars, ends ${value.slice(-4)})` : 'Not set';

  const loadUsers = async () => {
    try {
      const allUsers = await db.getAllUsers();
      setUsers(allUsers);
    } catch (error) {
      console.error("Failed to load users", error);
      toast.error("Failed to load users. Check Firestore rules.");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (uid: string) => {
    try {
      await db.updateUserStatus(uid, 'approved');
      toast.success("User approved");
      loadUsers();
    } catch (error) {
      toast.error("Failed to approve user");
    }
  };

  const handleReject = async (uid: string) => {
    try {
      await db.updateUserStatus(uid, 'rejected');
      toast.success("User rejected");
      loadUsers();
    } catch (error) {
      toast.error("Failed to reject user");
    }
  };

  const handleMakeAdmin = async (uid: string) => {
    try {
      await db.updateUserStatus(uid, 'admin');
      toast.success("User promoted to Admin");
      loadUsers();
    } catch (error) {
      toast.error("Failed to promote user");
    }
  };

  const confirmDelete = async (uid: string) => {
    try {
      await db.deleteUser(uid);
      toast.success("User deleted from database");
      loadUsers();
    } catch (error) {
      console.error("Failed to delete user", error);
      toast.error("Failed to delete user");
    } finally {
      setUserToDelete(null);
    }
  };

  const handleSaveName = async (uid: string) => {
    if (!editName.trim()) {
      toast.error("Name cannot be empty");
      return;
    }
    try {
      await db.updateUserName(uid, editName.trim());
      toast.success("User name updated");
      setEditingUserId(null);
      loadUsers();
    } catch (error) {
      toast.error("Failed to update name");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="flex animate-pulse flex-col items-center">
          <ShieldAlert className="mb-4 h-12 w-12 stroke-[1.75] text-[var(--lux-gold)]" />
          <p className="lux-label">Loading users...</p>
        </div>
      </div>
    );
  }

  const currentUserId = auth.currentUser?.uid;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={ShieldAlert}
        title="Admin Panel"
        subtitle="Manage user access to Pulse."
        compact
      />

      <div className="glass-panel p-6 space-y-5 mb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]">
            <KeyRound className="w-5 h-5 stroke-[1.75] text-[var(--lux-gold)]" />
          </div>
          <div>
            <h2 className="font-display text-2xl font-semibold text-[var(--lux-text)]">AI Keys</h2>
            <p className="text-sm text-[var(--lux-muted)]">
              Stored only on this Mac (a private file in Pulse's app data — survives restarts). Brain calls Gemini first; on rate limit or auth error it falls back to OpenRouter (DeepSeek Chat, then GPT-OSS-120B). One OpenRouter key covers both fallback models.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="lux-label">Gemini API Key</label>
          <div className="flex gap-2">
            <Input
              type={showGemini ? 'text' : 'password'}
              value={geminiKeyInput}
              onChange={(event) => setGeminiKeyInput(event.target.value)}
              placeholder="AIza..."
              className=""
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              type="button"
              onClick={() => setShowGemini((value) => !value)}
              className="glass-btn px-3"
              title={showGemini ? 'Hide key' : 'Show key'}
            >
              {showGemini ? <EyeOff className="w-4 h-4 stroke-[1.75]" /> : <Eye className="w-4 h-4 stroke-[1.75]" />}
            </Button>
          </div>
          <p className="text-xs text-[var(--lux-muted)] font-medium">{maskedHint(getAiKeys().geminiKey)} · Get one at aistudio.google.com/apikey</p>
        </div>

        <div className="space-y-2">
          <label className="lux-label">OpenRouter API Key</label>
          <div className="flex gap-2">
            <Input
              type={showOpenrouter ? 'text' : 'password'}
              value={openrouterKeyInput}
              onChange={(event) => setOpenrouterKeyInput(event.target.value)}
              placeholder="sk-or-..."
              className=""
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              type="button"
              onClick={() => setShowOpenrouter((value) => !value)}
              className="glass-btn px-3"
              title={showOpenrouter ? 'Hide key' : 'Show key'}
            >
              {showOpenrouter ? <EyeOff className="w-4 h-4 stroke-[1.75]" /> : <Eye className="w-4 h-4 stroke-[1.75]" />}
            </Button>
          </div>
          <p className="text-xs text-[var(--lux-muted)] font-medium">{maskedHint(getAiKeys().openrouterKey)} · Get one at openrouter.ai/keys · Fallback chain: deepseek/deepseek-chat → openai/gpt-oss-120b</p>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <Button onClick={handleSaveKeys} className="glass-btn glass-btn-gold">
            <Save className="w-4 h-4 mr-2 stroke-[1.75]" /> Save Keys
          </Button>
          <Button onClick={handleClearKeys} className="glass-btn glass-btn-ruby">
            <Trash2 className="w-4 h-4 mr-2 stroke-[1.75]" /> Clear
          </Button>
          {keysSavedAt && (
            <span className="text-xs text-[var(--lux-muted)] font-medium self-center">Saved at {new Date(keysSavedAt).toLocaleTimeString()}</span>
          )}
        </div>
      </div>

      <div className="glass-panel p-6 space-y-4">
        {users.length === 0 ? (
          <p className="text-[var(--lux-muted)]">No users found.</p>
        ) : (
          <div className="space-y-4">
            {users.map(user => (
              <div key={user.uid} className="flex flex-col sm:flex-row items-start sm:items-center justify-between rounded-2xl border border-[var(--lux-border)] bg-[var(--lux-fill)] p-4 gap-4">
                <div className="w-full sm:w-auto flex-1">
                  {editingUserId === user.uid ? (
                    <div className="flex items-center gap-2 mb-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8 text-sm max-w-[200px]"
                        autoFocus
                      />
                      <Button size="sm" onClick={() => handleSaveName(user.uid)} className="glass-btn glass-btn-emerald h-8 px-2">
                        <Save className="w-4 h-4 stroke-[1.75]" />
                      </Button>
                      <Button size="sm" onClick={() => setEditingUserId(null)} className="glass-btn h-8 px-2">
                        <X className="w-4 h-4 stroke-[1.75]" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-display font-semibold text-lg text-[var(--lux-text)]">{user.name || 'Unknown'}</p>
                      <button
                        onClick={() => {
                          setEditingUserId(user.uid);
                          setEditName(user.name || '');
                        }}
                        className="text-[var(--lux-soft)] hover:text-[var(--lux-gold)] transition-colors"
                      >
                        <Edit2 className="w-4 h-4 stroke-[1.75]" />
                      </button>
                    </div>
                  )}

                  <p className="text-sm text-[var(--lux-muted)]">{user.email}</p>
                  <div className="mt-2">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                      user.status === 'admin' ? 'border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)] text-[var(--lux-gold)]' :
                      user.status === 'approved' ? 'border-[var(--lux-emerald-border)] bg-[var(--lux-emerald-fill)] text-[var(--lux-emerald)]' :
                      user.status === 'rejected' ? 'border-[var(--lux-ruby-border)] bg-[var(--lux-ruby-fill)] text-[var(--lux-ruby)]' :
                      'border-[var(--lux-amber-border)] bg-[var(--lux-amber-fill)] text-[var(--lux-amber)]'
                    }`}>
                      {user.status.toUpperCase()}
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-end">
                  {user.status === 'pending' && (
                    <>
                      <Button onClick={() => handleApprove(user.uid)} className="glass-btn glass-btn-emerald">
                        <Check className="w-4 h-4 mr-2 stroke-[1.75]" /> Approve
                      </Button>
                      <Button onClick={() => handleReject(user.uid)} className="glass-btn glass-btn-ruby">
                        <X className="w-4 h-4 mr-2 stroke-[1.75]" /> Reject
                      </Button>
                    </>
                  )}
                  {user.status === 'approved' && (
                    <>
                      <Button onClick={() => handleMakeAdmin(user.uid)} className="glass-btn glass-btn-gold">
                        <Shield className="w-4 h-4 mr-2 stroke-[1.75]" /> Make Admin
                      </Button>
                      <Button onClick={() => handleReject(user.uid)} className="glass-btn glass-btn-ruby">
                        <X className="w-4 h-4 mr-2 stroke-[1.75]" /> Revoke
                      </Button>
                    </>
                  )}
                  {user.status === 'rejected' && (
                    <Button onClick={() => handleApprove(user.uid)} className="glass-btn glass-btn-emerald">
                      <Check className="w-4 h-4 mr-2 stroke-[1.75]" /> Re-Approve
                    </Button>
                  )}
                  {user.status === 'admin' && user.uid !== currentUserId && (
                    <Button onClick={() => handleApprove(user.uid)} className="glass-btn">
                      <ShieldOff className="w-4 h-4 mr-2 stroke-[1.75]" /> Remove Admin
                    </Button>
                  )}

                  {user.uid !== currentUserId && (
                    <Button onClick={() => setUserToDelete(user.uid)} className="glass-btn glass-btn-ruby px-3" title="Delete User">
                      <Trash2 className="w-4 h-4 stroke-[1.75]" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="glass-strong w-full max-w-sm space-y-6 rounded-2xl p-6">
            <h2 className="font-display text-2xl font-semibold text-[var(--lux-text)]">Confirm Deletion</h2>
            <p className="text-[var(--lux-muted)]">Are you sure you want to delete this user? This action cannot be undone.</p>
            <div className="flex gap-4">
              <Button onClick={() => setUserToDelete(null)} className="glass-btn flex-1">Cancel</Button>
              <Button onClick={() => confirmDelete(userToDelete)} className="glass-btn glass-btn-ruby flex-1">Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
