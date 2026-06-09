import { auth } from '@/lib/firebase';

const STORAGE_KEY = 'pulse:ai-keys:v1';
const FALLBACK_TOAST_KEY = 'pulse:ai-keys:fallback-toast-date';

export type AiKeys = {
  geminiKey: string;
  openrouterKey: string;
};

const empty: AiKeys = { geminiKey: '', openrouterKey: '' };

const hasAnyKey = (keys: AiKeys) => Boolean(keys.geminiKey || keys.openrouterKey);

export const getAiKeys = (): AiKeys => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...empty };
    const parsed = JSON.parse(raw);
    return {
      geminiKey: typeof parsed.geminiKey === 'string' ? parsed.geminiKey.trim() : '',
      openrouterKey: typeof parsed.openrouterKey === 'string' ? parsed.openrouterKey.trim() : '',
    };
  } catch {
    return { ...empty };
  }
};

export const setAiKeys = (keys: AiKeys) => {
  const normalized: AiKeys = {
    geminiKey: keys.geminiKey.trim(),
    openrouterKey: keys.openrouterKey.trim(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent('pulse:ai-keys:changed'));
};

export const clearAiKeys = () => {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('pulse:ai-keys:changed'));
};

export const hasGeminiKey = () => getAiKeys().geminiKey.length > 0;
export const hasOpenrouterKey = () => getAiKeys().openrouterKey.length > 0;

// ─── Server-side persistence ──────────────────────────────────────────
// localStorage alone is unreliable in the Electron shell: the app's origin
// includes the local server's port, which changes every launch, so browser
// storage starts empty after each restart. The local server persists keys in
// a file next to the runtime .env (never leaves this Mac). localStorage stays
// as the in-session cache that Brain API calls read synchronously.

const persistAiKeysToServer = async (keys: AiKeys) => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sign in again before saving AI keys.');

  const response = await fetch('/api/ai-keys', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(keys),
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || 'Could not save AI keys on this Mac.');
  }
};

// Save to the on-disk file FIRST, then update the localStorage cache only on
// success — otherwise a rejected write (bad key format, 401) would leave the
// session using a key that silently reverts on the next restart.
export const saveAiKeysEverywhere = async (keys: AiKeys) => {
  const normalized: AiKeys = {
    geminiKey: keys.geminiKey.trim(),
    openrouterKey: keys.openrouterKey.trim(),
  };
  await persistAiKeysToServer(normalized);
  setAiKeys(normalized);
};

export const clearAiKeysEverywhere = async () => {
  await persistAiKeysToServer({ ...empty });
  clearAiKeys();
};

// Called once after sign-in. The on-disk file wins; if it's empty but this
// device still has keys in localStorage (pre-migration state), push them to
// the file so the user never re-enters keys again.
export const syncAiKeysFromServer = async (): Promise<void> => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) return;

  const response = await fetch('/api/ai-keys', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return;

  const stored = await response.json().catch(() => null);
  if (!stored || typeof stored !== 'object') return;

  const serverKeys: AiKeys = {
    geminiKey: typeof stored.geminiKey === 'string' ? stored.geminiKey.trim() : '',
    openrouterKey: typeof stored.openrouterKey === 'string' ? stored.openrouterKey.trim() : '',
  };
  const localKeys = getAiKeys();

  if (hasAnyKey(serverKeys)) {
    setAiKeys(serverKeys);
  } else if (hasAnyKey(localKeys)) {
    await persistAiKeysToServer(localKeys);
  }
};

// Returns true at most once per calendar day. Used to throttle the
// "switched to OpenRouter" toast so the user sees it once when the
// fallback first fires that day.
export const consumeFallbackToastSlot = (): boolean => {
  const today = new Date().toISOString().slice(0, 10);
  const last = localStorage.getItem(FALLBACK_TOAST_KEY);
  if (last === today) return false;
  localStorage.setItem(FALLBACK_TOAST_KEY, today);
  return true;
};
