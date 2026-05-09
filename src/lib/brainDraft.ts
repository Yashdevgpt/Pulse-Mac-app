import type { ChatMessage } from '@/features/brain/types';
import type { BrainChatMode } from '@/lib/brainApi';

const STORAGE_PREFIX = 'pulse:brain-active-draft:v1';
const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_DRAFT_CHARS = 1_000_000;

export type BrainDraft = {
  selectedChatId: string;
  chatMode: BrainChatMode;
  messages: ChatMessage[];
  question: string;
  updatedAt: number;
  expiresAt: number;
};

export type BrainDraftSaveResult =
  | { saved: true }
  | { saved: false; reason: 'empty' | 'too_large' | 'unavailable' };

const keyForUser = (uid: string) => `${STORAGE_PREFIX}:${uid}`;

const isRealMessage = (message: ChatMessage) => message.id !== 'brain_welcome';

export const hasBrainDraftContent = ({
  messages,
  question,
}: Pick<BrainDraft, 'messages' | 'question'>) =>
  messages.some(isRealMessage) || question.trim().length > 0;

const sanitizeMessages = (messages: ChatMessage[]): ChatMessage[] =>
  messages
    .filter((message) => message && typeof message === 'object')
    .map((message) => {
      const role: ChatMessage['role'] = message.role === 'user' ? 'user' : 'brain';
      return {
        ...message,
        id: String(message.id || `message_${Date.now()}`),
        role,
        content: String(message.content || ''),
        createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
      };
    });

export const saveBrainDraft = (
  uid: string,
  draft: Omit<BrainDraft, 'updatedAt' | 'expiresAt'>,
): BrainDraftSaveResult => {
  if (!uid || typeof localStorage === 'undefined') {
    return { saved: false, reason: 'unavailable' };
  }

  if (!hasBrainDraftContent(draft)) {
    localStorage.removeItem(keyForUser(uid));
    return { saved: false, reason: 'empty' };
  }

  const now = Date.now();
  const payload: BrainDraft = {
    selectedChatId: draft.selectedChatId,
    chatMode: draft.chatMode,
    messages: sanitizeMessages(draft.messages),
    question: draft.question,
    updatedAt: now,
    expiresAt: now + DRAFT_TTL_MS,
  };
  const serialized = JSON.stringify(payload);

  if (serialized.length > MAX_DRAFT_CHARS) {
    localStorage.removeItem(keyForUser(uid));
    return { saved: false, reason: 'too_large' };
  }

  try {
    localStorage.setItem(keyForUser(uid), serialized);
    return { saved: true };
  } catch {
    return { saved: false, reason: 'unavailable' };
  }
};

export const loadBrainDraft = (uid: string): BrainDraft | null => {
  if (!uid || typeof localStorage === 'undefined') return null;

  try {
    const raw = localStorage.getItem(keyForUser(uid));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<BrainDraft>;
    if (!Array.isArray(parsed.messages) || !parsed.chatMode) {
      localStorage.removeItem(keyForUser(uid));
      return null;
    }

    const draft: BrainDraft = {
      selectedChatId: typeof parsed.selectedChatId === 'string' ? parsed.selectedChatId : '',
      chatMode: ['work', 'work_web', 'web'].includes(parsed.chatMode) ? parsed.chatMode : 'work',
      messages: sanitizeMessages(parsed.messages),
      question: typeof parsed.question === 'string' ? parsed.question : '',
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0,
    };

    if (draft.expiresAt <= Date.now() || !hasBrainDraftContent(draft)) {
      localStorage.removeItem(keyForUser(uid));
      return null;
    }

    return draft;
  } catch {
    localStorage.removeItem(keyForUser(uid));
    return null;
  }
};

export const clearBrainDraft = (uid: string) => {
  if (!uid || typeof localStorage === 'undefined') return;
  localStorage.removeItem(keyForUser(uid));
};
