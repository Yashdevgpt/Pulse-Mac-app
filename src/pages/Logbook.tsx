import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, DSP, Log, Tag } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { format, startOfWeek, endOfWeek } from 'date-fns';
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } from 'docx';
import { ArrowLeft, BookOpen, Search, Paperclip, MoreVertical, Trash2, Edit2, Calendar as CalendarIcon, Download } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { findDspBySlugOrId } from '@/lib/slugs';
import { autoIndexDspRecord, autoIndexFleetLog, deleteBrainMemorySource } from '@/lib/brainApi';

type ExportImageType = 'jpg' | 'png' | 'gif' | 'bmp';

const getExportImageType = (file: { name: string; type: string }): ExportImageType | null => {
  if (file.type === 'image/jpeg' || file.type === 'image/jpg') return 'jpg';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/gif') return 'gif';
  if (file.type === 'image/bmp') return 'bmp';

  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'jpg';
  if (extension === 'png' || extension === 'gif' || extension === 'bmp') return extension;
  return null;
};

export default function Logbook() {
  const { dspId } = useParams<{ dspId: string }>();
  const navigate = useNavigate();
  
  const [dsp, setDsp] = useState<DSP | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  
  // Edit state
  const [editingLog, setEditingLog] = useState<Log | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState<'Ongoing' | 'Completed' | 'None'>('None');
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dspId) {
      loadData(dspId);
    }
  }, [dspId]);

  const loadData = async (id: string) => {
    const allDsps = await db.getDSPs();
    const loadedDsp = findDspBySlugOrId(allDsps, id);
    if (!loadedDsp) {
      navigate('/fleet');
      return;
    }
    setDsp(loadedDsp);
    
    const [loadedLogs, loadedTags] = await Promise.all([
      db.getLogsByDSP(loadedDsp.id),
      db.getTags(),
    ]);
    setLogs(loadedLogs);
    setTags(loadedTags);
  };

  const handleDelete = async (logId: string) => {
    if (!window.confirm('Are you sure you want to delete this log?')) return;

    // Best-effort: clear the Brain memory chunks for this log first so chat
    // sources can't continue to cite a deleted record. If Brain is offline we
    // continue anyway — the Reset Memory button on the Brain page is the
    // safety net.
    try {
      await deleteBrainMemorySource('fleet_log', logId);
    } catch (error) {
      console.warn('Brain memory cleanup for fleet_log failed:', (error as Error)?.message || error);
    }
    await db.deleteLog(logId);
    // The DSP record's memory entry embeds log counts and the latest log
    // summary, so refresh it now that a log is gone.
    if (dsp) autoIndexDspRecord(dsp);
    setLogs(prev => prev.filter(l => l.id !== logId));
    toast.success('Log deleted');
  };

  const handleEditClick = (log: Log) => {
    setEditingLog(log);
    setEditContent(log.content);
    setEditTags(log.tags || []);
    setEditStatus(log.status || 'None');
    setIsEditDialogOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editingLog || !editContent.trim()) return;
    
    const updatedLog = { 
      ...editingLog, 
      content: editContent.trim(), 
      tags: editTags,
      status: editStatus,
      updatedAt: Date.now() 
    };
    await db.saveLog(updatedLog);
    autoIndexFleetLog(updatedLog);

    setLogs(logs.map(l => l.id === updatedLog.id ? updatedLog : l));
    setIsEditDialogOpen(false);
    setEditingLog(null);
    toast.success('Log updated');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, logId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (Firestore limit is 1MB, let's limit to 800KB to be safe)
    if (file.size > 800 * 1024) {
      toast.error('File is too large. Maximum size is 800KB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      const logToUpdate = logs.find(l => l.id === logId);
      if (logToUpdate) {
        const updatedLog = {
          ...logToUpdate,
          file: {
            name: file.name,
            type: file.type,
            data: base64
          },
          updatedAt: Date.now()
        };
        await db.saveLog(updatedLog);
        autoIndexFleetLog(updatedLog);
        setLogs(prev => prev.map(l => l.id === updatedLog.id ? updatedLog : l));
        toast.success('File attached');
      }
    };
    reader.readAsDataURL(file);
  };

  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');

  const handleExport = async () => {
    let logsToExport = logs;
    
    if (exportStartDate) {
      const start = new Date(exportStartDate).getTime();
      logsToExport = logsToExport.filter(l => l.createdAt >= start);
    }
    if (exportEndDate) {
      const end = new Date(exportEndDate).getTime() + 86400000; // include end of day
      logsToExport = logsToExport.filter(l => l.createdAt <= end);
    }

    const children: any[] = [];
    
    children.push(new Paragraph({
      text: `Activity Logs: ${dsp?.name}`,
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 400 }
    }));

    for (const log of logsToExport) {
      // Date and Status
      children.push(new Paragraph({
        children: [
          new TextRun({ text: format(log.createdAt, 'MMM do, yyyy - h:mm a'), bold: true, size: 28 }),
          new TextRun({ text: ` [Status: ${log.status}]`, italics: true, color: "666666" })
        ],
        spacing: { before: 400, after: 200 }
      }));

      // Content
      const contentLines = log.content.split('\n');
      for (const line of contentLines) {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, size: 24 })],
          spacing: { after: 100 }
        }));
      }

      // Tags
      if (log.tags.length > 0) {
        const tagNames = log.tags.map(tId => tags.find(t => t.id === tId)?.name).filter(Boolean).join(', ');
        children.push(new Paragraph({
          children: [new TextRun({ text: `Tags: ${tagNames}`, italics: true, size: 20, color: "888888" })],
          spacing: { before: 100, after: 200 }
        }));
      }

      // Resolution Notes
      if (log.resolutionNote) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `Resolution Notes:`, bold: true, size: 24, color: "006600" })],
          spacing: { before: 200, after: 100 }
        }));
        
        const resLines = log.resolutionNote.split('\n');
        for (const line of resLines) {
          children.push(new Paragraph({
            children: [new TextRun({ text: line, size: 24, color: "004400" })],
            spacing: { after: 100 }
          }));
        }
      }

      // Image attachment
      const fileImageType = log.file ? getExportImageType(log.file) : null;
      if (log.file && fileImageType) {
        try {
          const base64Data = log.file.data.split(',')[1];
          const binaryString = window.atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          children.push(new Paragraph({
            children: [
              new ImageRun({
                type: fileImageType,
                data: bytes,
                transformation: { width: 400, height: 300 }
              })
            ],
            spacing: { before: 200, after: 200 }
          }));
        } catch (e) {
          console.error("Failed to embed image", e);
        }
      } else if (log.file) {
         children.push(new Paragraph({
          children: [new TextRun({ text: `[Attached File: ${log.file.name}]`, italics: true, size: 20, color: "0000FF" })],
          spacing: { before: 100, after: 200 }
        }));
      }

      // Resolution Image attachment
      const resolutionImageType = log.resolutionFile ? getExportImageType(log.resolutionFile) : null;
      if (log.resolutionFile && resolutionImageType) {
        try {
          const base64Data = log.resolutionFile.data.split(',')[1];
          const binaryString = window.atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          children.push(new Paragraph({
            children: [
              new ImageRun({
                type: resolutionImageType,
                data: bytes,
                transformation: { width: 400, height: 300 }
              })
            ],
            spacing: { before: 200, after: 200 }
          }));
        } catch (e) {
          console.error("Failed to embed resolution image", e);
        }
      } else if (log.resolutionFile) {
         children.push(new Paragraph({
          children: [new TextRun({ text: `[Attached Resolution File: ${log.resolutionFile.name}]`, italics: true, size: 20, color: "006600" })],
          spacing: { before: 100, after: 200 }
        }));
      }
      
      // Separator
      children.push(new Paragraph({
        text: "--------------------------------------------------",
        spacing: { before: 200, after: 200 }
      }));
    }

    const doc = new Document({
      sections: [{
        properties: {},
        children: children
      }]
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const exportFileDefaultName = `${dsp?.name}_logs_${exportStartDate || 'all'}_to_${exportEndDate || 'all'}.docx`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', url);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    URL.revokeObjectURL(url);
    
    setIsExportDialogOpen(false);
    toast.success(`Exported ${logsToExport.length} logs to Word`);
  };

  // Filtering
  const tagById = useMemo(() => new Map(tags.map(tag => [tag.id, tag])), [tags]);

  const filteredLogs = useMemo(() => logs.filter(log => {
    const matchesSearch = log.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'All' || log.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [logs, searchQuery, statusFilter]);

  // Group by week
  const groupedLogs = useMemo(() => {
    const groups = new Map<number, { weekStart: Date; logs: Log[] }>();

    for (const log of filteredLogs) {
      const weekStart = startOfWeek(new Date(log.createdAt), { weekStartsOn: 1 });
      const weekKey = weekStart.getTime();
      const existingGroup = groups.get(weekKey);

      if (existingGroup) {
        existingGroup.logs.push(log);
      } else {
        groups.set(weekKey, { weekStart, logs: [log] });
      }
    }

    return Array.from(groups.values()).sort((left, right) => right.weekStart.getTime() - left.weekStart.getTime());
  }, [filteredLogs]);

  if (!dsp) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button
          className="glass-btn px-3"
          onClick={() => navigate('/fleet')}
          title="Back to Fleet"
          aria-label="Back to Fleet"
        >
          <ArrowLeft className="w-4 h-4 stroke-[1.75]" />
          <span className="hidden sm:inline">Fleet</span>
        </Button>
        <PageHeader
          icon={BookOpen}
          title={dsp.name}
          subtitle="Activity Logbook"
          compact
          className="mb-0 min-w-0 flex-1"
          actions={
            <Button
              className="glass-btn glass-btn-gold"
              onClick={() => setIsExportDialogOpen(true)}
            >
              <Download className="w-4 h-4 mr-2 stroke-[1.75]" /> Export Logs
            </Button>
          }
        />
      </div>

      <div className="glass-panel mb-8 flex flex-col gap-4 p-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 stroke-[1.75] text-[var(--lux-soft)]" />
          <Input
            placeholder="Search activity..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {['All', 'Ongoing', 'Completed'].map(s => (
            <Button
              key={s}
              onClick={() => setStatusFilter(s)}
              size="sm"
              className={cn(
                'glass-btn',
                statusFilter === s && s === 'Ongoing' ? 'bg-[var(--lux-amber-fill)] border-[var(--lux-amber-border)] text-[var(--lux-amber)]' :
                statusFilter === s && s === 'Completed' ? 'bg-[var(--lux-emerald-fill)] border-[var(--lux-emerald-border)] text-[var(--lux-emerald)]' :
                statusFilter === s ? 'bg-[var(--lux-fill-strong)] border-[var(--lux-border-strong)]' : ''
              )}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-12">
        {groupedLogs.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No activity found"
            description="Log an update from the Bridge, or loosen the search and status filters."
          />
        ) : (
          groupedLogs.map((group, i) => (
            <div key={i} className="relative">
              <div className="sticky top-0 z-10 mb-6 bg-[var(--lux-bg)]/80 py-2 backdrop-blur-md">
                <h3 className="glass-chip px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--lux-muted)]">
                  <CalendarIcon className="w-3.5 h-3.5 stroke-[1.75] text-[var(--lux-gold)]" />
                  Week of {format(group.weekStart, 'MMM do, yyyy')}
                </h3>
              </div>

              <div className="relative space-y-6 pl-10 before:absolute before:inset-y-2 before:left-[7px] before:w-px before:bg-[var(--lux-border-strong)]">
                {group.logs.map((log) => (
                  <div key={log.id} className="relative">
                    <div
                      className={cn(
                        'absolute -left-10 top-5 h-[15px] w-[15px] rounded-full',
                        log.status === 'Ongoing' ? 'bg-[var(--lux-amber)] ring-4 ring-[var(--lux-amber-fill)]' :
                        log.status === 'Completed' ? 'bg-[var(--lux-emerald)] ring-4 ring-[var(--lux-emerald-fill)]' : 'bg-[var(--lux-sapphire)] ring-4 ring-[var(--lux-sapphire-fill)]'
                      )}
                      aria-hidden
                    />

                    <div className="glass-panel p-5 transition-all hover:-translate-y-0.5 hover:border-[var(--lux-border-strong)]">
                      <div className="flex justify-between items-start mb-2">
                        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--lux-soft)]">
                          {format(log.createdAt, 'MMM do, h:mm a')}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="sm" className="h-8 w-8 rounded-full border border-[var(--lux-border)] p-0 text-[var(--lux-muted)] hover:bg-[var(--lux-fill)] hover:text-[var(--lux-text)]" />
                            }
                          >
                            <MoreVertical className="h-4 w-4 stroke-[1.75]" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditClick(log)}>
                              <Edit2 className="w-4 h-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              // Trigger file input
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.onchange = (e: any) => handleFileUpload(e, log.id);
                              input.click();
                            }}>
                              <Paperclip className="w-4 h-4 mr-2" /> Attach File
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-[var(--lux-ruby)]" onClick={() => handleDelete(log.id)}>
                              <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      
                      <p className="whitespace-pre-wrap text-sm mb-4 leading-relaxed text-[var(--lux-text)]">
                        {log.content}
                      </p>

                      {log.file && (
                        <div className="mb-4 flex items-center justify-between rounded-xl border border-[var(--lux-border)] bg-[var(--lux-fill)] p-2.5">
                          <div className="flex items-center text-sm font-medium text-[var(--lux-text)] truncate">
                            <Paperclip className="w-4 h-4 mr-2 shrink-0 stroke-[1.75] text-[var(--lux-soft)]" />
                            <span className="truncate">{log.file.name}</span>
                          </div>
                          <Button variant="ghost" size="sm" className="font-medium text-[var(--lux-gold)] underline decoration-1 underline-offset-4" onClick={() => {
                            const a = document.createElement('a');
                            a.href = log.file!.data;
                            a.download = log.file!.name;
                            a.click();
                          }}>
                            Download
                          </Button>
                        </div>
                      )}

                      {log.resolutionNote && (
                        <div className="mb-4 rounded-xl border border-[var(--lux-emerald-border)] bg-[var(--lux-emerald-fill)] p-4">
                          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--lux-emerald)]">Resolution Notes</h4>
                          <p className="text-sm text-[var(--lux-text)] whitespace-pre-wrap">{log.resolutionNote}</p>

                          {log.resolutionFile && (
                            <div className="mt-3 flex items-center justify-between rounded-xl border border-[var(--lux-border)] bg-[var(--lux-fill)] p-2.5">
                              <div className="flex items-center text-sm font-medium text-[var(--lux-text)] truncate">
                                <Paperclip className="w-4 h-4 mr-2 shrink-0 stroke-[1.75] text-[var(--lux-soft)]" />
                                <span className="truncate">{log.resolutionFile.name}</span>
                              </div>
                              <Button variant="ghost" size="sm" className="font-medium text-[var(--lux-gold)] underline decoration-1 underline-offset-4" onClick={() => {
                                const a = document.createElement('a');
                                a.href = log.resolutionFile!.data;
                                a.download = log.resolutionFile!.name;
                                a.click();
                              }}>
                                Download
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 mt-auto">
                        {log.status !== 'None' && (
                          <Badge className={cn(
                            'text-[11px] font-semibold uppercase tracking-[0.14em]',
                            log.status === 'Ongoing'
                              ? 'border-[var(--lux-amber-border)] bg-[var(--lux-amber-fill)] text-[var(--lux-amber)]'
                              : 'border-[var(--lux-emerald-border)] bg-[var(--lux-emerald-fill)] text-[var(--lux-emerald)]'
                          )}>
                            {log.status}
                          </Badge>
                        )}
                        {log.tags.map(tagId => {
                          const tag = tagById.get(tagId);
                          if (!tag) return null;
                          return (
                            <Badge key={tag.id}>
                              <span className={cn('h-2 w-2 rounded-full', tag.color)} aria-hidden />
                              {tag.name}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px] gap-0 p-0">
          <DialogHeader className="border-b border-[var(--lux-border)] p-5">
            <DialogTitle className="text-2xl">Edit Log</DialogTitle>
          </DialogHeader>
          <div className="p-5 space-y-4">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[150px]"
            />

            <div className="space-y-2">
              <label className="lux-label">Task Status</label>
              <div className="flex gap-2">
                {(['None', 'Ongoing', 'Completed'] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    onClick={() => setEditStatus(s)}
                    className={cn(
                      'glass-btn',
                      editStatus === s && s === 'Ongoing' ? 'bg-[var(--lux-amber-fill)] border-[var(--lux-amber-border)] text-[var(--lux-amber)]' :
                      editStatus === s && s === 'Completed' ? 'bg-[var(--lux-emerald-fill)] border-[var(--lux-emerald-border)] text-[var(--lux-emerald)]' :
                      editStatus === s ? 'bg-[var(--lux-fill-strong)] border-[var(--lux-border-strong)]' : ''
                    )}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="lux-label">Tags</label>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const isSelected = editTags.includes(tag.id);
                  return (
                    <Badge
                      key={tag.id}
                      className={cn(
                        'cursor-pointer px-3 py-1 transition-all hover:-translate-y-[1px]',
                        isSelected && 'border-[var(--lux-gold-border)] bg-[var(--lux-gold-fill)]'
                      )}
                      onClick={() => {
                        setEditTags(prev =>
                          prev.includes(tag.id)
                            ? prev.filter(id => id !== tag.id)
                            : [...prev, tag.id]
                        );
                      }}
                    >
                      <span className={cn('h-2 w-2 rounded-full', tag.color)} aria-hidden />
                      {tag.name}
                    </Badge>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter className="m-0 border-t border-[var(--lux-border)] bg-[var(--lux-fill)] p-4">
            <Button className="glass-btn" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button className="glass-btn glass-btn-gold" onClick={handleSaveEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent className="gap-0 p-0">
          <DialogHeader className="border-b border-[var(--lux-border)] p-5">
            <DialogTitle className="text-2xl">Export Logs</DialogTitle>
          </DialogHeader>
          <div className="p-5 space-y-4">
            <p className="text-sm text-[var(--lux-muted)]">Select a date range to export. Leave blank to export all logs.</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="lux-label">Start Date</label>
                <Input type="date" value={exportStartDate} onChange={e => setExportStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="lux-label">End Date</label>
                <Input type="date" value={exportEndDate} onChange={e => setExportEndDate(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter className="m-0 border-t border-[var(--lux-border)] bg-[var(--lux-fill)] p-4">
            <Button className="glass-btn" onClick={() => setIsExportDialogOpen(false)}>Cancel</Button>
            <Button className="glass-btn glass-btn-gold" onClick={handleExport}>Export Word</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
