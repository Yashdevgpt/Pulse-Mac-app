import { useState, useEffect } from 'react';
import { db, AppUser } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Check, X, ShieldAlert, Shield, ShieldOff, Edit2, Save, Trash2, KeyRound, Eye, EyeOff } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { getAiKeys, setAiKeys, clearAiKeys } from '@/lib/aiKeys';

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
  }, []);

  const handleSaveKeys = () => {
    setAiKeys({ geminiKey: geminiKeyInput, openrouterKey: openrouterKeyInput });
    setKeysSavedAt(Date.now());
    toast.success('AI keys saved on this device');
  };

  const handleClearKeys = () => {
    clearAiKeys();
    setGeminiKeyInput('');
    setOpenrouterKeyInput('');
    setKeysSavedAt(null);
    toast.message('AI keys cleared');
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
    return <div className="px-4 py-6 font-bold sm:px-6 lg:px-8">Loading users...</div>;
  }

  const currentUserId = auth.currentUser?.uid;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-4">
        <div className="w-12 h-12 bg-[var(--color-neo-yellow)] border-3 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded-xl flex items-center justify-center">
          <ShieldAlert className="w-6 h-6 text-black stroke-[3]" />
        </div>
        <div>
          <h1 className="text-4xl font-black text-black tracking-tight uppercase">Admin Panel</h1>
          <p className="text-zinc-600 mt-1 font-medium">Manage user access to Pulse.</p>
        </div>
      </div>

      <div className="neo-box p-6 bg-white space-y-5 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[var(--color-neo-pink)] border-3 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] rounded-lg flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-black stroke-[3]" />
          </div>
          <div>
            <h2 className="text-2xl font-black uppercase text-black">AI Keys</h2>
            <p className="text-sm text-zinc-600 font-medium">
              Stored only on this device (localStorage). Brain calls Gemini first; on rate limit or auth error it falls back to OpenRouter (gpt-5-nano).
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold uppercase text-black tracking-wide">Gemini API Key</label>
          <div className="flex gap-2">
            <Input
              type={showGemini ? 'text' : 'password'}
              value={geminiKeyInput}
              onChange={(event) => setGeminiKeyInput(event.target.value)}
              placeholder="AIza..."
              className="neo-input"
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              type="button"
              onClick={() => setShowGemini((value) => !value)}
              className="neo-btn bg-zinc-200 text-black px-3"
              title={showGemini ? 'Hide key' : 'Show key'}
            >
              {showGemini ? <EyeOff className="w-4 h-4 stroke-[3]" /> : <Eye className="w-4 h-4 stroke-[3]" />}
            </Button>
          </div>
          <p className="text-xs text-zinc-500 font-medium">{maskedHint(getAiKeys().geminiKey)} · Get one at aistudio.google.com/apikey</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-bold uppercase text-black tracking-wide">OpenRouter API Key</label>
          <div className="flex gap-2">
            <Input
              type={showOpenrouter ? 'text' : 'password'}
              value={openrouterKeyInput}
              onChange={(event) => setOpenrouterKeyInput(event.target.value)}
              placeholder="sk-or-..."
              className="neo-input"
              spellCheck={false}
              autoComplete="off"
            />
            <Button
              type="button"
              onClick={() => setShowOpenrouter((value) => !value)}
              className="neo-btn bg-zinc-200 text-black px-3"
              title={showOpenrouter ? 'Hide key' : 'Show key'}
            >
              {showOpenrouter ? <EyeOff className="w-4 h-4 stroke-[3]" /> : <Eye className="w-4 h-4 stroke-[3]" />}
            </Button>
          </div>
          <p className="text-xs text-zinc-500 font-medium">{maskedHint(getAiKeys().openrouterKey)} · Get one at openrouter.ai/keys · Model locked to openai/gpt-5-nano</p>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <Button onClick={handleSaveKeys} className="neo-btn bg-[var(--color-neo-green)] text-black">
            <Save className="w-4 h-4 mr-2 stroke-[3]" /> Save Keys
          </Button>
          <Button onClick={handleClearKeys} className="neo-btn bg-zinc-200 text-black hover:bg-red-500 hover:text-white transition-colors">
            <Trash2 className="w-4 h-4 mr-2 stroke-[3]" /> Clear
          </Button>
          {keysSavedAt && (
            <span className="text-xs text-zinc-500 font-medium self-center">Saved at {new Date(keysSavedAt).toLocaleTimeString()}</span>
          )}
        </div>
      </div>

      <div className="neo-box p-6 bg-white space-y-4">
        {users.length === 0 ? (
          <p className="text-zinc-500 font-medium">No users found.</p>
        ) : (
          <div className="space-y-4">
            {users.map(user => (
              <div key={user.uid} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border-3 border-black rounded-xl bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] gap-4">
                <div className="w-full sm:w-auto flex-1">
                  {editingUserId === user.uid ? (
                    <div className="flex items-center gap-2 mb-2">
                      <Input 
                        value={editName} 
                        onChange={(e) => setEditName(e.target.value)}
                        className="neo-input h-8 text-sm max-w-[200px]"
                        autoFocus
                      />
                      <Button size="sm" onClick={() => handleSaveName(user.uid)} className="neo-btn bg-[var(--color-neo-green)] h-8 px-2">
                        <Save className="w-4 h-4" />
                      </Button>
                      <Button size="sm" onClick={() => setEditingUserId(null)} className="neo-btn bg-zinc-200 h-8 px-2">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-bold text-lg text-black">{user.name || 'Unknown'}</p>
                      <button 
                        onClick={() => {
                          setEditingUserId(user.uid);
                          setEditName(user.name || '');
                        }}
                        className="text-zinc-400 hover:text-black transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  
                  <p className="text-sm text-zinc-600 font-medium">{user.email}</p>
                  <div className="mt-2">
                    <span className={`text-xs font-bold px-2 py-1 border-2 border-black rounded-md shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
                      user.status === 'admin' ? 'bg-[var(--color-neo-pink)] text-black' :
                      user.status === 'approved' ? 'bg-[var(--color-neo-green)] text-black' :
                      user.status === 'rejected' ? 'bg-red-500 text-white' :
                      'bg-[var(--color-neo-yellow)] text-black'
                    }`}>
                      {user.status.toUpperCase()}
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2 w-full sm:w-auto justify-end">
                  {user.status === 'pending' && (
                    <>
                      <Button onClick={() => handleApprove(user.uid)} className="neo-btn bg-[var(--color-neo-green)] text-black">
                        <Check className="w-4 h-4 mr-2 stroke-[3]" /> Approve
                      </Button>
                      <Button onClick={() => handleReject(user.uid)} className="neo-btn bg-red-500 text-white hover:bg-red-600">
                        <X className="w-4 h-4 mr-2 stroke-[3]" /> Reject
                      </Button>
                    </>
                  )}
                  {user.status === 'approved' && (
                    <>
                      <Button onClick={() => handleMakeAdmin(user.uid)} className="neo-btn bg-[var(--color-neo-yellow)] text-black">
                        <Shield className="w-4 h-4 mr-2 stroke-[3]" /> Make Admin
                      </Button>
                      <Button onClick={() => handleReject(user.uid)} className="neo-btn bg-red-500 text-white hover:bg-red-600">
                        <X className="w-4 h-4 mr-2 stroke-[3]" /> Revoke
                      </Button>
                    </>
                  )}
                  {user.status === 'rejected' && (
                    <Button onClick={() => handleApprove(user.uid)} className="neo-btn bg-[var(--color-neo-green)] text-black">
                      <Check className="w-4 h-4 mr-2 stroke-[3]" /> Re-Approve
                    </Button>
                  )}
                  {user.status === 'admin' && user.uid !== currentUserId && (
                    <Button onClick={() => handleApprove(user.uid)} className="neo-btn bg-zinc-200 text-black hover:bg-zinc-300">
                      <ShieldOff className="w-4 h-4 mr-2 stroke-[3]" /> Remove Admin
                    </Button>
                  )}
                  
                  {user.uid !== currentUserId && (
                    <Button onClick={() => setUserToDelete(user.uid)} className="neo-btn bg-zinc-200 text-black hover:bg-red-500 hover:text-white px-3 transition-colors" title="Delete User">
                      <Trash2 className="w-4 h-4 stroke-[3]" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {userToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="neo-box bg-white p-6 max-w-sm w-full space-y-6">
            <h2 className="text-2xl font-black uppercase text-black">Confirm Deletion</h2>
            <p className="text-zinc-600 font-medium">Are you sure you want to delete this user? This action cannot be undone.</p>
            <div className="flex gap-4">
              <Button onClick={() => setUserToDelete(null)} className="neo-btn bg-zinc-200 text-black flex-1">Cancel</Button>
              <Button onClick={() => confirmDelete(userToDelete)} className="neo-btn bg-red-500 text-white flex-1">Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
