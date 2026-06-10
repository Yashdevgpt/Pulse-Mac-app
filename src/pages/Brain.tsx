import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Brain as BrainIcon, Database, Eraser, ExternalLink, History, Link2, MessageCircle, Plus, RefreshCw, Save, Scissors, Search, Send, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import MarkdownMessage from '@/components/MarkdownMessage';
import PageHeader from '@/components/PageHeader';
import RichMarkdownEditor from '@/components/RichMarkdownEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CHAT_MODES, CHAT_WELCOME } from '@/features/brain/constants';
import { extractKnowledgeFile } from '@/features/brain/file-extraction';
import { getBrainResponse, getGroundingPassages } from '@/features/brain/grounding';
import type { ChatMessage, ExtractedKnowledgeFile } from '@/features/brain/types';
import { auth } from '@/lib/firebase';
import { db, BrainCard, BrainChat } from '@/lib/db';
import { hasGeminiKey, hasOpenrouterKey } from '@/lib/aiKeys';
import { clearBrainDraft, hasBrainDraftContent, loadBrainDraft, saveBrainDraft } from '@/lib/brainDraft';
import {
  askBrainAi,
  buildCentralizedBrainSources,
  cardToMemorySource,
  chatToMemorySource,
  deleteBrainMemorySource,
  indexBrainSource,
  indexBrainSources,
  requireBrainMemoryGeminiKey,
  resetBrainMemory,
  summarizeBrainHistory,
  type BrainMemorySource,
  type BrainChatMode,
} from '@/lib/brainApi';

// "Summarize older history" keeps the most recent N messages verbatim and
// compresses anything older than that into a single summary message. The
// button only appears once there are enough messages to make compression
// worthwhile (KEEP_RECENT + at least 5 older messages).
const KEEP_RECENT_MESSAGES = 10;
const SUMMARIZE_THRESHOLD_OLDER = 5;
const COMPACT_CHAT_MODE_HELP: Record<BrainChatMode, string> = {
  work: 'Full Pulse memory.',
  work_web: 'Memory first; web if needed.',
  web: 'Web grounding only.',
};

