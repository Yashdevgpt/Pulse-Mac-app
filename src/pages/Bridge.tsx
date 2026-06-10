import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { db, DSP, Tag, Log } from '@/lib/db';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Check, ChevronsUpDown, LayoutDashboard, Plus, Search } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { cn } from '@/lib/utils';
import { createDspSlug } from '@/lib/slugs';
import { autoIndexDspRecord, autoIndexFleetLog } from '@/lib/brainApi';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

// ─── Bridge greeting pool ──────────────────────────────────────────────
// 100+ rotating greetings. Static lines cover energetic / thoughtful / dry
// moods. DSP-aware lines are generated on the fly from the user's currently
// starred DSPs, so unstarring a DSP cleanly removes those greetings from the
// pool on the next visit.
const pickBridgeGreeting = (dsps: DSP[]): string => {
  const firstName = auth.currentUser?.displayName?.split(' ')[0] || 'Yash';
  const starred = dsps.filter((dsp) => dsp.starred);

  const staticGreetings = [
    `Yo ${firstName}, ready to crush it?`,
    `Welcome back to the command center, ${firstName}!`,
    `Looking sharp today, ${firstName}. What's the move?`,
    `System online. You're at the helm, ${firstName}.`,
    `Let's make some magic happen, ${firstName} 🚀`,
    `Good to see you, ${firstName}. Let's get to work.`,
    `All systems go, ${firstName}. Mission control standing by.`,
    `Bridge is yours, Captain ${firstName}. Set a course.`,
    `Pulse is awake. Let's get after it, ${firstName}.`,
    `${firstName} on deck. The fleet is listening.`,
    `Coffee in hand, ${firstName}? Time to ship.`,
    `Locked, loaded, and logged in, ${firstName}.`,
    `Steady hands on the wheel, ${firstName}. Let's roll.`,
    `Reporting for duty, ${firstName}. What's first?`,
    `Boot sequence complete. Welcome back, ${firstName}.`,
    `Today's the day, ${firstName}. Let's make it count.`,
    `Pulse pulse pulse. You're live, ${firstName}.`,
    `Eyes up, ${firstName}. The Watchtower is watching.`,
    `Engines warm, ${firstName}. Ready when you are.`,
    `${firstName}, you've got 24 hours. Make 'em yours.`,
    `Welcome aboard, ${firstName}. Smooth sailing today.`,
    `Hey ${firstName} — caught any wins yet?`,
    `Inbox cleared, ${firstName}? Just kidding. Let's go.`,
    `${firstName}, the dashboard called. It missed you.`,
    `Stack the wins, ${firstName}. Today's a good day.`,
    `Big plans, ${firstName}? We've got a Bridge for that.`,
    `Pulse rate: optimal. Welcome back, ${firstName}.`,
    `${firstName}, your command center is operational.`,
    `Calm seas and clear skies, ${firstName}. Let's sail.`,
    `${firstName}, the fleet awaits your orders.`,
    `Quietly excellent. Welcome, ${firstName}.`,
    `Decks scrubbed, logs ready. Step in, ${firstName}.`,
    `${firstName}, today belongs to you. Claim it.`,
    `Hello, operator ${firstName}. Channel is open.`,
    `${firstName}, you again? The Brain remembers everything.`,
    `Plot twist, ${firstName}: today goes well.`,
    `${firstName}, focus mode engaged. Distractions denied.`,
    `Status: ${firstName} is in the building.`,
    `Permission granted, ${firstName}. Run the day.`,
    `${firstName}, the Bridge is buttery smooth today.`,
    `Pulse ✦ Live ✦ ${firstName}. Let's create.`,
    `${firstName}, less talk, more shipping. Let's go.`,
    `Open the throttle, ${firstName}. Pulse can keep up.`,
    `${firstName}, your story today writes itself.`,
    `Glad you're here, ${firstName}. We've got plans.`,
    `${firstName}, signal strong. Connection locked in.`,
    `Briefing complete. Over to you, ${firstName}.`,
    `${firstName}, the Logbook is ready when you are.`,
    `Be the calm in the chaos, ${firstName}.`,
    `${firstName}, you make this look easy. Carry on.`,
    `One step at a time, ${firstName}. Today counts.`,
    `${firstName}, no syntax errors detected. Proceed.`,
    `Pulse + ${firstName} = unfair advantage.`,
    `${firstName}, your future self is rooting for you.`,
    `Ready, set, ship, ${firstName}.`,
    `${firstName}, the heartbeat is steady. So are you.`,
    `Quiet morning, ${firstName}? Make some noise.`,
    `${firstName}, deep work mode is now in session.`,
    `Sip your coffee, ${firstName}. Then ship something.`,
    `${firstName}, the fleet is shipshape. Take the helm.`,
    `Reset complete, ${firstName}. New day, new wins.`,
    `${firstName}, the green checkmarks await.`,
    `Tide's coming in, ${firstName}. Ride it.`,
    `${firstName}, today's first move is the most important.`,
    `Mission acknowledged, ${firstName}. Stand by.`,
    `${firstName}, momentum loves the morning. Use it.`,
    `Crisp logs, ${firstName}. Crisp decisions.`,
    `${firstName}, the command center hums when you arrive.`,
    `Onward and upward, ${firstName}.`,
    `${firstName}, focus is a superpower. Wield it.`,
    `Heads up, ${firstName} — you've got this.`,
    `${firstName}, the Brain is rested and ready.`,
    `Throttle full, ${firstName}. Watchtower clear.`,
    `${firstName}, the Bridge logs miss your handwriting.`,
    `Pulse syncing, ${firstName}. Stay sharp.`,
    `${firstName}, you walked in like you owned the place. Good.`,
    `Cabin stabilized, ${firstName}. Cruise altitude reached.`,
    `${firstName}, every great day starts here.`,
    `Tea? Coffee? Strategy, ${firstName}?`,
    `${firstName}, ten minutes of focus changes everything.`,
    `Lights green across the board, ${firstName}.`,
    `${firstName}, the smallest log can move the biggest DSP.`,
    `Brain memory primed. Question away, ${firstName}.`,
    `${firstName}, no excuses today. Just outputs.`,
    `Day one of the rest of your week, ${firstName}.`,
    `${firstName}, the Bridge respects you because you respect the Bridge.`,
    `Cleared for takeoff, ${firstName}. Cleared for everything.`,
    `${firstName}, this is your sign — start with the first task.`,
    `Pulse standing by, ${firstName}. We're with you.`,
    `${firstName}, channel your inner monk-soldier today.`,
    `One log at a time, ${firstName}. They add up.`,
    `${firstName}, you've come too far to coast now.`,
    `Operations green. ${firstName}, you're cleared in.`,
    `${firstName}, slow is smooth. Smooth is fast.`,
    `Refresh complete, ${firstName}. Same operator, sharper edge.`,
    `${firstName}, a calm mind ships better logs.`,
    `Quietly relentless. That's you, ${firstName}.`,
    `${firstName}, the day is young. The Bridge is yours.`,
    `Two minutes of planning, ${firstName}. Then a clean run.`,
    `${firstName}, your DSPs called — they need their hero.`,
    `Cleared the runway, ${firstName}. Now build.`,
    `${firstName}, signal locked. Heart rate steady. Ship.`,
  ];

  // DSP-aware lines: only emitted for currently-starred DSPs. If you unstar
  // a DSP, these phrases simply leave the pool — no stale references.
  const buildStarredGreetings = (dsp: DSP) => [
    `${firstName}, ${dsp.name} is starred. Time to give it some love.`,
    `Pinned to the top: ${dsp.name}. Let's move the needle today, ${firstName}.`,
    `${dsp.name} is your priority partner today, ${firstName}. Eyes there first.`,
    `${firstName}, you starred ${dsp.name} for a reason. Make it count.`,
    `Top of the fleet: ${dsp.name}. ${firstName}, what's the next play?`,
    `${firstName}, ${dsp.name} earned that star. Keep the streak going.`,
    `Captain ${firstName}, ${dsp.name} is awaiting orders.`,
    `${firstName}, momentum on ${dsp.name} compounds. Don't stall it.`,
  ];

  const dspGreetings = starred.flatMap(buildStarredGreetings);
  const pool = [...staticGreetings, ...dspGreetings];
  return pool[Math.floor(Math.random() * pool.length)];
};

