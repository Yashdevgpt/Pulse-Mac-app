import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Brain as BrainIcon, Eraser, ExternalLink, FileText, History, Link2, MessageCircle, Plus, RefreshCw, Save, Scissors, Send, Sparkles, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import MarkdownMessage from '@/components/MarkdownMessage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CHAT_MODES, CHAT_WELCOME } from '@/features/brain/constants';
import { extractKnowledgeFile } from '@/features/brain/file-extraction';
import { getBrainResponse, getGroundingPassages } from '@/features/brain/grounding';
import type { ChatMessage, ExtractedKnowledgeFile } from '@/features/brain/types';
import { auth } from '@/lib/firebase';
import { db, BrainCard, BrainChat } from '@/lib/db';
import {
  askBrainAi,
  buildCentralizedBrainSources,
  cardToMemorySource,
  chatToMemorySource,
  deleteBrainMemorySource,
  indexBrainSource,
  indexBrainSources,
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
  const [messages, setMessages] = useState<ChatMessage[]>([CHAT_WELCOME]);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
        `${label === 'card' ? 'Card' : 'Chat'} saved, but Brain memory update failed. Click "Rebuild Memory" to retry.`
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

  const startNewChat = () => {
    setSelectedChatId('');
    setMessages([{ ...CHAT_WELCOME, createdAt: Date.now() }]);
  };

  const saveCurrentChat = async () => {
    const realMessages = messages.filter(message => message.id !== 'brain_welcome');
    if (realMessages.length === 0) {
      toast.error('Ask something before saving this chat.');
      return;
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

    await db.saveBrainChat(chat);
    setSavedChats(prev => [chat, ...prev.filter(item => item.id !== chat.id)]);
    setSelectedChatId(chat.id);
    toast.success('Brain chat saved.');
    indexInBackground(chatToMemorySource(chat), 'chat');
  };

  const loadSavedChat = (chat: BrainChat) => {
    setSelectedChatId(chat.id);
    setChatMode(chat.mode);
    setMessages(chat.messages.length > 0 ? chat.messages : [{ ...CHAT_WELCOME, createdAt: Date.now() }]);
  };

  const deleteSavedChat = async () => {
    if (!selectedChatId) {
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
      startNewChat();
      toast.success('Saved chat deleted');
    } catch (error: any) {
      toast.error(error.message || 'Could not delete saved chat.');
    }
  };

  const rebuildMemory = async () => {
    setIsIndexing(true);
    try {
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
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_380px] xl:items-start">
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

          <div className="space-y-3 xl:max-h-[calc(100vh-260px)] xl:overflow-y-auto xl:pr-2">
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

              <Textarea
                value={draftContent}
                onChange={(event) => setDraftContent(event.target.value)}
                placeholder="Write your learning here. Keep headings, bullets, links, examples, and next actions in plain text."
                className="mt-5 flex-1 min-h-[520px] resize-none rounded-none border-0 bg-white text-base leading-7 shadow-none focus-visible:ring-0"
              />
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <FileText className="w-12 h-12 text-zinc-400 mb-4" />
              <p className="font-black text-black uppercase">Create a card to start your Brain.</p>
            </div>
          )}
        </section>

        <Card className="neo-box flex h-[680px] min-h-0 flex-col overflow-hidden bg-white p-0 lg:col-span-2 lg:h-[720px] lg:max-h-[calc(100dvh-4rem)] xl:col-span-1 xl:h-[calc(100dvh-7rem)] xl:max-h-[900px] xl:sticky xl:top-4">
          <CardHeader className="shrink-0 p-4 border-b-3 border-black bg-[var(--color-neo-pink)]">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-black font-black uppercase">
                <MessageCircle className="w-5 h-5 stroke-[3]" />
                Brain Chat
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button onClick={startNewChat} className="neo-btn bg-white text-black px-3" title="New chat">
                  <Plus className="w-4 h-4 stroke-[3]" />
                </Button>
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
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {CHAT_MODES.map(mode => {
                const ModeIcon = mode.icon;
                return (
                  <button
                    key={mode.id}
                    onClick={() => setChatMode(mode.id)}
                    title={mode.help}
                    className={`border-3 border-black rounded-lg p-2 text-left transition-all xl:min-h-[76px] xl:text-center ${chatMode === mode.id ? 'bg-[var(--color-neo-yellow)] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]' : 'bg-white'}`}
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
            <div className="mt-4 flex gap-2">
              <Button
                onClick={rebuildMemory}
                disabled={isIndexing || isResetting}
                className="neo-btn bg-[var(--color-neo-cyan)] text-black flex-1"
                title="Re-index everything (cards, chats, logs, DSPs, tags, profile). Cards & chats already auto-index on save — use this for Fleet/Logbook changes or to force a full reconcile."
              >
                <RefreshCw className={`w-4 h-4 stroke-[3] ${isIndexing ? 'animate-spin' : ''}`} />
                {isIndexing ? 'Indexing…' : 'Rebuild Memory'}
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
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
            {savedChats.length > 0 && (
              <div className="shrink-0 space-y-2">
                <p className="text-xs font-black uppercase text-black flex items-center gap-2">
                  <History className="w-4 h-4 stroke-[3]" />
                  Saved Chats
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {savedChats.slice(0, 8).map(chat => (
                    <button
                      key={chat.id}
                      onClick={() => loadSavedChat(chat)}
                      className={`shrink-0 max-w-[180px] border-3 border-black rounded-lg px-3 py-2 text-left ${selectedChatId === chat.id ? 'bg-[var(--color-neo-green)]' : 'bg-white'}`}
                    >
                      <span className="block truncate text-xs font-black uppercase text-black">{chat.title}</span>
                      <span className="block text-[11px] font-bold text-zinc-600 mt-1">
                        {formatDistanceToNow(chat.updatedAt, { addSuffix: true })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesScrollRef} className="min-h-0 flex-1 basis-0 space-y-3 overflow-y-auto overscroll-contain pr-1">
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
    </div>
  );
}