export default function Brain() {
  const [cards, setCards] = useState<BrainCard[]>([]);
  const [savedChats, setSavedChats] = useState<BrainChat[]>([]);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [selectedChatId, setSelectedChatId] = useState('');
  const [newCardTitle, setNewCardTitle] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [question, setQuestion] = useState('');
  const [chatMode, setChatMode] = useState<BrainChatMode>('work');
  const [isThinking, setIsThinking] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isNewChatDialogOpen, setIsNewChatDialogOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMemoryMenuOpen, setIsMemoryMenuOpen] = useState(false);
  const [isResetMemoryDialogOpen, setIsResetMemoryDialogOpen] = useState(false);
  // Chat-first layout: the card editor opens as a slide-over panel above the
  // chat instead of occupying a permanent column.
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [cardQuery, setCardQuery] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([CHAT_WELCOME]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftRestoredRef = useRef(false);
  const draftSizeWarningShownRef = useRef(false);
  // Pinned to the messages list so we can keep the newest reply visible without
  // forcing the user to scroll. Auto-snaps to the bottom whenever the messages
  // array grows.
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  // On small screens the editor slide-over sits below the library; bring it
  // into view when it opens so a card tap visibly responds.
  const editorPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditorOpen) {
      editorPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isEditorOpen, selectedCardId]);

  useEffect(() => {
    if (!messagesScrollRef.current) return;
    messagesScrollRef.current.scrollTop = messagesScrollRef.current.scrollHeight;
  }, [messages, isThinking]);

  useEffect(() => {
    loadBrainData();
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || draftRestoredRef.current) return;

    const draft = loadBrainDraft(uid);
    draftRestoredRef.current = true;
    if (!draft) return;

    setSelectedChatId(draft.selectedChatId);
    setChatMode(draft.chatMode);
    setQuestion(draft.question);
    setMessages(draft.messages.length > 0 ? draft.messages : [{ ...CHAT_WELCOME, createdAt: Date.now() }]);
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !draftRestoredRef.current) return;

    const timeout = window.setTimeout(() => {
      const result = saveBrainDraft(uid, {
        selectedChatId,
        chatMode,
        messages,
        question,
      });

      if (result.saved === false && result.reason === 'too_large' && !draftSizeWarningShownRef.current) {
        draftSizeWarningShownRef.current = true;
        toast.warning('Brain draft is too large for local recovery. Save the chat to keep it.');
      }
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [selectedChatId, chatMode, messages, question]);

  const selectedCard = useMemo(
    () => cards.find(card => card.id === selectedCardId) || null,
    [cards, selectedCardId]
  );

  const filteredCards = useMemo(() => {
    const query = cardQuery.trim().toLowerCase();
    if (!query) return cards;
    return cards.filter(card => card.title.toLowerCase().includes(query));
  }, [cards, cardQuery]);

  useEffect(() => {
    if (selectedCard) {
      setDraftTitle(selectedCard.title);
      setDraftContent(selectedCard.content);
    } else {
      setDraftTitle('');
      setDraftContent('');
    }
  }, [selectedCard]);

  const loadBrainData = async () => {
    const [loadedCards, loadedChats] = await Promise.all([
      db.getBrainCards(),
      db.getBrainChats(),
    ]);
    setCards(loadedCards);
    setSavedChats(loadedChats);
    setSelectedCardId(current => current || loadedCards[0]?.id || '');
  };

  const cardsForMemory = () =>
    selectedCard
      ? cards.map(card => card.id === selectedCard.id
        ? { ...selectedCard, title: draftTitle.trim() || selectedCard.title, content: draftContent }
        : card
      )
      : cards;

  const indexSourcesQuietly = async (sources: BrainMemorySource[]) => {
    try {
      await indexBrainSources(sources);
    } catch (error: any) {
      toast.error(error.message || 'Brain memory indexing is not ready yet.');
    }
  };

  // Fire-and-forget background indexing for a single source. The Firestore
  // save has already succeeded by the time this runs, so a failure here is a
  // soft warning — the user can recover by clicking "Rebuild Memory".
  const indexInBackground = (source: BrainMemorySource, label: 'card' | 'chat') => {
    void indexBrainSource(source).catch((error: any) => {
      console.warn(`Background ${label} memory update failed:`, error?.message || error);
      toast.warning(
        `${label === 'card' ? 'Card' : 'Chat'} saved, but Brain memory update failed.`,
        { description: error?.message || 'Click "Rebuild Memory" to retry.' }
      );
    });
  };

  const restoreSourceQuietly = async (source: BrainMemorySource) => {
    try {
      await indexBrainSources([source]);
    } catch (error) {
      console.error('Could not restore Brain memory after delete rollback:', error);
    }
  };

  const deleteMemoryBackedSource = async ({
    sourceType,
    sourceId,
    deleteRecord,
    restoreSource,
  }: {
    sourceType: BrainMemorySource['sourceType'];
    sourceId: string;
    deleteRecord: () => Promise<void>;
    restoreSource: BrainMemorySource;
  }) => {
    await deleteBrainMemorySource(sourceType, sourceId);

    try {
      await deleteRecord();
    } catch (error) {
      await restoreSourceQuietly(restoreSource);
      throw error;
    }
  };

  const createCard = async (titleOverride?: string, contentOverride = '') => {
    const title = (titleOverride || newCardTitle).trim();
    if (!title) {
      toast.error('Add a Brain card title first.');
      return null;
    }

    const now = Date.now();
    const card: BrainCard = {
      id: `brain_${now}`,
      title,
      content: contentOverride,
      createdAt: now,
      updatedAt: now,
    };

    await db.saveBrainCard(card);
    setCards(prev => [card, ...prev]);
    setSelectedCardId(card.id);
    setIsEditorOpen(true);
    setNewCardTitle('');
    toast.success('Brain card created.');
    // Only auto-index if there's actual content; an empty card produces no
    // chunks and would just be a wasted round trip.
    if (card.content.trim()) {
      indexInBackground(cardToMemorySource(card), 'card');
    }
    return card;
  };

  const saveSelectedCard = async () => {
    if (!selectedCard) return;
    const title = draftTitle.trim();
    if (!title) {
      toast.error('Card title cannot be empty.');
      return;
    }

    const updatedCard: BrainCard = {
      ...selectedCard,
      title,
      content: draftContent,
      updatedAt: Date.now(),
    };

    await db.saveBrainCard(updatedCard);
    setCards(prev => prev.map(card => card.id === updatedCard.id ? updatedCard : card));
    toast.success('Brain card saved.');
    indexInBackground(cardToMemorySource(updatedCard), 'card');
  };

  const deleteSelectedCard = async () => {
    if (!selectedCard) return;
    if (!window.confirm(`Delete ${selectedCard.title}?`)) return;

    const card = selectedCard;

    try {
      await deleteMemoryBackedSource({
        sourceType: 'brain_card',
        sourceId: card.id,
        deleteRecord: () => db.deleteBrainCard(card.id),
        restoreSource: cardToMemorySource(card),
      });

      const nextCards = cards.filter(item => item.id !== card.id);
      setCards(nextCards);
      setSelectedCardId(nextCards[0]?.id || '');
      setIsEditorOpen(false);
      toast.success('Brain card deleted');
    } catch (error: any) {
      toast.error(error.message || 'Could not delete Brain card.');
    }
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Keep Brain uploads under 2MB.');
      return;
    }

    let extractedFile: ExtractedKnowledgeFile;
    try {
      extractedFile = await extractKnowledgeFile(file);
    } catch (error: any) {
      toast.error(error.message || 'Could not read this file.');
      return;
    }

    if (!extractedFile.text.trim()) {
      toast.error('File has no readable text.');
      return;
    }

    if (!selectedCard) {
      await createCard(file.name.replace(/\.[^.]+$/, ''), extractedFile.text);
      toast.success(`${extractedFile.format} imported`);
      return;
    }

    setDraftContent(prev => [prev, `\n\n# ${file.name}\n${extractedFile.text}`].filter(Boolean).join('\n'));
    toast.success(`${extractedFile.format} added. Save when ready.`);
  };

  const resetActiveChat = () => {
    const uid = auth.currentUser?.uid;
    if (uid) clearBrainDraft(uid);
    setSelectedChatId('');
    setQuestion('');
    setMessages([{ ...CHAT_WELCOME, createdAt: Date.now() }]);
  };

  const hasActiveDraft = () => hasBrainDraftContent({ messages, question });

  const requestNewChat = () => {
    if (hasActiveDraft()) {
      setIsNewChatDialogOpen(true);
      return;
    }

    resetActiveChat();
  };

  const saveCurrentChat = async (): Promise<BrainChat | null> => {
    const realMessages = messages.filter(message => message.id !== 'brain_welcome');
    if (realMessages.length === 0) {
      toast.error('Ask something before saving this chat.');
      return null;
    }

    const now = Date.now();
    const existingChat = savedChats.find(chat => chat.id === selectedChatId);
    const firstQuestion = realMessages.find(message => message.role === 'user')?.content || 'Brain Chat';
    const chat: BrainChat = {
      id: existingChat?.id || `chat_${now}`,
      title: existingChat?.title || firstQuestion.slice(0, 60),
      mode: chatMode,
      messages: realMessages.map(message => ({
        ...message,
        createdAt: message.createdAt || now,
      })),
      createdAt: existingChat?.createdAt || now,
      updatedAt: now,
    };

    try {
      await db.saveBrainChat(chat);
      setSavedChats(prev => [chat, ...prev.filter(item => item.id !== chat.id)]);
      setSelectedChatId(chat.id);
      toast.success('Brain chat saved.');
      indexInBackground(chatToMemorySource(chat), 'chat');
      return chat;
    } catch (error: any) {
      toast.error(error?.message || 'Could not save Brain chat.');
      return null;
    }
  };

  const saveDraftAndStartNewChat = async () => {
    const saved = await saveCurrentChat();
    if (!saved) return;

    resetActiveChat();
    setIsNewChatDialogOpen(false);
  };

  const discardDraftAndStartNewChat = () => {
    resetActiveChat();
    setIsNewChatDialogOpen(false);
    toast.message('Unsaved Brain draft discarded from this Mac.');
  };

  const loadSavedChat = (chat: BrainChat) => {
    setSelectedChatId(chat.id);
    setChatMode(chat.mode);
    setMessages(chat.messages.length > 0 ? chat.messages : [{ ...CHAT_WELCOME, createdAt: Date.now() }]);
    setIsHistoryOpen(false);
  };

  const deleteSavedChat = async () => {
    if (!selectedChatId) {
      if (hasActiveDraft()) {
        if (window.confirm('Discard this unsaved Brain draft from this Mac?')) {
          resetActiveChat();
          toast.message('Unsaved Brain draft discarded from this Mac.');
        }
        return;
      }

      toast.error('Open a saved chat first.');
      return;
    }
    const chat = savedChats.find(item => item.id === selectedChatId);
    if (!chat || !window.confirm(`Delete saved chat "${chat.title}"?`)) return;

    try {
      await deleteMemoryBackedSource({
        sourceType: 'saved_chat',
        sourceId: chat.id,
        deleteRecord: () => db.deleteBrainChat(chat.id),
        restoreSource: chatToMemorySource(chat),
      });

      setSavedChats(prev => prev.filter(item => item.id !== chat.id));
      resetActiveChat();
      toast.success('Saved chat deleted');
    } catch (error: any) {
      toast.error(error.message || 'Could not delete saved chat.');
    }
  };

  const rebuildMemory = async () => {
    setIsIndexing(true);
    const progressToastId = 'brain-rebuild-progress';
    try {
      requireBrainMemoryGeminiKey();
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Sign in again before rebuilding Brain memory.');
      }

      const [loadedUserProfile, loadedDsps, loadedTags, loadedLogs] = await Promise.all([
        db.getUserAccess(currentUser),
        db.getDSPs(),
        db.getTags(),
        db.getLogs(),
      ]);
      const sources = await buildCentralizedBrainSources({
        userProfile: loadedUserProfile,
        dsps: loadedDsps,
        tags: loadedTags,
        logs: loadedLogs,
        cards: cardsForMemory(),
        chats: savedChats,
      });

      const result = await indexBrainSources(sources, (processed, total) => {
        toast.loading(`Indexing memory… ${processed}/${total} sources`, { id: progressToastId });
      });
      toast.success(`Memory rebuilt with ${result.indexed} chunks across Pulse data`);
    } catch (error: any) {
      toast.error(error.message || 'Could not rebuild Brain memory.');
    } finally {
      toast.dismiss(progressToastId);
      setIsIndexing(false);
    }
  };

  const requestResetMemory = () => {
    if (isResetting || isIndexing) return;
    setIsResetMemoryDialogOpen(true);
  };

  // "Hard reset" — wipes every Supabase brain_chunks row owned by this user
  // and then re-indexes from current Firestore state. It does not delete the
  // Firestore product records that the vector memory is rebuilt from.
  const confirmResetAndRebuildMemory = async () => {
    if (isResetting || isIndexing) return;
    try {
      requireBrainMemoryGeminiKey();
    } catch (error: any) {
      toast.error(error?.message || 'Configure a Gemini API key before resetting Brain memory.');
      return;
    }

    setIsResetting(true);
    try {
      const result = await resetBrainMemory();
      setIsResetMemoryDialogOpen(false);
      toast.success(`Wiped ${result.deleted} memory chunk${result.deleted === 1 ? '' : 's'}. Rebuilding…`, {
        description: 'Your Brain cards, saved chats, Fleet, logs, tags, and profile records were not deleted.',
      });
      await rebuildMemory();
    } catch (error: any) {
      toast.error(error.message || 'Could not reset Brain memory.', {
        description: 'No Pulse product data was changed. Fix Supabase/network access, then retry.',
      });
    } finally {
      setIsResetting(false);
    }
  };

  // How many of the older messages would be eligible for compression right now.
  const compressibleOlderCount = (() => {
    const real = messages.filter(message => message.id !== 'brain_welcome');
    return Math.max(0, real.length - KEEP_RECENT_MESSAGES);
  })();
  const canSummarize = compressibleOlderCount >= SUMMARIZE_THRESHOLD_OLDER;

  const summarizeOlderHistory = async () => {
    if (isSummarizing || isThinking) return;

    const realMessages = messages.filter(message => message.id !== 'brain_welcome');
    const olderCount = realMessages.length - KEEP_RECENT_MESSAGES;
    if (olderCount < SUMMARIZE_THRESHOLD_OLDER) {
      toast.error(`Need at least ${KEEP_RECENT_MESSAGES + SUMMARIZE_THRESHOLD_OLDER} messages before compressing.`);
      return;
    }

    const olderMessages = realMessages.slice(0, olderCount);
    const recentMessages = realMessages.slice(olderCount);

    const confirmed = window.confirm(
      `Compress your ${olderCount} oldest messages into a single AI-generated summary?\n\n` +
      `The most recent ${KEEP_RECENT_MESSAGES} messages will stay verbatim. ` +
      `The original older messages will be replaced — save this chat first if you want to keep them.`
    );
    if (!confirmed) return;

    setIsSummarizing(true);
    try {
      const result = await summarizeBrainHistory(
        olderMessages.map(({ role, content }) => ({ role, content }))
      );

      const summaryMessage: ChatMessage = {
        id: `summary_${Date.now()}`,
        role: 'brain',
        kind: 'summary',
        content: result.summary,
        compressedCount: result.compressedCount,
        createdAt: olderMessages[0]?.createdAt || Date.now(),
      };

      const welcome = messages.find(message => message.id === 'brain_welcome');
      const nextMessages: ChatMessage[] = welcome
        ? [welcome, summaryMessage, ...recentMessages]
        : [summaryMessage, ...recentMessages];

      setMessages(nextMessages);
      toast.success(`Compressed ${olderCount} older messages into a summary.`);
    } catch (error: any) {
      toast.error(error.message || 'Could not summarize older messages.');
    } finally {
      setIsSummarizing(false);
    }
  };

  const askBrain = async () => {
    const nextQuestion = question.trim();
    if (!nextQuestion || isThinking) return;

    const cardsForAnswer = selectedCard
      ? cards.map(card => card.id === selectedCard.id
        ? { ...selectedCard, title: draftTitle.trim() || selectedCard.title, content: draftContent }
        : card
      )
      : cards;

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: nextQuestion,
      createdAt: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setQuestion('');
    setIsThinking(true);

    const passages = chatMode === 'web' ? [] : getGroundingPassages(nextQuestion, cardsForAnswer);
    const history = messages
      .filter(message => message.id !== 'brain_welcome')
      .map(message => ({ role: message.role, content: message.content }));
    const hasBrainAiKey = hasGeminiKey() || hasOpenrouterKey();

    if (chatMode === 'work' && !hasBrainAiKey) {
      setMessages(prev => [...prev, {
        id: `brain_${Date.now()}`,
        role: 'brain',
        content: getBrainResponse(nextQuestion, cardsForAnswer),
        createdAt: Date.now(),
        sources: passages.map(({ cardTitle }) => ({
          title: cardTitle,
          type: 'brain_card',
        })),
      }]);
      setIsThinking(false);
      return;
    }

    try {
      const result = await askBrainAi({
        question: nextQuestion,
        mode: chatMode,
        history,
        clientSources: passages.map(({ cardTitle, heading, text, score }) => ({
          sourceType: 'brain_card',
          title: cardTitle,
          heading,
          content: text,
          score,
        })),
      });

      // Dedupe web sources by URI (Gemini sometimes returns the same page
      // twice when multiple grounding chunks point at it).
      const seenUris = new Set<string>();
      const dedupedWebSources = (result.webSources || []).filter(source => {
        const key = source.uri || source.title;
        if (!key || seenUris.has(key)) return false;
        seenUris.add(key);
        return true;
      });

      setMessages(prev => [...prev, {
        id: `brain_${Date.now()}`,
        role: 'brain',
        content: result.answer || getBrainResponse(nextQuestion, cardsForAnswer),
        createdAt: Date.now(),
        sources: result.sources || [],
        webSources: dedupedWebSources,
      }]);
    } catch (error: any) {
      toast.error(chatMode === 'work'
        ? `${error.message || 'Brain AI failed.'} Using local card answer.`
        : error.message || 'Brain AI failed.'
      );
      setMessages(prev => [...prev, {
        id: `brain_${Date.now()}`,
        role: 'brain',
        content: chatMode === 'work'
          ? getBrainResponse(nextQuestion, cardsForAnswer)
          : 'I could not reach grounded AI for this mode. Check Gemini/Supabase setup and try again.',
        createdAt: Date.now(),
      }]);
    } finally {
      setIsThinking(false);
    }
  };

  return (
    <div className="brain-page mx-auto flex w-full max-w-[1680px] flex-col overflow-x-clip px-4 py-6 sm:px-6 lg:h-full lg:min-h-0 lg:overflow-hidden lg:px-8">
      <PageHeader
        icon={BrainIcon}
        title="Brain"
        subtitle="Capture learnings, rebuild centralized memory, and chat across the Pulse data for this account."
        compact
        className="shrink-0"
      />

      <div className="flex min-h-0 flex-col gap-6 lg:flex-1 lg:flex-row">
        <aside className="glass-panel flex max-h-[340px] shrink-0 flex-col p-4 lg:max-h-none lg:min-h-0 lg:w-72">
          <div className="mb-3 flex items-center justify-between">
            <p className="lux-label">Library</p>
            <span className="glass-chip px-2 py-0.5 text-[10px] font-semibold">{cards.length}</span>
          </div>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-[1.75] text-[var(--lux-soft)]" />
            <Input
              value={cardQuery}
              onChange={(event) => setCardQuery(event.target.value)}
              placeholder="Filter cards..."
              className="h-9 pl-9 text-sm"
            />
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {filteredCards.length === 0 ? (
              <p className="rounded-xl border border-[var(--lux-border)] bg-[var(--lux-fill)] p-3 text-sm text-[var(--lux-muted)]">
                {cards.length === 0 ? 'No Brain cards yet. Create one below.' : 'No cards match your filter.'}
              </p>
            ) : (
              filteredCards.map(card => (
                <button
                  key={card.id}
                  onClick={() => {
                    if (selectedCardId === card.id && isEditorOpen) {
                      setIsEditorOpen(false);
                      return;
                    }
                    setSelectedCardId(card.id);
                    setIsEditorOpen(true);
                  }}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${
                    selectedCardId === card.id && isEditorOpen
                      ? 'border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]'
                      : 'border-transparent hover:bg-[var(--lux-fill)]'
                  }`}
                >
                  <p className="truncate text-sm font-semibold text-[var(--lux-text)]">{card.title}</p>
                  <p className="mt-1 text-[11px] text-[var(--lux-muted)]">
                    Updated {formatDistanceToNow(card.updatedAt, { addSuffix: true })}
                  </p>
                </button>
              ))
            )}
          </div>

          <div className="mt-3 flex gap-2 border-t border-[var(--lux-border)] pt-3">
            <Input
              value={newCardTitle}
              onChange={(event) => setNewCardTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  createCard();
                }
              }}
              placeholder="New card topic"
              className="h-9 text-sm"
            />
            <Button onClick={() => createCard()} className="glass-btn glass-btn-gold h-9 px-3" title="Create card">
              <Plus className="h-4 w-4 stroke-[1.75]" />
            </Button>
          </div>
        </aside>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <Card className="brain-chat-card flex min-h-0 flex-col overflow-hidden p-0 lg:h-full">
          <CardHeader className="shrink-0 p-4 border-b border-[var(--lux-border)] bg-[var(--lux-fill)]">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="font-display flex items-center gap-2 text-lg font-semibold text-[var(--lux-text)]">
                <MessageCircle className="w-5 h-5 stroke-[1.75] text-[var(--lux-gold)]" />
                Brain Chat
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button onClick={requestNewChat} className="glass-btn px-3" title="New chat">
                  <Plus className="w-4 h-4 stroke-[1.75]" />
                </Button>
                <Popover open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        className="glass-btn px-3"
                        title="Saved chats"
                      />
                    }
                  >
                    <History className="h-4 w-4 stroke-[1.75]" />
                    <span className="hidden text-xs font-semibold sm:inline">{savedChats.length}</span>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={8}
                    className="w-[min(380px,calc(100vw-2rem))] p-3"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--lux-border)] pb-2">
                      <p className="lux-label flex items-center gap-2">
                        <History className="h-4 w-4 stroke-[1.75]" />
                        Saved Chats
                      </p>
                      <span className="glass-chip px-2 py-0.5 text-[10px] font-semibold">
                        {savedChats.length}
                      </span>
                    </div>
                    {savedChats.length === 0 ? (
                      <p className="rounded-xl border border-[var(--lux-border)] bg-[var(--lux-fill)] p-3 text-sm text-[var(--lux-muted)]">
                        No saved chats yet.
                      </p>
                    ) : (
                      <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                        {savedChats.map(chat => (
                          <button
                            key={chat.id}
                            onClick={() => loadSavedChat(chat)}
                            className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${selectedChatId === chat.id ? 'border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]' : 'border-[var(--lux-border)] hover:bg-[var(--lux-fill)]'}`}
                          >
                            <span className="block truncate text-xs font-semibold text-[var(--lux-text)]">{chat.title}</span>
                            <span className="mt-1 block text-[11px] text-[var(--lux-muted)]">
                              {formatDistanceToNow(chat.updatedAt, { addSuffix: true })}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
                {canSummarize && (
                  <Button
                    onClick={summarizeOlderHistory}
                    disabled={isSummarizing || isThinking}
                    className="glass-btn px-3"
                    title={`Compress the ${compressibleOlderCount} oldest messages into a summary`}
                  >
                    <Scissors className={`w-4 h-4 stroke-[1.75] ${isSummarizing ? 'animate-pulse' : ''}`} />
                  </Button>
                )}
                <Button onClick={saveCurrentChat} className="glass-btn glass-btn-emerald px-3" title="Save chat">
                  <Save className="w-4 h-4 stroke-[1.75]" />
                </Button>
                <Button onClick={deleteSavedChat} className="glass-btn glass-btn-ruby px-3" title="Delete saved chat">
                  <Trash2 className="w-4 h-4 stroke-[1.75]" />
                </Button>
                <Popover open={isMemoryMenuOpen} onOpenChange={setIsMemoryMenuOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        className="glass-btn px-3"
                        title="Memory maintenance"
                        aria-label="Memory maintenance"
                      />
                    }
                  >
                    <Database className={`h-4 w-4 stroke-[1.75] ${isIndexing || isResetting ? 'animate-pulse text-[var(--lux-gold)]' : ''}`} />
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={8} className="w-72 p-2">
                    <p className="lux-label px-2 pb-2 pt-1">Memory</p>
                    <button
                      onClick={() => {
                        setIsMemoryMenuOpen(false);
                        rebuildMemory();
                      }}
                      disabled={isIndexing || isResetting}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm font-medium text-[var(--lux-text)] transition-colors hover:bg-[var(--lux-fill)] disabled:pointer-events-none disabled:opacity-50"
                      title="Re-index everything (cards, chats, logs, DSPs, tags, profile). Cards & chats already auto-index on save — use this for Fleet/Logbook changes or to force a full reconcile."
                    >
                      <RefreshCw className={`h-4 w-4 stroke-[1.75] text-[var(--lux-gold)] ${isIndexing ? 'animate-spin' : ''}`} />
                      {isIndexing ? 'Indexing…' : 'Rebuild Memory'}
                    </button>
                    <p className="px-2 pb-2 pt-0.5 text-[11px] leading-snug text-[var(--lux-soft)]">
                      Re-index cards, chats, logs, DSPs, tags and profile.
                    </p>
                    <div className="my-1 border-t border-[var(--lux-border)]" />
                    <button
                      onClick={() => {
                        setIsMemoryMenuOpen(false);
                        requestResetMemory();
                      }}
                      disabled={isIndexing || isResetting}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm font-medium text-[var(--lux-ruby)] transition-colors hover:bg-[var(--lux-ruby-fill)] disabled:pointer-events-none disabled:opacity-50"
                      title="Reset the Supabase vector index and rebuild it from current Pulse records."
                    >
                      <Eraser className={`h-4 w-4 stroke-[1.75] ${isResetting ? 'animate-pulse' : ''}`} />
                      {isResetting ? 'Resetting…' : 'Reset & Rebuild…'}
                    </button>
                    <p className="px-2 pb-1 pt-0.5 text-[11px] leading-snug text-[var(--lux-soft)]">
                      Wipes the AI index, then rebuilds it. Your records stay safe.
                    </p>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
            <div ref={messagesScrollRef} className="min-h-[260px] flex-1 basis-0 space-y-3 overflow-y-auto overscroll-contain pr-1">
              {messages.map(message => {
                const hasWebSources = (message.webSources?.length ?? 0) > 0;
                const hasPrivateSources = (message.sources?.length ?? 0) > 0;
                const showSources = message.role === 'brain' && (hasWebSources || hasPrivateSources);
                const sourceCount = (message.webSources?.length ?? 0) + (message.sources?.length ?? 0);
                const isSummary = message.kind === 'summary';
                return (
                  <div
                    key={message.id}
                    className={`rounded-2xl border p-3.5 text-sm [overflow-wrap:anywhere] ${
                      isSummary
                        ? 'mx-4 border-dashed border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]'
                        : message.role === 'user'
                          ? 'ml-8 border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]'
                          : 'mr-8 border-[var(--lux-border)] bg-[var(--lux-fill)]'
                    }`}
                  >
                    {isSummary && (
                      <div className="lux-label mb-2 flex items-center gap-1.5 text-[10px]">
                        <Sparkles className="h-3 w-3 stroke-[1.75] text-[var(--lux-gold)]" />
                        Summary of {message.compressedCount ?? '?'} earlier messages
                      </div>
                    )}
                    {message.role === 'brain' ? (
                      <MarkdownMessage content={message.content} />
                    ) : (
                      <p className="whitespace-pre-wrap leading-7">{message.content}</p>
                    )}
                    {showSources && (
                      <div className="mt-3 flex min-w-0 items-center gap-2 border-t border-[var(--lux-border)] pt-3">
                        <div className="lux-label flex shrink-0 items-center gap-1.5 text-[10px]">
                          <Link2 className="h-3 w-3 stroke-[1.75]" />
                          Sources
                          <span className="rounded-full border border-[var(--lux-border)] px-1.5 py-0.5 text-[9px] tracking-normal">
                            {sourceCount}
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                          {message.webSources?.map((source, index) =>
                            source.uri ? (
                              <a
                                key={`web-${index}`}
                                href={source.uri}
                                target="_blank"
                                rel="noreferrer"
                                className="glass-chip max-w-[180px] shrink-0 px-2.5 py-1 text-[11px] font-medium leading-none transition-colors hover:border-[var(--lux-gold-border)] hover:text-[var(--lux-gold)]"
                                title={source.uri}
                              >
                                <ExternalLink className="h-3 w-3 shrink-0 stroke-[1.75] text-[var(--lux-soft)]" />
                                <span className="truncate">{source.title || source.uri}</span>
                              </a>
                            ) : (
                              <span
                                key={`web-${index}`}
                                className="glass-chip max-w-[180px] shrink-0 px-2.5 py-1 text-[11px] font-medium leading-none"
                                title={source.title || 'Web'}
                              >
                                <ExternalLink className="h-3 w-3 shrink-0 stroke-[1.75] text-[var(--lux-soft)]" />
                                <span className="truncate">{source.title || 'Web'}</span>
                              </span>
                            )
                          )}
                          {message.sources?.map((source, index) => (
                            <span
                              key={`priv-${index}`}
                              className="glass-chip max-w-[190px] shrink-0 px-2.5 py-1 text-[11px] font-medium leading-none"
                              title={`${source.title} (${source.type.replace(/_/g, ' ')})`}
                            >
                              <span className="truncate">{source.title}</span>
                              <span className="shrink-0 rounded-full border border-[var(--lux-border)] bg-[var(--lux-fill)] px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-[var(--lux-soft)]">
                                {source.type.replace(/_/g, ' ')}
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {isThinking && (
                <div className="mr-8 animate-pulse rounded-2xl border border-[var(--lux-border)] bg-[var(--lux-fill)] p-3.5 text-sm text-[var(--lux-muted)]">
                  {chatMode === 'web' ? 'Checking the web with grounding...' : 'Thinking from grounded memory...'}
                </div>
              )}
            </div>
            <div className="mt-auto flex shrink-0 flex-wrap items-center gap-2">
              <div className="flex shrink-0 rounded-full border border-[var(--lux-border)] bg-[var(--lux-fill)] p-1" role="group" aria-label="Chat mode">
                {CHAT_MODES.map(mode => {
                  const ModeIcon = mode.icon;
                  const isActive = chatMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      onClick={() => setChatMode(mode.id)}
                      title={`${mode.help} ${COMPACT_CHAT_MODE_HELP[mode.id]}`}
                      aria-pressed={isActive}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-[var(--lux-gold-fill)] text-[var(--lux-gold)]'
                          : 'text-[var(--lux-muted)] hover:text-[var(--lux-text)]'
                      }`}
                    >
                      <ModeIcon className="h-3.5 w-3.5 stroke-[1.75]" />
                      <span className="hidden md:inline">{mode.label}</span>
                    </button>
                  );
                })}
              </div>
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    askBrain();
                  }
                }}
                placeholder="Ask your Brain..."
                className="min-w-0 flex-1"
                disabled={isThinking}
              />
              <Button onClick={askBrain} disabled={isThinking} className="glass-btn glass-btn-gold px-3.5">
                <Send className="w-4 h-4 stroke-[1.75]" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {isEditorOpen && selectedCard && (
          <div ref={editorPanelRef} className="glass-strong absolute inset-0 z-20 flex flex-col rounded-3xl p-5 animate-in fade-in-0 slide-in-from-right-4 duration-200">
            <div className="flex flex-col gap-3 border-b border-[var(--lux-border)] pb-4 md:flex-row md:items-center md:justify-between">
              <Input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                className="font-display text-xl font-semibold"
              />
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button onClick={() => fileInputRef.current?.click()} className="glass-btn">
                  <Upload className="w-4 h-4 stroke-[1.75]" />
                  <span className="hidden sm:inline">Upload Text</span>
                </Button>
                <Button onClick={saveSelectedCard} className="glass-btn glass-btn-emerald">
                  <Save className="w-4 h-4 stroke-[1.75]" />
                  <span className="hidden sm:inline">Save</span>
                </Button>
                <Button onClick={deleteSelectedCard} className="glass-btn glass-btn-ruby px-3" title="Delete card">
                  <Trash2 className="w-4 h-4 stroke-[1.75]" />
                </Button>
                <Button
                  onClick={() => setIsEditorOpen(false)}
                  className="glass-btn"
                  title="Close editor and return to chat"
                  aria-label="Close editor"
                >
                  <X className="w-4 h-4 stroke-[1.75]" />
                  <span className="hidden sm:inline">Back to Chat</span>
                </Button>
              </div>
            </div>

            <RichMarkdownEditor
              value={draftContent}
              onChange={setDraftContent}
            />
          </div>
        )}
        </div>
      </div>

      <Dialog open={isNewChatDialogOpen} onOpenChange={setIsNewChatDialogOpen}>
        <DialogContent className="max-w-md gap-0 p-0" showCloseButton={false}>
          <DialogHeader className="border-b border-[var(--lux-border)] p-5">
            <DialogTitle className="text-2xl">Start New Chat?</DialogTitle>
            <DialogDescription>
              Your current Brain chat is only stored as one local draft on this Mac.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 p-5 text-sm text-[var(--lux-muted)]">
            <p>Save it to Brain chats, discard it completely from this device, or cancel and keep working.</p>
          </div>
          <DialogFooter className="m-0 border-t border-[var(--lux-border)] bg-[var(--lux-fill)] p-4">
            <Button
              onClick={() => setIsNewChatDialogOpen(false)}
              className="glass-btn"
            >
              Cancel
            </Button>
            <Button
              onClick={discardDraftAndStartNewChat}
              className="glass-btn glass-btn-ruby"
            >
              Discard
            </Button>
            <Button
              onClick={saveDraftAndStartNewChat}
              className="glass-btn glass-btn-gold"
            >
              <Save className="h-4 w-4 stroke-[1.75]" />
              Save Current
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isResetMemoryDialogOpen} onOpenChange={setIsResetMemoryDialogOpen}>
        <DialogContent className="max-w-lg gap-0 p-0" showCloseButton={false}>
          <DialogHeader className="border-b border-[var(--lux-border)] p-5">
            <DialogTitle className="text-2xl">Reset Brain Memory?</DialogTitle>
            <DialogDescription>
              This repairs the AI search index used by Brain Chat. It does not delete your actual Pulse records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 p-5 text-sm text-[var(--lux-muted)]">
            <div>
              <p className="lux-label mb-2">What it will do</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Delete only your Supabase `brain_chunks` rows, which are AI memory/index copies.</li>
                <li>Rebuild that memory from your current profile, Fleet DSPs, logs, tags, Brain cards, and saved chats.</li>
                <li>Fix cases where Brain Chat still cites old records you already deleted.</li>
              </ul>
            </div>
            <div>
              <p className="lux-label mb-2">What it will not delete</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Your Brain cards, saved chats, Fleet data, logs, tags, profile, attachments, and AI keys stay in place.</li>
                <li>It does not clear local chat drafts or browser storage.</li>
              </ul>
            </div>
            <p className="rounded-xl border border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)] p-3 text-[var(--lux-text)]">
              Requires a Gemini key because rebuilding uses Gemini embeddings. If Supabase is unreachable, nothing is reset and you can retry after fixing the connection.
            </p>
          </div>
          <DialogFooter className="m-0 border-t border-[var(--lux-border)] bg-[var(--lux-fill)] p-4">
            <Button
              onClick={() => setIsResetMemoryDialogOpen(false)}
              disabled={isResetting || isIndexing}
              className="glass-btn"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmResetAndRebuildMemory}
              disabled={isResetting || isIndexing}
              className="glass-btn glass-btn-ruby"
            >
              <Eraser className={`h-4 w-4 stroke-[1.75] ${isResetting ? 'animate-pulse' : ''}`} />
              {isResetting ? 'Resetting…' : 'Reset & Rebuild'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
