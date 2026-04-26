import { Database, Globe2 } from 'lucide-react';

import type { ChatMessage, ChatModeOption } from './types';

export const CHAT_WELCOME: ChatMessage = {
  id: 'brain_welcome',
  role: 'brain',
  content: 'Ask me about anything saved in your Pulse memory.',
  createdAt: Date.now(),
};

export const CHAT_MODES: ChatModeOption[] = [
  {
    id: 'work',
    label: 'My Work',
    icon: Database,
    help: 'Your full Pulse memory for this account.',
  },
  {
    id: 'work_web',
    label: 'Work + Web',
    icon: Globe2,
    help: 'Your Pulse memory first, web only when needed.',
  },
  {
    id: 'web',
    label: 'Web Only',
    icon: Globe2,
    help: 'Skip private Pulse memory and use web grounding only.',
  },
];

export const STOP_WORDS = new Set([
  'about',
  'also',
  'and',
  'are',
  'can',
  'does',
  'for',
  'from',
  'give',
  'hey',
  'how',
  'into',
  'is',
  'me',
  'of',
  'only',
  'the',
  'this',
  'to',
  'what',
  'whats',
  'where',
  'why',
  'with',
  'you',
]);
