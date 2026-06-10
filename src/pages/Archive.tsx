import { useState } from 'react';
import { Archive as ArchiveIcon, CalendarDays, Download, FileArchive, Paperclip, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/PageHeader';
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
      <PageHeader
        icon={ArchiveIcon}
        title="Archive"
        subtitle="Export Pulse records as a local Markdown ZIP."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="glass-panel space-y-6 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="lux-label flex items-center gap-2">
                <CalendarDays className="h-4 w-4 stroke-[1.75]" />
                Start Date
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="lux-label flex items-center gap-2">
                <CalendarDays className="h-4 w-4 stroke-[1.75]" />
                End Date
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[var(--lux-border)] bg-[var(--lux-fill)] p-4 transition-colors hover:border-[var(--lux-gold-border)]">
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]">
                <Paperclip className="h-5 w-5 stroke-[1.75] text-[var(--lux-gold)]" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--lux-text)]">Include Attachments</span>
                <span className="block text-xs text-[var(--lux-muted)]">Log files are copied into the ZIP.</span>
              </span>
            </span>
            <input
              type="checkbox"
              checked={includeAttachments}
              onChange={(event) => setIncludeAttachments(event.target.checked)}
              className="h-5 w-5 accent-[var(--lux-gold-bright)]"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            {['Profile', 'Fleet', 'Logbook', 'Tags', 'Watchtower', 'Brain Cards'].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-full border border-[var(--lux-border)] bg-[var(--lux-fill)] px-3.5 py-2 text-sm font-medium text-[var(--lux-text)]">
                <ShieldCheck className="h-4 w-4 stroke-[1.75] text-[var(--lux-emerald)]" />
                {item}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--lux-border)] pt-5">
            <Button
              onClick={handleExport}
              disabled={isExporting}
              className="glass-btn glass-btn-gold"
            >
              {isExporting ? (
                <>
                  <FileArchive className="h-4 w-4 animate-pulse stroke-[1.75]" />
                  Exporting
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 stroke-[1.75]" />
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
              className="glass-btn"
              disabled={isExporting}
            >
              All Time
            </Button>
          </div>
        </div>

        <aside className="glass-panel h-fit space-y-4 border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)] p-5">
          <div className="flex items-center gap-3">
            <FileArchive className="h-6 w-6 stroke-[1.75] text-[var(--lux-gold)]" />
            <h2 className="font-display text-xl font-semibold text-[var(--lux-text)]">Local Only</h2>
          </div>
          <div className="space-y-2 text-sm font-medium text-[var(--lux-text)]">
            <p>No backup file is written to Firestore.</p>
            <p>No Supabase vector rows are exported.</p>
            <p>Brain chats and AI keys are omitted.</p>
          </div>
          {lastExport && (
            <div className="border-t border-[var(--lux-gold-border)] pt-4 text-sm font-medium text-[var(--lux-text)]">
              <p className="lux-label mb-2">Last Export</p>
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
