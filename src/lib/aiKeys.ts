const STORAGE_KEY = 'pulse:ai-keys:v1';
const FALLBACK_TOAST_KEY = 'pulse:ai-keys:fallback-toast-date';

export type AiKeys = {
  geminiKey: string;
  openrouterKey: string;
};

const empty: AiKeys = { geminiKey: '', openrouterKey: '' };

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