export default function Bridge() {
  const navigate = useNavigate();
  const [greeting, setGreeting] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  
  const [content, setContent] = useState('');
  const [dsps, setDsps] = useState<DSP[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  
  const [selectedDspId, setSelectedDspId] = useState<string>('');
  const [newDspName, setNewDspName] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [status, setStatus] = useState<'Ongoing' | 'Completed' | 'None'>('None');
  const [isDspOpen, setIsDspOpen] = useState(false);
  const [dspQuery, setDspQuery] = useState('');

  const filteredDsps = useMemo(() => {
    const query = dspQuery.trim().toLowerCase();
    if (!query) return dsps;
    return dsps.filter(dsp => dsp.name.toLowerCase().includes(query));
  }, [dsps, dspQuery]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    loadData();
    return () => clearInterval(timer);
  }, []);

  const loadData = async () => {
    const loadedDsps = await db.getDSPs();
    const loadedTags = await db.getTags();
    setDsps(loadedDsps);
    setTags(loadedTags);

    // Pick the greeting AFTER DSPs load so the pool can include phrases that
    // call out the user's currently-starred DSPs by name. This is intentional:
    // unstar a DSP and the next time you land here, you won't see a greeting
    // that mentions it.
    setGreeting(pickBridgeGreeting(loadedDsps));
  };

  const handleCreateDsp = async () => {
    if (!newDspName.trim()) return;
    const dspId = createDspSlug(newDspName);
    if (!dspId) {
      toast.error('DSP name must include at least one letter.');
      return;
    }
    if (dsps.some(dsp => createDspSlug(dsp.name) === dspId)) {
      toast.error('A DSP with this permalink already exists. Use a different name.');
      return;
    }

    const newDsp: DSP = {
      id: dspId,
      name: newDspName.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.saveDSP(newDsp);
    autoIndexDspRecord(newDsp);
    setDsps([newDsp, ...dsps]);
    setSelectedDspId(newDsp.id);
    setNewDspName('');
    setIsDspOpen(false);
    toast.success(`Created new DSP: ${newDsp.name}`);
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds(prev => 
      prev.includes(tagId) 
        ? prev.filter(id => id !== tagId)
        : [...prev, tagId]
    );
  };

  const handleSubmit = async () => {
    if (!content.trim()) {
      toast.error('Please enter an update description.');
      return;
    }
    if (!selectedDspId) {
      toast.error('Please select or create a DSP.');
      return;
    }

    const newLog: Log = {
      id: `log_${Date.now()}`,
      dspId: selectedDspId,
      content: content.trim(),
      tags: selectedTagIds,
      status,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.saveLog(newLog);
    autoIndexFleetLog(newLog);
    toast.success('Update logged successfully.');
    
    // Reset form
    setContent('');
    setSelectedTagIds([]);
    setStatus('None');
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        icon={LayoutDashboard}
        title={greeting}
        subtitle={<>It's {format(currentTime, 'EEEE, MMMM do')} at {format(currentTime, 'h:mm a')}. What's the update?</>}
      />

      <div className="glass-panel p-6 space-y-6">
        <div>
          <Textarea
            placeholder="Log your latest activity, meeting notes, or monitoring updates..."
            className="min-h-[150px] text-base resize-none"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-6">
          <div className="flex-1 space-y-3">
            <label className="lux-label">Select DSP</label>
            <Popover
              open={isDspOpen}
              onOpenChange={(open) => {
                setIsDspOpen(open);
                if (!open) setDspQuery('');
              }}
            >
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isDspOpen}
                    className="glass-btn h-10 w-full justify-between px-4 font-normal"
                  />
                }
              >
                {selectedDspId
                  ? dsps.find((dsp) => dsp.id === selectedDspId)?.name
                  : "Select DSP..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </PopoverTrigger>
              <PopoverContent className="w-[300px] p-0">
                <div className="p-2 border-b border-[var(--lux-border)]">
                  <div className="flex gap-2">
                    <Input
                      placeholder="New DSP name..."
                      value={newDspName}
                      onChange={(e) => setNewDspName(e.target.value)}
                      className="h-8 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCreateDsp();
                        }
                      }}
                    />
                    <Button size="sm" className="glass-btn glass-btn-gold" onClick={handleCreateDsp} disabled={!newDspName.trim()}>
                      <Plus className="h-4 w-4 stroke-[1.75]" />
                    </Button>
                  </div>
                </div>
                <div className="border-b border-[var(--lux-border)] p-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 stroke-[1.75] text-[var(--lux-soft)]" />
                    <Input
                      placeholder="Search DSPs..."
                      value={dspQuery}
                      onChange={(e) => setDspQuery(e.target.value)}
                      className="h-8 pl-8 text-sm"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-[200px] overflow-y-auto p-1">
                  {filteredDsps.length === 0 && (
                    <p className="p-2 text-sm text-[var(--lux-muted)] text-center">
                      {dsps.length === 0 ? 'No DSPs found.' : 'No DSPs match your search.'}
                    </p>
                  )}
                  {filteredDsps.map((dsp) => (
                    <div
                      key={dsp.id}
                      className={cn(
                        "relative flex cursor-pointer select-none items-center rounded-lg border px-2 py-1.5 text-sm font-medium outline-none transition-colors hover:bg-[var(--lux-fill)]",
                        selectedDspId === dsp.id
                          ? "border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)] text-[var(--lux-gold)]"
                          : "border-transparent text-[var(--lux-text)]"
                      )}
                      onClick={() => {
                        setSelectedDspId(dsp.id);
                        setIsDspOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4 stroke-[1.75]",
                          selectedDspId === dsp.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                      {dsp.name}
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="flex-1 space-y-3">
            <label className="lux-label">Task Status</label>
            <div className="flex gap-2">
              {(['None', 'Ongoing', 'Completed'] as const).map((s) => (
                <Button
                  key={s}
                  variant={status === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "glass-btn",
                    status === s && s === 'Ongoing' ? 'bg-[var(--lux-amber-fill)] border-[var(--lux-amber-border)] text-[var(--lux-amber)]' :
                    status === s && s === 'Completed' ? 'bg-[var(--lux-emerald-fill)] border-[var(--lux-emerald-border)] text-[var(--lux-emerald)]' :
                    status === s ? 'bg-[var(--lux-fill-strong)] border-[var(--lux-border-strong)]' : ''
                  )}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="lux-label">Tags</label>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isSelected = selectedTagIds.includes(tag.id);
              return (
                <Badge
                  key={tag.id}
                  className={cn(
                    "cursor-pointer px-3 py-1 transition-all hover:-translate-y-[1px]",
                    isSelected && "border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]"
                  )}
                  onClick={() => toggleTag(tag.id)}
                >
                  <span className={cn('h-2 w-2 rounded-full', tag.color)} aria-hidden />
                  {tag.name}
                </Badge>
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t border-[var(--lux-border)] flex justify-end">
          <Button onClick={handleSubmit} size="lg" className="glass-btn glass-btn-gold w-full sm:w-auto text-base px-8">
            Log Update
          </Button>
        </div>
      </div>
    </div>
  );
}
