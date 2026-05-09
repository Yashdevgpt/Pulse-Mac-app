import { auth } from '@/lib/firebase';
import { toast } from 'sonner';
import type { AppUser, BrainCard, BrainChat, DSP, Log, LogFile, Tag } from '@/lib/db';
import { extractKnowledgeFile } from '@/features/brain/file-extraction';
import { consumeFallbackToastSlot, getAiKeys } from '@/lib/aiKeys';

export type BrainChatMode = 'work' | 'work_web' | 'web';

export type BrainSourceType =
  | 'user_profile'
  | 'dsp_record'
  | 'tag_record'
  | 'brain_card'
  | 'fleet_log'
  | 'saved_chat';

export type BrainMemorySource = {
  sourceType: BrainSourceType;
  sourceId: string;
  title: string;
  heading?: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type BrainClientSource = {
  sourceType?: BrainMemorySource['sourceType'];
  title: string;
  heading?: string;
  content: string;
  score?: number;
};

export type BrainApiMessage = {
  role: 'user' | 'brain';
  content: string;
};

type BrainRebuildPayload = {
  userProfile: AppUser;
  dsps: DSP[];
  tags: Tag[];
  logs: Log[];
  cards: BrainCard[];
  chats: BrainChat[];
};

const UNKNOWN_TIMESTAMP = 1;

const getIdToken = async () => {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error('Sign in again before using Brain AI.');
  }
  return token;
};

const callBrainApi = async <T>(path: string, body: Record<string, unknown>) => {
  const token = await getIdToken();
  const { geminiKey, openrouterKey } = getAiKeys();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  if (geminiKey) headers['x-gemini-key'] = geminiKey;
  if (openrouterKey) headers['x-openrouter-key'] = openrouterKey;

  const response = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 412 && result?.error) {
      // Server signalled missing AI keys.
      throw new Error(`${result.error} Open Admin → AI Keys to set them.`);
    }
    throw new Error(result.error || 'Brain memory request failed.');
  }

  if (response.headers.get('x-provider-used') === 'openrouter' && consumeFallbackToastSlot()) {
    toast.message('Switched to OpenRouter', {
      description: 'Gemini was rate-limited. Falling back to gpt-5-nano for now.',
    });
  }

  return result as T;
};

export const requireBrainMemoryGeminiKey = () => {
  if (!getAiKeys().geminiKey) {
    throw new Error('Gemini API key is required for Brain memory indexing because embeddings are Gemini-only. Open Admin → AI Keys to set it.');
  }
};

const cleanMemoryText = (value: string, max = 12000) =>
  String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, max);

const joinMemoryLines = (lines: Array<string | undefined | null>) =>
  lines
    .map((line) => cleanMemoryText(line || ''))
    .filter(Boolean)
    .join('\n');

const describeStoredFile = (file: LogFile) =>
  file.type ? `${file.name} (${file.type})` : file.name;

const fileDataToFile = async (file: LogFile) => {
  const response = await fetch(file.data);
  const blob = await response.blob();
  return new File([blob], file.name, {
    type: file.type || blob.type || 'application/octet-stream',
  });
};

const extractStoredAttachmentText = async (label: string, file?: LogFile) => {
  if (!file?.data) return '';

  const baseNote = `${label}: ${describeStoredFile(file)}`;

  try {
    const uploadedFile = await fileDataToFile(file);
    const extracted = await extractKnowledgeFile(uploadedFile);
    return joinMemoryLines([
      baseNote,
      `Extracted ${extracted.format} text:`,
      extracted.text,
    ]);
  } catch (error: any) {
    return joinMemoryLines([
      baseNote,
      `Extraction note: ${cleanMemoryText(error?.message || 'Text extraction is unavailable for this attachment.', 280)}`,
    ]);
  }
};

const getTagNames = (tagIds: string[], tags: Tag[]) =>
  tagIds
    .map((tagId) => tags.find((tag) => tag.id === tagId)?.name)
    .filter(Boolean) as string[];

export const cardToMemorySource = (card: BrainCard): BrainMemorySource => ({
  sourceType: 'brain_card',
  sourceId: card.id,
  title: card.title,
  heading: card.title,
  content: card.content.trim()
    ? card.content
    : `Brain card title: ${card.title}`,
  metadata: {
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  },
});

export const userToMemorySource = (user: AppUser): BrainMemorySource => ({
  sourceType: 'user_profile',
  sourceId: user.uid,
  title: user.name || user.email || 'User Profile',
  heading: 'User Profile',
  content: joinMemoryLines([
    `Name: ${user.name || 'Unknown User'}`,
    `Email: ${user.email}`,
    `Access Status: ${user.status}`,
    user.createdAt ? `Joined: ${new Date(user.createdAt).toISOString()}` : '',
  ]),
  metadata: {
    uid: user.uid,
    email: user.email,
    status: user.status,
    createdAt: user.createdAt || UNKNOWN_TIMESTAMP,
    updatedAt: user.createdAt || UNKNOWN_TIMESTAMP,
  },
});

export const dspToMemorySource = (dsp: DSP, relatedLogs: Log[]): BrainMemorySource => {
  const ongoingLogs = relatedLogs.filter((log) => log.status === 'Ongoing').length;
  const latestLog = [...relatedLogs].sort((left, right) => right.updatedAt - left.updatedAt)[0];

  return {
    sourceType: 'dsp_record',
    sourceId: dsp.id,
    title: dsp.name,
    heading: 'DSP Record',
    content: joinMemoryLines([
      `DSP Name: ${dsp.name}`,
      `Permalink: ${dsp.id}`,
      `Created: ${new Date(dsp.createdAt).toISOString()}`,
      `Updated: ${new Date(dsp.updatedAt).toISOString()}`,
      `Total Logs: ${relatedLogs.length}`,
      `Ongoing Logs: ${ongoingLogs}`,
      latestLog?.content ? `Latest Log Summary: ${cleanMemoryText(latestLog.content, 900)}` : '',
    ]),
    metadata: {
      createdAt: dsp.createdAt,
      updatedAt: dsp.updatedAt,
      totalLogs: relatedLogs.length,
      ongoingLogs,
      slug: dsp.id,
    },
  };
};

