import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db, DSP } from '@/lib/db';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDistanceToNow } from 'date-fns';
import { Search, Activity, BookOpen, Clock, Edit2, Save, Star, Trash2, X } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { toast } from 'sonner';
import { createDspSlug } from '@/lib/slugs';
import { autoIndexDspRecord, deleteBrainMemorySource } from '@/lib/brainApi';

export default function Fleet() {
  const [dsps, setDsps] = useState<DSP[]>([]);
  const [logCountsByDsp, setLogCountsByDsp] = useState<Record<string, number>>({});
  const [ongoingCountsByDsp, setOngoingCountsByDsp] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [editingDspId, setEditingDspId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [loadedDsps, ongoingLogs] = await Promise.all([
      db.getDSPs(),
      db.getLogsByStatus('Ongoing'),
    ]);
    const loadedLogCounts = await db.getLogCountsByDSPs(loadedDsps.map(dsp => dsp.id));
    const loadedOngoingCounts = ongoingLogs.reduce<Record<string, number>>((counts, log) => {
      counts[log.dspId] = (counts[log.dspId] || 0) + 1;
      return counts;
    }, {});

    setDsps(loadedDsps);
    setLogCountsByDsp(loadedLogCounts);
    setOngoingCountsByDsp(loadedOngoingCounts);
  };

  // Starred DSPs always appear first. Within each group (starred / not),
  // we keep the existing newest-first ordering by updatedAt.
  const filteredDsps = dsps
    .filter(dsp => dsp.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .slice()
    .sort((left, right) => {
      const leftStar = left.starred ? 1 : 0;
      const rightStar = right.starred ? 1 : 0;
      if (leftStar !== rightStar) return rightStar - leftStar;
      return right.updatedAt - left.updatedAt;
    });

  const handleToggleStar = async (dsp: DSP) => {
    const updatedDsp: DSP = {
      ...dsp,
      starred: !dsp.starred,
      updatedAt: Date.now(),
    };
    // Optimistic UI — flip locally first so the card visibly re-orders right
    // away. Roll back if the Firestore write fails.
    setDsps(prev => prev.map(item => item.id === dsp.id ? updatedDsp : item));
    try {
      await db.saveDSP(updatedDsp);
      autoIndexDspRecord(updatedDsp);
      toast.success(updatedDsp.starred ? `Pinned ${dsp.name} to the top` : `Unpinned ${dsp.name}`);
    } catch (error) {
      console.error('Could not update DSP star:', error);
      setDsps(prev => prev.map(item => item.id === dsp.id ? dsp : item));
      toast.error('Could not update star.');
    }
  };

  const getDspStats = (dspId: string) => {
    return {
      totalLogs: logCountsByDsp[dspId] || 0,
      ongoingTasks: ongoingCountsByDsp[dspId] || 0
    };
  };

  const handleEditClick = (dsp: DSP) => {
    setEditingDspId(dsp.id);
    setEditName(dsp.name);
  };

  const handleSaveName = async (dsp: DSP) => {
    const nextName = editName.trim();
    const nextSlug = createDspSlug(nextName);

    if (!nextName || !nextSlug) {
      toast.error('DSP name must include at least one letter.');
      return;
    }

    if (dsps.some(item => item.id !== dsp.id && createDspSlug(item.name) === nextSlug)) {
      toast.error('A DSP with this permalink already exists. Use a different name.');
      return;
    }

    const updatedDsp = {
      ...dsp,
      name: nextName,
      updatedAt: Date.now()
    };

    await db.saveDSP(updatedDsp);
    autoIndexDspRecord(updatedDsp);
    setDsps(prev => prev.map(item => item.id === dsp.id ? updatedDsp : item));
    setEditingDspId(null);
    setEditName('');
    toast.success('DSP name updated');
  };

  const handleDeleteDsp = async (dsp: DSP) => {
    if (!window.confirm(`Delete ${dsp.name}? This will also delete its logs.`)) {
      return;
    }

    // Snapshot the logs that will cascade out so we can wipe their Brain
    // memory entries. Runs before db.deleteDSP() so getLogsByDSP still finds
    // them. Failures are non-fatal — Reset Memory on the Brain page is the
    // safety net.
    const dspLogs = await db.getLogsByDSP(dsp.id);
    const brainCleanups = [
      deleteBrainMemorySource('dsp_record', dsp.id),
      ...dspLogs.map(log => deleteBrainMemorySource('fleet_log', log.id)),
    ];
    await Promise.allSettled(brainCleanups).then(results => {
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        console.warn(`Brain memory cleanup partial-failed for ${failed} item(s) under DSP ${dsp.name}.`);
      }
    });

    await db.deleteDSP(dsp.id);
    setDsps(prev => prev.filter(item => item.id !== dsp.id));
    setLogCountsByDsp(prev => {
      const { [dsp.id]: _removed, ...rest } = prev;
      return rest;
    });
    setOngoingCountsByDsp(prev => {
      const { [dsp.id]: _removed, ...rest } = prev;
      return rest;
    });
    toast.success('DSP deleted');
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={BookOpen}
        title="Fleet"
        subtitle="Directory of all your DSP integrations and partners."
        compact
        actions={
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--lux-soft)] stroke-[1.75]" />
            <Input
              placeholder="Search DSPs..."
              className="pl-10 h-12 text-lg"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        }
      />

      {filteredDsps.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No DSPs found"
          description="Create one from the Bridge."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDsps.map(dsp => {
            const stats = getDspStats(dsp.id);
            const isEditing = editingDspId === dsp.id;
            return (
              <Card key={dsp.id} className="h-full transition-all hover:-translate-y-1 hover:border-[var(--lux-gold-border)] hover:shadow-[var(--lux-shadow)] flex flex-col overflow-hidden p-0">
                <CardHeader className="p-4 border-b border-[var(--lux-border)]">
                  <CardTitle className="font-display text-xl font-semibold text-[var(--lux-text)] flex justify-between items-center gap-3">
                    {isEditing ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-10 text-base"
                        autoFocus
                      />
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleStar(dsp)}
                          className={`shrink-0 rounded-full border p-1.5 transition-colors ${
                            dsp.starred
                              ? 'border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)] text-[var(--lux-gold)]'
                              : 'border-[var(--lux-border)] text-[var(--lux-soft)] hover:bg-[var(--lux-fill)] hover:text-[var(--lux-text)]'
                          }`}
                          title={dsp.starred ? 'Unpin from top' : 'Pin to top'}
                          aria-label={dsp.starred ? 'Unpin DSP' : 'Pin DSP to top'}
                        >
                          <Star
                            className={`w-4 h-4 stroke-[1.75] ${dsp.starred ? 'fill-current' : ''}`}
                          />
                        </button>
                        <span className="truncate">{dsp.name}</span>
                      </div>
                    )}
                    {stats.ongoingTasks > 0 && !isEditing && (
                      <span className="flex shrink-0 items-center rounded-full border border-[var(--lux-amber-border)] bg-[var(--lux-amber-fill)] px-2.5 py-1 text-xs font-medium text-[var(--lux-amber)]">
                        <Activity className="w-3 h-3 mr-1.5 stroke-[1.75]" />
                        {stats.ongoingTasks} Active
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 flex-1">
                  <div className="flex flex-col gap-3 text-sm text-[var(--lux-muted)]">
                    <div className="flex items-center">
                      <Clock className="w-4 h-4 mr-2.5 stroke-[1.75] text-[var(--lux-soft)]" />
                      Updated {formatDistanceToNow(dsp.updatedAt, { addSuffix: true })}
                    </div>
                    <div className="flex items-center">
                      <BookOpen className="w-4 h-4 mr-2.5 stroke-[1.75] text-[var(--lux-soft)]" />
                      {stats.totalLogs} total updates
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="p-4 pt-0 flex gap-2 justify-end">
                  {isEditing ? (
                    <>
                      <Button onClick={() => handleSaveName(dsp)} className="glass-btn glass-btn-emerald px-3">
                        <Save className="w-4 h-4 stroke-[1.75]" />
                      </Button>
                      <Button onClick={() => setEditingDspId(null)} className="glass-btn px-3">
                        <X className="w-4 h-4 stroke-[1.75]" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Link to={`/logbook/${createDspSlug(dsp.name)}`}>
                        <Button className="glass-btn glass-btn-gold">
                          Open
                        </Button>
                      </Link>
                      <Button onClick={() => handleEditClick(dsp)} className="glass-btn px-3" title="Edit DSP name">
                        <Edit2 className="w-4 h-4 stroke-[1.75]" />
                      </Button>
                      <Button onClick={() => handleDeleteDsp(dsp)} className="glass-btn glass-btn-ruby px-3" title="Delete DSP">
                        <Trash2 className="w-4 h-4 stroke-[1.75]" />
                      </Button>
                    </>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
