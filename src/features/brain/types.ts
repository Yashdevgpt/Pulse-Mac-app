import type { LucideIcon } from 'lucide-react';

import type { BrainChatMode } from '@/lib/brainApi';

export type ChatMessageSource = {
  title: string;
  type: string;
};

export type ChatMessageWebSource = {
  title: string;
  uri?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'brain';
  content: string;
  createdAt: number;
  // Populated for assistant replies only. Stored alongside the message so a
  // saved chat can re-render its citations exactly as they appeared.
  sources?: ChatMessageSource[];
  webSources?: ChatMessageWebSource[];
  // 'summary' marks a synthetic message produced by Summarize Older History
  // — it replaces a span of older messages and renders with distinct styling.
  // compressedCount is how many original messages the summary covers.
  kind?: 'summary';
  compressedCount?: number;
};

export type BrainPassage = {
  cardTitle: string;
  heading: string;
  text: string;
  score: number;
};

export type ExtractedKnowledgeFile = {
  text: string;
  format: string;
};

export type ChatModeOption = {
  id: BrainChatMode;
  label: string;
  icon: LucideIcon;
  help: string;
};