export const tagToMemorySource = (tag: Tag): BrainMemorySource => ({
  sourceType: 'tag_record',
  sourceId: tag.id,
  title: tag.name,
  heading: 'Tag Record',
  content: joinMemoryLines([
    `Tag Name: ${tag.name}`,
    `Color Class: ${tag.color}`,
    'Tags categorize fleet updates and Watchtower visibility.',
  ]),
  metadata: {
    createdAt: UNKNOWN_TIMESTAMP,
    updatedAt: UNKNOWN_TIMESTAMP,
    color: tag.color,
  },
});

export const logToMemorySource = async (log: Log, dsps: DSP[], tags: Tag[]): Promise<BrainMemorySource> => {
  const dsp = dsps.find((item) => item.id === log.dspId);
  const tagNames = getTagNames(log.tags || [], tags);
  const [attachmentText, resolutionAttachmentText] = await Promise.all([
    extractStoredAttachmentText('Log Attachment', log.file),
    extractStoredAttachmentText('Resolution Attachment', log.resolutionFile),
  ]);

  return {
    sourceType: 'fleet_log',
    sourceId: log.id,
    title: dsp?.name ? `${dsp.name} Log` : 'Fleet Log',
    heading: log.status || 'Fleet Activity',
    content: joinMemoryLines([
      `DSP: ${dsp?.name || log.dspId}`,
      `Status: ${log.status}`,
      `Created: ${new Date(log.createdAt).toISOString()}`,
      `Updated: ${new Date(log.updatedAt).toISOString()}`,
      tagNames.length > 0 ? `Tags: ${tagNames.join(', ')}` : '',
      log.content ? `Log Details:\n${log.content}` : '',
      log.resolutionNote ? `Resolution Notes:\n${log.resolutionNote}` : '',
      attachmentText,
      resolutionAttachmentText,
    ]),
    metadata: {
      dspId: log.dspId,
      dspName: dsp?.name || null,
      status: log.status,
      tagIds: log.tags || [],
      tagNames,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
    },
  };
};

export const chatToMemorySource = (chat: BrainChat): BrainMemorySource => ({
  sourceType: 'saved_chat',
  sourceId: chat.id,
  title: chat.title,
  heading: 'Saved Brain Chat',
  content: joinMemoryLines([
    `Chat Mode: ${chat.mode}`,
    chat.messages
      .map((message) => `${message.role === 'user' ? 'User' : 'Brain'}: ${message.content}`)
      .join('\n\n'),
  ]),
  metadata: {
    mode: chat.mode,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  },
});

export const buildCentralizedBrainSources = async ({
  userProfile,
  dsps,
  tags,
  logs,
  cards,
  chats,
}: BrainRebuildPayload): Promise<BrainMemorySource[]> => {
  const dspSources = dsps.map((dsp) => dspToMemorySource(dsp, logs.filter((log) => log.dspId === dsp.id)));
  const tagSources = tags.map(tagToMemorySource);
  const logSources = await Promise.all(
    logs
      .filter((log) => log.content.trim() || log.resolutionNote?.trim() || log.file || log.resolutionFile)
      .map((log) => logToMemorySource(log, dsps, tags)),
  );
  const cardSources = cards
    .filter((card) => card.title.trim() || card.content.trim())
    .map(cardToMemorySource);
  const chatSources = chats
    .filter((chat) => chat.messages.length > 0)
    .map(chatToMemorySource);

  return [
    userToMemorySource(userProfile),
    ...dspSources,
    ...tagSources,
    ...logSources,
    ...cardSources,
    ...chatSources,
  ];
};

export const indexBrainSources = (sources: BrainMemorySource[]) => {
  requireBrainMemoryGeminiKey();
  return callBrainApi<{ embedded: number; indexed: number; reused?: number }>('/api/brain/index', { sources });
};

// Sugar for the common case of pushing a single source (one card / one chat)
// to Brain memory immediately after a Firestore save. Avoids forcing the
// caller to build a one-element array inline.
export const indexBrainSource = (source: BrainMemorySource) =>
  indexBrainSources([source]);

export const deleteBrainMemorySource = (sourceType: BrainMemorySource['sourceType'], sourceId?: string) =>
  callBrainApi<{ deleted: boolean }>('/api/brain/delete-source', { sourceType, sourceId });

// Wipes every Supabase brain_chunks row owned by the signed-in user. Use this
// when you want a clean slate (e.g. orphaned records from earlier deletes that
// pre-dated the auto-cleanup paths). Pair with `indexBrainSources(...)` for a
// fresh rebuild from current Firestore data.
export const resetBrainMemory = () =>
  callBrainApi<{ deleted: number }>('/api/brain/reset-memory', {});

export const askBrainAi = (payload: {
  question: string;
  mode: BrainChatMode;
  history: BrainApiMessage[];
  clientSources: BrainClientSource[];
}) =>
  callBrainApi<{
    answer: string;
    sources?: Array<{ title: string; type: string }>;
    webSources?: Array<{ title: string; uri?: string }>;
  }>('/api/brain/chat', payload);

export const summarizeBrainHistory = (messages: BrainApiMessage[]) =>
  callBrainApi<{ summary: string; compressedCount: number }>(
    '/api/brain/summarize-history',
    { messages }
  );
