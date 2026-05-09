import { useState } from 'react';
import { Archive as ArchiveIcon, CalendarDays, Download, FileArchive, Paperclip, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { buildPulseMarkdownExport, type MarkdownExportStats } from '@/lib/dataExport';

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

export default function Archive() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [lastExport, setLastExport] = useState<MarkdownExportStats | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const { blob, stats } = await buildPulseMarkdownExport({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        includeAttachments,
      });
      downloadBlob(blob, stats.fileName);
      setLastExport(stats);
      toast.success(`Exported ${stats.counts.logs} logs and ${stats.counts.brainCards} Brain cards`);
    } catch (error: any) {
      toast.error(error?.message || 'Could not export Pulse data.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-3 border-black bg-[var(--color-neo-yellow)] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <ArchiveIcon className="h-6 w-6 text-black stroke-[3]" />
        </div>
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tight text-black">Archive</h1>
          <p className="mt-1 font-medium text-zinc-600">Export Pulse records as a local Markdown ZIP.</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="neo-box space-y-6 bg-white p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-black">
                <CalendarDays className="h-4 w-4 stroke-[3]" />
                Start Date
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="neo-input"
              />
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-black">
                <CalendarDays className="h-4 w-4 stroke-[3]" />
                End Date
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="neo-input"
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border-3 border-black bg-zinc-50 p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border-3 border-black bg-[var(--color-neo-cyan)]">
                <Paperclip className="h-5 w-5 stroke-[3]" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-black uppercase text-black">Include Attachments</span>
                <span className="block text-xs font-medium text-zinc-600">Log files are copied into the ZIP.</span>
              </span>
            </span>
            <input
              type="checkbox"
              checked={includeAttachments}
              onChange={(event) => setIncludeAttachments(event.target.checked)}
              className="h-6 w-6 accent-black"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            {['Profile', 'Fleet', 'Logbook', 'Tags', 'Watchtower', 'Brain Cards'].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-lg border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black">
                <ShieldCheck className="h-4 w-4 text-emerald-600 stroke-[3]" />
                {item}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t-3 border-black pt-5">
            <Button
              onClick={handleExport}
              disabled={isExporting}
              className="neo-btn bg-[var(--color-neo-green)] text-black"
            >
              {isExporting ? (
                <>
                  <FileArchive className="h-4 w-4 animate-pulse stroke-[3]" />
                  Exporting
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 stroke-[3]" />
                  Download ZIP
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStartDate('');
                setEndDate('');
              }}
              className="neo-btn bg-zinc-200 text-black"
              disabled={isExporting}
            >
              All Time
            </Button>
          </div>
        </div>

        <aside className="neo-box h-fit space-y-4 bg-[var(--color-neo-yellow)] p-5">
          <div className="flex items-center gap-3">
            <FileArchive className="h-6 w-6 text-black stroke-[3]" />
            <h2 className="text-xl font-black uppercase text-black">Local Only</h2>
          </div>
          <div className="space-y-2 text-sm font-bold text-black">
            <p>No backup file is written to Firestore.</p>
            <p>No Supabase vector rows are exported.</p>
            <p>Brain chats and AI keys are omitted.</p>
          </div>
          {lastExport && (
            <div className="border-t-3 border-black pt-4 text-sm font-bold text-black">
              <p className="mb-2 uppercase">Last Export</p>
              <p>{lastExport.dateRangeLabel}</p>
              <p>{lastExport.counts.dsps} DSPs</p>
              <p>{lastExport.counts.logs} logs</p>
              <p>{lastExport.counts.brainCards} Brain cards</p>
              <p>{lastExport.counts.attachments} attachments</p>
              {lastExport.counts.skippedAttachments > 0 && (
                <p>{lastExport.counts.skippedAttachments} attachments skipped</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
