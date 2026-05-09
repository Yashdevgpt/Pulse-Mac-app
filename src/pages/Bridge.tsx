import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { db, DSP, Tag, Log } from '@/lib/db';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createDspSlug } from '@/lib/slugs';
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
    toast.success('Update logged successfully.');
    
    // Reset form
    setContent('');
    setSelectedTagIds([]);
    setStatus('None');
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-4xl font-black text-black tracking-tight uppercase">
          {greeting}
        </h1>
        <p className="text-zinc-600 mt-2 font-medium">
          It's {format(currentTime, 'EEEE, MMMM do')} at {format(currentTime, 'h:mm a')}. What's the update?
        </p>
      </div>

      <div className="neo-box p-6 space-y-6 bg-[var(--color-neo-bg)]">
        <div>
          <Textarea
            placeholder="Log your latest activity, meeting notes, or monitoring updates..."
            className="neo-input min-h-[150px] text-base resize-none bg-white"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-6">
          <div className="flex-1 space-y-3">
            <label className="text-sm font-bold text-black uppercase tracking-wider">Select DSP</label>
            <Popover open={isDspOpen} onOpenChange={setIsDspOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={isDspOpen}
                    className="neo-btn w-full justify-between font-normal bg-white"
                  />
                }
              >
                {selectedDspId
                  ? dsps.find((dsp) => dsp.id === selectedDspId)?.name
                  : "Select DSP..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </PopoverTrigger>
              <PopoverContent className="neo-box w-[300px] p-0">
                <div className="p-2 border-b-3 border-black">
                  <div className="flex gap-2">
                    <Input 
                      placeholder="New DSP name..." 
                      value={newDspName}
                      onChange={(e) => setNewDspName(e.target.value)}
                      className="neo-input h-8 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleCreateDsp();
                        }
                      }}
                    />
                    <Button size="sm" className="neo-btn bg-[var(--color-neo-cyan)]" onClick={handleCreateDsp} disabled={!newDspName.trim()}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="max-h-[200px] overflow-y-auto p-1">
                  {dsps.length === 0 && (
                    <p className="p-2 text-sm text-zinc-500 text-center font-bold">No DSPs found.</p>
                  )}
                  {dsps.map((dsp) => (
                    <div
                      key={dsp.id}
                      className={cn(
                        "relative flex cursor-pointer select-none items-center rounded-md px-2 py-1.5 text-sm outline-none hover:bg-[var(--color-neo-yellow)] hover:border-2 hover:border-black font-medium transition-all",
                        selectedDspId === dsp.id ? "bg-[var(--color-neo-yellow)] border-2 border-black" : "border-2 border-transparent"
                      )}
                      onClick={() => {
                        setSelectedDspId(dsp.id);
                        setIsDspOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
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
            <label className="text-sm font-bold text-black uppercase tracking-wider">Task Status</label>
            <div className="flex gap-2">
              {(['None', 'Ongoing', 'Completed'] as const).map((s) => (
                <Button
                  key={s}
                  variant={status === s ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "neo-btn",
                    status === s && s === 'Ongoing' ? 'bg-[var(--color-neo-yellow)]' : 
                    status === s && s === 'Completed' ? 'bg-[var(--color-neo-green)]' : 
                    status === s ? 'bg-black text-white' : 'bg-white'
                  )}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-bold text-black uppercase tracking-wider">Tags</label>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isSelected = selectedTagIds.includes(tag.id);
              return (
                <Badge
                  key={tag.id}
                  variant={isSelected ? 'default' : 'outline'}
                  className={cn(
                    "cursor-pointer transition-all border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:translate-y-[1px] hover:translate-x-[1px] hover:shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]",
                    isSelected ? tag.color : "bg-white text-black"
                  )}
                  onClick={() => toggleTag(tag.id)}
                >
                  {tag.name}
                </Badge>
              );
            })}
          </div>
        </div>

        <div className="pt-4 border-t-3 border-black flex justify-end">
          <Button onClick={handleSubmit} size="lg" className="neo-btn bg-[var(--color-neo-violet)] w-full sm:w-auto text-lg px-8">
            Log Update
          </Button>
        </div>
      </div>
    </div>
  );
}
