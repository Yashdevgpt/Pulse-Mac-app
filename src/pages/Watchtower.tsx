import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Activity, Check, CheckCircle2, ChevronDown, Clock, Plus, SlidersHorizontal, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';

import { db, Log, Tag } from '@/lib/db';
import { autoIndexFleetLog, autoIndexTagRecord, deleteBrainMemorySource } from '@/lib/brainApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// Tailwind background classes used as the color palette for new tags. Kept in
// sync with the DEFAULT_TAGS palette in src/lib/db.ts so the look is uniform.
const TAG_COLOR_PALETTE = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-green-500',
  'bg-red-500',
  'bg-orange-500',
  'bg-indigo-500',
  'bg-cyan-500',
  'bg-yellow-500',
];

type OngoingWatchtowerLog = Log & { dspName: string };

export default function Watchtower() {
  const [ongoingLogs, setOngoingLogs] = useState<OngoingWatchtowerLog[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [visibleTagIds, setVisibleTagIds] = useState<string[]>([]);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolutionFile, setResolutionFile] = useState<{ name: string; data: string; type: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Controlled Filter Tags popover. The popover is portaled to <body> with
  // fixed positioning so it escapes the Card's overflow-hidden (which was
  // previously clipping the lower half of the panel). The trigger's bounding
  // rect drives placement and is recomputed on resize / scroll.
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_COLOR_PALETTE[0]);
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const closeFilterPopover = () => {
    setIsFilterOpen(false);
    setShowNewTagForm(false);
  };

  useEffect(() => {
    if (!isFilterOpen) return;
    const updateRect = () => {
      if (triggerRef.current) {
        setTriggerRect(triggerRef.current.getBoundingClientRect());
      }
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [isFilterOpen]);

  useEffect(() => {
    if (!isFilterOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideTrigger = triggerRef.current?.contains(target);
      const insidePopover = popoverRef.current?.contains(target);
      if (!insideTrigger && !insidePopover) {
        closeFilterPopover();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFilterPopover();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isFilterOpen]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [ongoingLogsOnly, allDsps, allTags, preferences] = await Promise.all([
      db.getLogsByStatus('Ongoing'),
      db.getDSPs(),
      db.getTags(),
      db.getWatchtowerPreferences(),
    ]);

    const availableTagIds = allTags.map(tag => tag.id);
    const hasSavedPreferences = Array.isArray(preferences?.visibleTagIds);
    const storedVisibleTagIds = hasSavedPreferences
      ? preferences.visibleTagIds.filter(tagId => availableTagIds.includes(tagId))
      : [];
    const nextVisibleTagIds = hasSavedPreferences ? storedVisibleTagIds : availableTagIds;

    setTags(allTags);
    setVisibleTagIds(nextVisibleTagIds);

    const ongoing = ongoingLogsOnly
      .map(log => ({
        ...log,
        dspName: allDsps.find(dsp => dsp.id === log.dspId)?.name || 'Unknown DSP',
      }));

    setOngoingLogs(ongoing);
  };

  const persistVisibleTagIds = async (nextVisibleTagIds: string[]) => {
    setVisibleTagIds(nextVisibleTagIds);

    try {
      await db.saveWatchtowerPreferences({
        visibleTagIds: nextVisibleTagIds,
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.error('Could not save Watchtower preferences:', error);
      toast.error('Could not save Watchtower filters.');
    }
  };

  const handleSelectAllTags = () => {
    persistVisibleTagIds(tags.map(tag => tag.id));
  };

  const handleToggleTag = (tagId: string) => {
    const nextVisibleTagIds = visibleTagIds.includes(tagId)
      ? visibleTagIds.filter(id => id !== tagId)
      : [...visibleTagIds, tagId];

    persistVisibleTagIds(nextVisibleTagIds);
  };

  const handleDeleteTag = async (tag: Tag) => {
    const confirmed = window.confirm(
      `Delete tag "${tag.name}"?\n\nIt will be removed from Brain memory and from the Watchtower filter. Existing logs that already carry this tag will keep their reference (it just stops rendering until you re-create a tag with the same id).`
    );
    if (!confirmed) return;

    // Optimistic local removal so the popover updates instantly.
    const prevTags = tags;
    const prevVisible = visibleTagIds;
    const nextTags = tags.filter((item) => item.id !== tag.id);
    const nextVisible = visibleTagIds.filter((id) => id !== tag.id);
    setTags(nextTags);
    setVisibleTagIds(nextVisible);

    try {
      // Clear it from Brain memory first; if Firestore delete fails after,
      // the worst case is a phantom Supabase row, which we can rebuild from.
      await deleteBrainMemorySource('tag_record', tag.id).catch((error) => {
        console.warn('Brain memory tag delete soft-failed:', error?.message || error);
      });
      await db.deleteTag(tag.id);
      // Persist the trimmed visible set so the preference survives reloads.
      await db.saveWatchtowerPreferences({ visibleTagIds: nextVisible, updatedAt: Date.now() });
      toast.success(`Deleted tag "${tag.name}"`);
    } catch (error) {
      console.error('Could not delete tag:', error);
      // Roll back the optimistic UI change.
      setTags(prevTags);
      setVisibleTagIds(prevVisible);
      toast.error('Could not delete the tag. Try again.');
    }
  };

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) {
      toast.error('Tag name cannot be empty.');
      return;
    }
    if (tags.some(tag => tag.name.toLowerCase() === name.toLowerCase())) {
      toast.error('A tag with this name already exists.');
      return;
    }

    const tag: Tag = {
      id: `tag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      color: newTagColor,
    };

    setIsCreatingTag(true);
    try {
      await db.saveTag(tag);
      autoIndexTagRecord(tag);
      const nextTags = [...tags, tag];
      setTags(nextTags);
      // Make the new tag visible in Watchtower right away.
      await persistVisibleTagIds([...visibleTagIds, tag.id]);
      setNewTagName('');
      setNewTagColor(TAG_COLOR_PALETTE[0]);
      setShowNewTagForm(false);
      toast.success(`Created tag "${tag.name}"`);
    } catch (error) {
      console.error('Could not create tag:', error);
      toast.error('Could not create the tag. Try again.');
    } finally {
      setIsCreatingTag(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 800 * 1024) {
      toast.error('File is too large. Please keep it under 800KB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setResolutionFile({
        name: file.name,
        data: reader.result as string,
        type: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleResolve = async (logId: string) => {
    if (resolvingId !== logId) {
      setResolvingId(logId);
      setResolutionNote('');
      setResolutionFile(null);
      return;
    }

    const log = await db.getLog(logId);
    if (!log) return;

    log.status = 'Completed';
    log.updatedAt = Date.now();
    if (resolutionNote) log.resolutionNote = resolutionNote;
    if (resolutionFile) log.resolutionFile = resolutionFile;

    await db.saveLog(log);
    autoIndexFleetLog(log);
    toast.success('Task marked as completed');
    setResolvingId(null);
    setResolutionNote('');
    setResolutionFile(null);
    loadData();
  };

  const isShowingAllTags = tags.length > 0 && visibleTagIds.length === tags.length;

  const filteredLogs = useMemo(() => {
    if (isShowingAllTags) return ongoingLogs;
    if (visibleTagIds.length === 0) return [];

    return ongoingLogs.filter(log => log.tags.some(tagId => visibleTagIds.includes(tagId)));
  }, [isShowingAllTags, ongoingLogs, visibleTagIds]);

  const emptyState = ongoingLogs.length === 0
    ? {
        title: 'All clear. No ongoing tasks.',
        description: 'Watchtower only shows logs that are still marked as ongoing.',
      }
    : {
        title: 'No ongoing items match your Watchtower filters.',
        description: 'Enable more tags to surface additional items here.',
      };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-3 border-black bg-orange-500 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <Activity className="h-6 w-6 text-white stroke-[3]" />
        </div>
        <div className="min-w-0">
          <h1 className="text-3xl font-black uppercase tracking-tight text-black sm:text-4xl">Watchtower</h1>
          <p className="mt-1 max-w-2xl text-sm font-medium text-zinc-600 sm:text-base">
            Active monitoring tasks that need your attention. Choose which tags belong in Watchtower and the screen updates instantly.
          </p>
        </div>
      </div>

      <Card className="neo-box mb-6 overflow-hidden border-3 bg-[var(--color-neo-surface)] p-0">
        <CardHeader className="border-b-3 border-black bg-[var(--color-neo-surface-muted)] p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg font-black uppercase text-black">
                <SlidersHorizontal className="h-5 w-5 stroke-[3]" />
                Watchtower Visibility
              </CardTitle>
              <p className="mt-2 max-w-2xl text-sm font-medium text-zinc-600">
                Only ongoing Bridge logs with the enabled tags appear in Watchtower. Everything else stays in the usual screens like Fleet and Logbook.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                ref={triggerRef}
                type="button"
                onClick={() => {
                  setIsFilterOpen(prev => !prev);
                  setShowNewTagForm(false);
                }}
                className={cn(
                  'neo-btn px-4 flex items-center gap-2',
                  visibleTagIds.length > 0
                    ? 'bg-[var(--color-neo-yellow)] text-black'
                    : 'bg-[var(--color-neo-surface)] text-black'
                )}
                aria-haspopup="true"
                aria-expanded={isFilterOpen}
              >
                Filter Tags
                <ChevronDown
                  className={cn('h-4 w-4 stroke-[3] transition-transform', isFilterOpen && 'rotate-180')}
                />
              </Button>

              {isFilterOpen && triggerRect && createPortal(
                (
                  <div
                    ref={popoverRef}
                    style={{
                      position: 'fixed',
                      top: triggerRect.bottom + 8,
                      // Anchor to the trigger's right edge so the panel grows
                      // leftward, mirroring the previous align="end" behavior.
                      right: Math.max(8, window.innerWidth - triggerRect.right),
                      width: 'min(20rem, calc(100vw - 1rem))',
                      maxHeight: 'calc(100vh - 6rem)',
                    }}
                    className="neo-box z-50 overflow-y-auto bg-[var(--color-neo-surface)] p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                    role="dialog"
                    aria-label="Watchtower tag filters"
                  >
                    <p className="px-1 pb-2 text-xs font-black uppercase tracking-widest text-black">
                      Watchtower Tags
                    </p>

                    <div className="flex gap-2 px-1 pb-2">
                      <button
                        type="button"
                        onClick={handleSelectAllTags}
                        className="flex-1 rounded-md border-2 border-black bg-white px-2 py-1 text-xs font-black uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[var(--color-neo-yellow)]"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={() => persistVisibleTagIds([])}
                        className="flex-1 rounded-md border-2 border-black bg-white px-2 py-1 text-xs font-black uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-zinc-200"
                      >
                        Clear All
                      </button>
                    </div>

                    <div className="my-2 border-t-2 border-black/20" />

                    <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
                      {tags.length === 0 ? (
                        <p className="px-2 py-3 text-center text-xs font-bold text-zinc-500">
                          No tags yet. Create one below.
                        </p>
                      ) : (
                        tags.map((tag) => {
                          const checked = visibleTagIds.includes(tag.id);
                          return (
                            <div
                              key={tag.id}
                              className={cn(
                                'group/tag-row flex w-full items-center gap-1 rounded-md border-2 border-transparent pr-1 transition-colors',
                                checked
                                  ? 'bg-white border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                  : 'hover:bg-white/60'
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => handleToggleTag(tag.id)}
                                className="flex flex-1 min-w-0 items-center justify-between gap-2 px-2 py-1.5 text-left text-sm font-bold"
                              >
                                <span className="flex items-center gap-2 truncate">
                                  <span className={cn('h-3 w-3 shrink-0 rounded-full border border-black', tag.color)} />
                                  <span className="truncate">{tag.name}</span>
                                </span>
                                <span
                                  className={cn(
                                    'flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 border-black',
                                    checked ? 'bg-[var(--color-neo-green)]' : 'bg-white'
                                  )}
                                  aria-hidden
                                >
                                  {checked && <Check className="h-3 w-3 stroke-[3] text-black" />}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteTag(tag)}
                                className="shrink-0 rounded-md p-1 text-zinc-500 opacity-60 hover:bg-red-500 hover:text-white hover:opacity-100 group-hover/tag-row:opacity-100 focus-visible:opacity-100"
                                title={`Delete tag "${tag.name}"`}
                                aria-label={`Delete tag ${tag.name}`}
                              >
                                <Trash2 className="h-3.5 w-3.5 stroke-[3]" />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>

                    <div className="my-2 border-t-2 border-black/20" />

                    {showNewTagForm ? (
                      <div className="space-y-2 p-1">
                        <Input
                          value={newTagName}
                          onChange={(event) => setNewTagName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              handleCreateTag();
                            }
                          }}
                          placeholder="New tag name"
                          autoFocus
                          maxLength={40}
                          className="neo-input h-9 bg-white"
                        />
                        <div>
                          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-zinc-600">Color</p>
                          <div className="flex flex-wrap gap-1.5">
                            {TAG_COLOR_PALETTE.map((color) => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => setNewTagColor(color)}
                                className={cn(
                                  'h-6 w-6 rounded-md border-2 border-black transition-transform',
                                  color,
                                  newTagColor === color
                                    ? 'scale-110 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                                    : 'hover:scale-105'
                                )}
                                aria-label={`Pick color ${color.replace('bg-', '').replace('-500', '')}`}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button
                            type="button"
                            onClick={handleCreateTag}
                            disabled={isCreatingTag || !newTagName.trim()}
                            className="neo-btn flex-1 bg-[var(--color-neo-green)] text-black h-9"
                          >
                            {isCreatingTag ? 'Creating...' : 'Create Tag'}
                          </Button>
                          <Button
                            type="button"
                            onClick={() => {
                              setShowNewTagForm(false);
                              setNewTagName('');
                            }}
                            className="neo-btn bg-zinc-200 text-black h-9 px-3"
                          >
                            <X className="h-4 w-4 stroke-[3]" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowNewTagForm(true)}
                        className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-dashed border-black bg-white px-2 py-2 text-xs font-black uppercase tracking-widest text-black hover:bg-[var(--color-neo-cyan)]"
                      >
                        <Plus className="h-4 w-4 stroke-[3]" />
                        New Tag
                      </button>
                    )}
                  </div>
                ),
                document.body
              )}

              <span className="rounded-lg border-2 border-black bg-[var(--color-neo-surface)] px-3 py-2 text-xs font-bold uppercase text-zinc-600 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                {filteredLogs.length} active item{filteredLogs.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <div className="space-y-2">
            <p className="text-xs font-black uppercase text-zinc-600">
              {visibleTagIds.length === 0
                ? 'No tags selected'
                : `Showing items with any of ${visibleTagIds.length} selected tag${visibleTagIds.length === 1 ? '' : 's'}`}
            </p>
            <div className="flex flex-wrap gap-2">
              {visibleTagIds.length === 0 ? (
                <span className="rounded-md border-2 border-dashed border-black bg-[var(--color-neo-surface)] px-3 py-2 text-sm font-bold text-zinc-600">
                  Open Filter Tags to choose what appears here.
                </span>
              ) : (
                tags
                  .filter((tag) => visibleTagIds.includes(tag.id))
                  .map((tag) => (
                    <span
                      key={tag.id}
                      className={cn(
                        'rounded-lg border-2 border-black px-3 py-2 text-xs font-black uppercase text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]',
                        tag.color,
                      )}
                    >
                      {tag.name}
                    </span>
                  ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {filteredLogs.length === 0 ? (
        <div className="neo-box bg-[var(--color-neo-surface)] py-20 text-center">
          <CheckCircle2 className="mx-auto mb-4 h-16 w-16 text-[var(--color-neo-green)] stroke-[3]" />
          <p className="text-xl font-black uppercase text-black">{emptyState.title}</p>
          <p className="mx-auto mt-3 max-w-xl text-sm font-medium text-zinc-600">{emptyState.description}</p>
          {!isShowingAllTags && ongoingLogs.length > 0 && (
            <Button onClick={handleSelectAllTags} className="neo-btn mt-6 bg-[var(--color-neo-yellow)] text-black">
              Show All Tags
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {filteredLogs.map(log => (
            <Card key={log.id} className="neo-box flex h-full flex-col overflow-hidden border-3 bg-[var(--color-neo-surface)] p-0">
              <CardHeader className="border-b-3 border-black bg-[var(--color-neo-surface)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <CardTitle className="text-2xl font-black uppercase text-black">
                      <Link to={`/logbook/${log.dspId}`} className="hover:underline">
                        {log.dspName}
                      </Link>
                    </CardTitle>
                    <div className="mt-2 flex items-center text-sm font-medium text-zinc-600">
                      <Clock className="mr-2 h-4 w-4 stroke-[2.5]" />
                      Started {formatDistanceToNow(log.createdAt, { addSuffix: true })}
                    </div>
                  </div>
                  <span className="rounded-md border-2 border-black bg-orange-200 px-3 py-1 text-xs font-bold uppercase text-orange-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    Ongoing
                  </span>
                </div>
              </CardHeader>

              <CardContent className="flex-1 space-y-4 p-5">
                <p className="whitespace-pre-wrap text-base font-medium leading-7 text-black">
                  {log.content}
                </p>
                <div className="flex flex-wrap gap-2">
                  {log.tags.map(tagId => {
                    const tag = tags.find(item => item.id === tagId);
                    if (!tag) return null;
                    return (
                      <span
                        key={tag.id}
                        className={cn(
                          'rounded-md border-2 border-black px-2 py-1 text-xs font-bold uppercase text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]',
                          tag.color,
                        )}
                      >
                        {tag.name}
                      </span>
                    );
                  })}
                </div>
              </CardContent>

              {resolvingId === log.id && (
                <div className="space-y-4 border-t-3 border-black bg-[var(--color-neo-surface-muted)] p-5">
                  <h4 className="font-black uppercase text-black">Resolution Details</h4>
                  <Textarea 
                    placeholder="Add notes about how this was resolved..."
                    className="neo-input min-h-[120px] bg-[var(--color-neo-surface)]"
                    value={resolutionNote}
                    onChange={(event) => setResolutionNote(event.target.value)}
                  />
                  
                  <div className="flex flex-wrap items-center gap-3">
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      onChange={handleFileChange}
                      accept="image/*,.pdf,.doc,.docx"
                    />
                    <Button 
                      variant="outline" 
                      onClick={() => fileInputRef.current?.click()}
                      className="neo-btn bg-[var(--color-neo-surface)]"
                    >
                      <Upload className="mr-2 h-4 w-4 stroke-[3]" />
                      Attach File
                    </Button>
                    
                    {resolutionFile && (
                      <div className="flex items-center gap-2 rounded-md border-2 border-black bg-[var(--color-neo-yellow)] px-3 py-2 text-sm font-bold text-black">
                        <span className="max-w-[180px] truncate">{resolutionFile.name}</span>
                        <button type="button" onClick={() => setResolutionFile(null)} className="hover:text-red-600">
                          <X className="h-4 w-4 stroke-[3]" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <CardFooter className="border-t-3 border-black bg-[var(--color-neo-surface)] p-5">
                <div className="flex w-full flex-col-reverse gap-3 sm:flex-row">
                  {resolvingId === log.id && (
                    <Button 
                      className="neo-btn flex-1 bg-[var(--color-neo-surface-muted)] text-black" 
                      onClick={() => setResolvingId(null)}
                    >
                      Cancel
                    </Button>
                  )}
                  <Button 
                    className="neo-btn flex-1 bg-[var(--color-neo-green)] text-black" 
                    onClick={() => handleResolve(log.id)}
                  >
                    <CheckCircle2 className="mr-2 h-5 w-5 stroke-[3]" /> 
                    {resolvingId === log.id ? 'Confirm Resolution' : 'Mark Resolved'}
                  </Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
