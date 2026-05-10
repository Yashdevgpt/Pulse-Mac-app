import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db, DSP } from '@/lib/db';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDistanceToNow } from 'date-fns';
import { Search, Activity, Clock, Edit2, Save, Star, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { createDspSlug } from '@/lib/slugs';
import { deleteBrainMemorySource } from '@/lib/brainApi';

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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-4xl font-black text-black tracking-tight uppercase">Fleet</h1>
          <p className="text-zinc-600 mt-2 font-medium">Directory of all your DSP integrations and partners.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-black stroke-[3]" />
          <Input 
            placeholder="Search DSPs..." 
            className="neo-input pl-10 h-12 text-lg bg-white"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {filteredDsps.length === 0 ? (
        <div className="text-center py-20 neo-box bg-white">
          <p className="text-black font-bold text-lg">No DSPs found. Create one from the Bridge.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDsps.map(dsp => {
            const stats = getDspStats(dsp.id);
            const isEditing = editingDspId === dsp.id;
            return (
              <Card key={dsp.id} className="neo-box h-full hover:-translate-y-1 hover:-translate-x-1 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all bg-white flex flex-col overflow-hidden p-0">
                <CardHeader className="p-4 border-b-3 border-black bg-white">
                  <CardTitle className="text-xl font-black text-black flex justify-between items-center uppercase gap-3">
                    {isEditing ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="neo-input h-10 text-base bg-white"
                        autoFocus
                      />
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleToggleStar(dsp)}
                          className={`shrink-0 rounded-md border-2 border-black p-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-colors ${
                            dsp.starred
                              ? 'bg-[var(--color-neo-yellow)] text-black'
                              : 'bg-white text-black hover:bg-zinc-100'
                          }`}
                          title={dsp.starred ? 'Unpin from top' : 'Pin to top'}
                          aria-label={dsp.starred ? 'Unpin DSP' : 'Pin DSP to top'}
                        >
                          <Star
                            className={`w-4 h-4 stroke-[3] ${dsp.starred ? 'fill-black' : ''}`}
                          />
                        </button>
                        <span className="truncate">{dsp.name}</span>
                      </div>
                    )}
                    {stats.ongoingTasks > 0 && !isEditing && (
                      <span className="flex items-center text-xs font-bold bg-[var(--color-neo-yellow)] text-black px-2 py-1 border-2 border-black rounded-md shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] shrink-0">
                        <Activity className="w-3 h-3 mr-1 stroke-[3]" />
                        {stats.ongoingTasks} Active
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 bg-white flex-1">
                  <div className="flex flex-col gap-3 text-sm text-black font-medium">
                    <div className="flex items-center">
                      <Clock className="w-5 h-5 mr-2 stroke-[2.5]" />
                      Updated {formatDistanceToNow(dsp.updatedAt, { addSuffix: true })}
                    </div>
                    <div className="flex items-center">
                      <BookOpenIcon className="w-5 h-5 mr-2 stroke-[2.5]" />
                      {stats.totalLogs} total updates
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="p-4 pt-0 bg-white flex gap-2 justify-end">
                  {isEditing ? (
                    <>
                      <Button onClick={() => handleSaveName(dsp)} className="neo-btn bg-[var(--color-neo-green)] text-black px-3">
                        <Save className="w-4 h-4 stroke-[3]" />
                      </Button>
                      <Button onClick={() => setEditingDspId(null)} className="neo-btn bg-zinc-200 text-black px-3">
                        <X className="w-4 h-4 stroke-[3]" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Link to={`/logbook/${createDspSlug(dsp.name)}`}>
                        <Button className="neo-btn bg-[var(--color-neo-cyan)] text-black">
                          Open
                        </Button>
                      </Link>
                      <Button onClick={() => handleEditClick(dsp)} className="neo-btn bg-[var(--color-neo-yellow)] text-black px-3" title="Edit DSP name">
                        <Edit2 className="w-4 h-4 stroke-[3]" />
                      </Button>
                      <Button onClick={() => handleDeleteDsp(dsp)} className="neo-btn bg-red-500 text-white px-3" title="Delete DSP">
                        <Trash2 className="w-4 h-4 stroke-[3]" />
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

function BookOpenIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}
