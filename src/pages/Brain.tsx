import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Brain as BrainIcon, Eraser, ExternalLink, FileText, History, Link2, MessageCircle, Plus, RefreshCw, Save, Scissors, Send, Sparkles, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import MarkdownMessage from '@/components/MarkdownMessage';
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
  const [messages, setMessages] = useState<ChatMessage[]>([CHAT_WELCOME]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftRestoredRef = useRef(false);
  const draftSizeWarningShownRef = useRef(false);
  // Pinned to the messages list so we can keep the newest reply visible without
  // forcing the user to scroll. Auto-snaps to the bottom whenever the messages
  // array grows.
  const messagesScrollRef = useRef<HTMLDivElement>(null);

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

      const result = await indexBrainSources(sources);
      toast.success(`Memory rebuilt with ${result.indexed} chunks across Pulse data`);
    } catch (error: any) {
      toast.error(error.message || 'Could not rebuild Brain memory.');
    } finally {
      setIsIndexing(false);
    }
  };

  // "Hard reset" — wipes every Supabase brain_chunks row owned by this user
  // and then re-indexes from current Firestore state. Use this when chat
  // sources cite records that have been deleted from Pulse (i.e. orphan
  // entries from the period before delete-paths cascaded into Brain memory).
  const resetAndRebuildMemory = async () => {
    if (isResetting || isIndexing) return;
    try {
      requireBrainMemoryGeminiKey();
    } catch (error: any) {
      toast.error(error?.message || 'Configure a Gemini API key before resetting Brain memory.');
      return;
    }
    const confirmed = window.confirm(
      'Reset Brain memory and rebuild from scratch?\n\n' +
      'This wipes every Supabase row stored for your account and then re-indexes ' +
      'from the current Fleet, Brain cards, and saved chats. Use it if chat ' +
      'sources still cite deleted records.'
    );
    if (!confirmed) return;

    setIsResetting(true);
    try {
      const result = await resetBrainMemory();
      toast.success(`Wiped ${result.deleted} memory chunk${result.deleted === 1 ? '' : 's'}. Rebuilding…`);
      await rebuildMemory();
    } catch (error: any) {
      toast.error(error.message || 'Could not reset Brain memory.');
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
    <div className="mx-auto max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-3 border-black bg-[var(--color-neo-cyan)] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <BrainIcon className="h-6 w-6 text-black stroke-[3]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-3xl font-black uppercase tracking-tight text-black sm:text-4xl">Brain</h1>
          <p className="mt-1 max-w-2xl text-sm font-medium text-zinc-600 sm:text-base">
            Capture learnings, rebuild centralized memory, and chat across the Pulse data for this account.
          </p>
        </div>
      </div>

      <div className="brain-workspace-grid grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:items-start">
        <section className="space-y-4">
          <div className="neo-box bg-white p-4 space-y-3">
            <label className="text-sm font-bold uppercase text-black">New Card</label>
            <Input
              value={newCardTitle}
              onChange={(event) => setNewCardTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  createCard();
                }
              }}
              placeholder="Topic name"
              className="neo-input bg-white"
            />
            <Button onClick={() => createCard()} className="neo-btn bg-[var(--color-neo-yellow)] w-full text-black">
              <Plus className="w-4 h-4 stroke-[3]" />
              Create Card
            </Button>
          </div>

          <div className="max-h-[360px] space-y-3 overflow-y-auto pr-2 lg:max-h-[calc(100dvh-260px)]">
            {cards.length === 0 ? (
              <div className="neo-box bg-white p-4 text-sm font-bold text-zinc-500">
                No Brain cards yet.
              </div>
            ) : (
              cards.map(card => (
                <button
                  key={card.id}
                  onClick={() => setSelectedCardId(card.id)}
                  className={`neo-box w-full p-4 text-left transition-all ${selectedCardId === card.id ? 'bg-[var(--color-neo-green)]' : 'bg-white hover:bg-zinc-50'}`}
                >
                  <p className="font-black text-black uppercase truncate">{card.title}</p>
                  <p className="text-xs font-bold text-zinc-600 mt-2">
                    Updated {formatDistanceToNow(card.updatedAt, { addSuffix: true })}
                  </p>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="neo-box flex min-h-[620px] flex-col bg-white p-5">
          {selectedCard ? (
            <>
              <div className="flex flex-col gap-3 border-b-3 border-black pb-4 md:flex-row md:items-center md:justify-between">
                <Input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  className="neo-input bg-white text-xl font-black uppercase"
                />
                <div className="flex flex-wrap gap-2 shrink-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <Button onClick={() => fileInputRef.current?.click()} className="neo-btn bg-[var(--color-neo-cyan)] text-black">
                    <Upload className="w-4 h-4 stroke-[3]" />
                    <span className="hidden sm:inline">Upload Text</span>
                  </Button>
                  <Button onClick={saveSelectedCard} className="neo-btn bg-[var(--color-neo-green)] text-black">
                    <Save className="w-4 h-4 stroke-[3]" />
                    <span className="hidden sm:inline">Save</span>
                  </Button>
                  <Button onClick={deleteSelectedCard} className="neo-btn bg-red-500 text-white px-3" title="Delete card">
                    <Trash2 className="w-4 h-4 stroke-[3]" />
                  </Button>
                </div>
              </div>

              <RichMarkdownEditor
                value={draftContent}
                onChange={setDraftContent}
              />
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <FileText className="w-12 h-12 text-zinc-400 mb-4" />
              <p className="font-black text-black uppercase">Create a card to start your Brain.</p>
            </div>
          )}
        </section>

        <Card className="brain-chat-card neo-box flex min-h-0 flex-col overflow-hidden bg-white p-0 lg:col-span-2 xl:col-span-1 xl:sticky xl:top-4">
          <CardHeader className="shrink-0 p-4 border-b-3 border-black bg-[var(--color-neo-violet)]">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-black font-black uppercase">
                <MessageCircle className="w-5 h-5 stroke-[3]" />
                Brain Chat
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button onClick={requestNewChat} className="neo-btn bg-white text-black px-3" title="New chat">
                  <Plus className="w-4 h-4 stroke-[3]" />
                </Button>
                <Popover open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        className="neo-btn bg-white px-3 text-black"
                        title="Saved chats"
                      />
                    }
                  >
                    <History className="h-4 w-4 stroke-[3]" />
                    <span className="hidden text-xs font-black sm:inline">{savedChats.length}</span>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    sideOffset={8}
                    className="neo-box w-[min(380px,calc(100vw-2rem))] border-3 border-black bg-white p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3 border-b-3 border-black pb-2">
                      <p className="flex items-center gap-2 text-xs font-black uppercase text-black">
                        <History className="h-4 w-4 stroke-[3]" />
                        Saved Chats
                      </p>
                      <span className="rounded-full border-2 border-black px-2 py-0.5 text-[10px] font-black text-black">
                        {savedChats.length}
                      </span>
                    </div>
                    {savedChats.length === 0 ? (
                      <p className="rounded-lg border-3 border-black bg-white p-3 text-sm font-bold text-[var(--color-neo-muted)]">
                        No saved chats yet.
                      </p>
                    ) : (
                      <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                        {savedChats.map(chat => (
                          <button
                            key={chat.id}
                            onClick={() => loadSavedChat(chat)}
                            className={`w-full rounded-lg border-3 border-black px-3 py-2 text-left transition-colors ${selectedChatId === chat.id ? 'bg-[var(--color-neo-green)]' : 'bg-white hover:bg-zinc-50'}`}
                          >
                            <span className="block truncate text-xs font-black uppercase text-black">{chat.title}</span>
                            <span className="mt-1 block text-[11px] font-bold text-zinc-600">
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
                    className="neo-btn bg-[var(--color-neo-cyan)] text-black px-3"
                    title={`Compress the ${compressibleOlderCount} oldest messages into a summary`}
                  >
                    <Scissors className={`w-4 h-4 stroke-[3] ${isSummarizing ? 'animate-pulse' : ''}`} />
                  </Button>
                )}
                <Button onClick={saveCurrentChat} className="neo-btn bg-[var(--color-neo-green)] text-black px-3" title="Save chat">
                  <Save className="w-4 h-4 stroke-[3]" />
                </Button>
                <Button onClick={deleteSavedChat} className="neo-btn bg-red-500 text-white px-3" title="Delete saved chat">
                  <Trash2 className="w-4 h-4 stroke-[3]" />
                </Button>
              </div>
            </div>
            <div className="brain-chat-control-row mt-4 grid grid-cols-1 gap-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {CHAT_MODES.map(mode => {
                  const ModeIcon = mode.icon;
                  return (
                    <button
                      key={mode.id}
                      onClick={() => setChatMode(mode.id)}
                      title={mode.help}
                      aria-pressed={chatMode === mode.id}
                      className={`border-3 border-black rounded-lg p-2 text-left transition-all xl:text-center ${chatMode === mode.id ? 'bg-[var(--color-neo-yellow)] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]' : 'bg-white'}`}
                    >
                      <span className="flex items-center gap-2 font-black text-xs uppercase text-black xl:justify-center xl:text-[11px]">
                        <ModeIcon className="w-4 h-4 stroke-[3]" />
                        {mode.label}
                      </span>
                      <span className={`mt-1 block text-[11px] font-bold xl:hidden ${chatMode === mode.id ? 'text-black' : 'text-[var(--color-neo-muted)]'}`}>
                        {mode.help}
                      </span>
                      <span className={`mt-1 hidden text-[9px] font-bold leading-tight xl:block ${chatMode === mode.id ? 'text-black' : 'text-[var(--color-neo-muted)]'}`}>
                        {COMPACT_CHAT_MODE_HELP[mode.id]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex min-w-0 gap-2">
                <Button
                  onClick={rebuildMemory}
                  disabled={isIndexing || isResetting}
                  className="neo-btn bg-[var(--color-neo-cyan)] text-black flex-1"
                  title="Re-index everything (cards, chats, logs, DSPs, tags, profile). Cards & chats already auto-index on save — use this for Fleet/Logbook changes or to force a full reconcile."
                >
                  <RefreshCw className={`w-4 h-4 stroke-[3] ${isIndexing ? 'animate-spin' : ''}`} />
                  <span className="truncate">{isIndexing ? 'Indexing…' : 'Rebuild Memory'}</span>
                </Button>
                <Button
                  onClick={resetAndRebuildMemory}
                  disabled={isIndexing || isResetting}
                  className="neo-btn bg-white text-black px-3"
                  title="Wipe Brain memory and rebuild from scratch. Use this if chat sources still cite records you've deleted from Pulse."
                  aria-label="Reset Brain memory"
                >
                  <Eraser className={`w-4 h-4 stroke-[3] ${isResetting ? 'animate-pulse' : ''}`} />
                </Button>
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
                    className={`border-3 border-black rounded-lg p-3 text-sm ${
                      isSummary
                        ? 'bg-[var(--color-neo-cyan)]/30 mx-4 border-dashed'
                        : message.role === 'user'
                          ? 'bg-[var(--color-neo-yellow)] ml-8'
                          : 'bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] mr-8'
                    }`}
                  >
                    {isSummary && (
                      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-black/70">
                        <Sparkles className="h-3 w-3 stroke-[3]" />
                        Summary of {message.compressedCount ?? '?'} earlier messages
                      </div>
                    )}
                    {message.role === 'brain' ? (
                      <MarkdownMessage content={message.content} />
                    ) : (
                      <p className="whitespace-pre-wrap leading-7">{message.content}</p>
                    )}
                    {showSources && (
                      <div className="mt-3 flex min-w-0 items-center gap-2 border-t-2 border-black/10 pt-3">
                        <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-black/70">
                          <Link2 className="h-3 w-3 stroke-[3]" />
                          Sources
                          <span className="rounded-full border border-black/20 px-1.5 py-0.5 text-[9px] tracking-normal">
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
                                className="flex max-w-[180px] shrink-0 items-center gap-1.5 rounded-full border-2 border-black/20 bg-black/5 px-2.5 py-1 text-[11px] font-black leading-none text-black transition-colors hover:border-black hover:bg-[var(--color-neo-yellow)]"
                                title={source.uri}
                              >
                                <ExternalLink className="h-3 w-3 shrink-0 stroke-[3] text-black/60" />
                                <span className="truncate">{source.title || source.uri}</span>
                              </a>
                            ) : (
                              <span
                                key={`web-${index}`}
                                className="flex max-w-[180px] shrink-0 items-center gap-1.5 rounded-full border-2 border-black/20 bg-black/5 px-2.5 py-1 text-[11px] font-black leading-none text-black"
                                title={source.title || 'Web'}
                              >
                                <ExternalLink className="h-3 w-3 shrink-0 stroke-[3] text-black/60" />
                                <span className="truncate">{source.title || 'Web'}</span>
                              </span>
                            )
                          )}
                          {message.sources?.map((source, index) => (
                            <span
                              key={`priv-${index}`}
                              className="flex max-w-[190px] shrink-0 items-center gap-1.5 rounded-full border-2 border-black/20 bg-[var(--color-neo-cyan)]/20 px-2.5 py-1 text-[11px] font-black leading-none text-black"
                              title={`${source.title} (${source.type.replace(/_/g, ' ')})`}
                            >
                              <span className="truncate">{source.title}</span>
                              <span className="shrink-0 rounded-full border border-black/20 bg-white/70 px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-black/50">
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
                <div className="border-3 border-black rounded-lg p-3 text-sm bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] mr-8 font-bold">
                  {chatMode === 'web' ? 'Checking the web with grounding...' : 'Thinking from grounded memory...'}
                </div>
              )}
            </div>
            <div className="mt-auto flex shrink-0 gap-2">
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
                className="neo-input min-w-0 bg-white"
                disabled={isThinking}
              />
              <Button onClick={askBrain} disabled={isThinking} className="neo-btn bg-black text-white px-3">
                <Send className="w-4 h-4 stroke-[3]" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isNewChatDialogOpen} onOpenChange={setIsNewChatDialogOpen}>
        <DialogContent className="neo-box max-w-md border-4 border-black bg-white p-0" showCloseButton={false}>
          <DialogHeader className="border-b-4 border-black bg-[var(--color-neo-yellow)] p-5">
            <DialogTitle className="text-2xl font-black uppercase text-black">Start New Chat?</DialogTitle>
            <DialogDescription className="font-bold text-black">
              Your current Brain chat is only stored as one local draft on this Mac.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 p-5 text-sm font-bold text-zinc-700">
            <p>Save it to Brain chats, discard it completely from this device, or cancel and keep working.</p>
          </div>
          <DialogFooter className="border-t-4 border-black bg-zinc-100 p-4">
            <Button
              onClick={() => setIsNewChatDialogOpen(false)}
              className="neo-btn bg-white text-black"
            >
              Cancel
            </Button>
            <Button
              onClick={discardDraftAndStartNewChat}
              className="neo-btn bg-red-500 text-white"
            >
              Discard
            </Button>
            <Button
              onClick={saveDraftAndStartNewChat}
              className="neo-btn bg-[var(--color-neo-green)] text-black"
            >
              <Save className="h-4 w-4 stroke-[3]" />
              Save Current
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
