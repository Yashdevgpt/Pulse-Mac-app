import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, DSP, Log, Tag } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { format, startOfWeek, endOfWeek, isSameWeek } from 'date-fns';
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } from 'docx';
import { ArrowLeft, Search, Paperclip, MoreVertical, Trash2, Edit2, Calendar as CalendarIcon, Download } from 'lucide-react';
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
import { deleteBrainMemorySource } from '@/lib/brainApi';

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
    
    const loadedLogs = await db.getLogsByDSP(loadedDsp.id);
    setLogs(loadedLogs);
    
    const loadedTags = await db.getTags();
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
    setLogs(logs.filter(l => l.id !== logId));
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
        setLogs(logs.map(l => l.id === updatedLog.id ? updatedLog : l));
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
  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'All' || log.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Group by week
  const groupedLogs: { weekStart: Date; logs: Log[] }[] = [];
  filteredLogs.forEach(log => {
    const logDate = new Date(log.createdAt);
    const weekStart = startOfWeek(logDate, { weekStartsOn: 1 }); // Monday start
    
    const existingGroup = groupedLogs.find(g => isSameWeek(g.weekStart, weekStart, { weekStartsOn: 1 }));
    if (existingGroup) {
      existingGroup.logs.push(log);
    } else {
      groupedLogs.push({ weekStart, logs: [log] });
    }
  });

  if (!dsp) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-8">
        <Button variant="ghost" className="-ml-4 mb-4 text-zinc-500" onClick={() => navigate('/fleet')}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Fleet
        </Button>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-light text-zinc-900 tracking-tight">{dsp.name}</h1>
            <p className="text-zinc-500 mt-1">Activity Logbook</p>
          </div>
          <Button variant="outline" onClick={() => setIsExportDialogOpen(true)}>
            <Download className="w-4 h-4 mr-2" /> Export Logs
          </Button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-8 bg-white p-4 rounded-xl border border-zinc-200">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
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
              variant={statusFilter === s ? 'default' : 'outline'}
              onClick={() => setStatusFilter(s)}
              size="sm"
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-12">
        {groupedLogs.length === 0 ? (
          <div className="text-center py-20 text-zinc-500">No activity found.</div>
        ) : (
          groupedLogs.map((group, i) => (
            <div key={i} className="relative">
              <div className="sticky top-0 z-10 bg-zinc-50/90 backdrop-blur-sm py-2 mb-6">
                <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider flex items-center">
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  Week of {format(group.weekStart, 'MMM do, yyyy')}
                </h3>
              </div>
              
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-zinc-200 before:to-transparent">
                {group.logs.map((log) => (
                  <div key={log.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-zinc-50 bg-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                      <div className={cn(
                        "w-2.5 h-2.5 rounded-full",
                        log.status === 'Ongoing' ? 'bg-orange-500' : 
                        log.status === 'Completed' ? 'bg-green-500' : 'bg-blue-500'
                      )} />
                    </div>
                    
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-5 rounded-xl shadow-sm border border-zinc-200 hover:border-blue-200 transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <div className="text-xs text-zinc-500 font-medium">
                          {format(log.createdAt, 'MMM do, h:mm a')}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" />
                            }
                          >
                            <MoreVertical className="h-4 w-4" />
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
                            <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(log.id)}>
                              <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      
                      <p className="text-zinc-800 whitespace-pre-wrap text-sm mb-4 leading-relaxed">
                        {log.content}
                      </p>
                      
                      {log.file && (
                        <div className="mb-4 p-2 bg-zinc-50 rounded border border-zinc-200 flex items-center justify-between">
                          <div className="flex items-center text-sm text-zinc-600 truncate">
                            <Paperclip className="w-4 h-4 mr-2 shrink-0" />
                            <span className="truncate">{log.file.name}</span>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => {
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
                        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                          <h4 className="text-xs font-bold text-green-800 uppercase mb-2">Resolution Notes</h4>
                          <p className="text-sm text-green-900 whitespace-pre-wrap">{log.resolutionNote}</p>
                          
                          {log.resolutionFile && (
                            <div className="mt-3 p-2 bg-white rounded border border-green-200 flex items-center justify-between">
                              <div className="flex items-center text-sm text-green-700 truncate">
                                <Paperclip className="w-4 h-4 mr-2 shrink-0" />
                                <span className="truncate">{log.resolutionFile.name}</span>
                              </div>
                              <Button variant="ghost" size="sm" className="text-green-700 hover:text-green-800 hover:bg-green-100" onClick={() => {
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
                          <Badge variant="outline" className={cn(
                            log.status === 'Ongoing' ? 'text-orange-700 bg-orange-50 border-orange-200' : 'text-green-700 bg-green-50 border-green-200'
                          )}>
                            {log.status}
                          </Badge>
                        )}
                        {log.tags.map(tagId => {
                          const tag = tags.find(t => t.id === tagId);
                          if (!tag) return null;
                          return (
                            <Badge key={tag.id} className={cn("text-white", tag.color)}>
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
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Log</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <Textarea 
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[150px]"
            />
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Task Status</label>
              <div className="flex gap-2">
                {(['None', 'Ongoing', 'Completed'] as const).map((s) => (
                  <Button
                    key={s}
                    variant={editStatus === s ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setEditStatus(s)}
                    className={cn(
                      editStatus === s && s === 'Ongoing' && 'bg-orange-500 hover:bg-orange-600',
                      editStatus === s && s === 'Completed' && 'bg-green-600 hover:bg-green-700',
                    )}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Tags</label>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const isSelected = editTags.includes(tag.id);
                  return (
                    <Badge
                      key={tag.id}
                      variant={isSelected ? 'default' : 'outline'}
                      className={cn(
                        "cursor-pointer transition-colors",
                        isSelected ? tag.color : "hover:bg-zinc-100",
                        isSelected && "text-white"
                      )}
                      onClick={() => {
                        setEditTags(prev => 
                          prev.includes(tag.id) 
                            ? prev.filter(id => id !== tag.id)
                            : [...prev, tag.id]
                        );
                      }}
                    >
                      {tag.name}
                    </Badge>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Logs</DialogTitle>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <p className="text-sm text-zinc-500">Select a date range to export. Leave blank to export all logs.</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Start Date</label>
                <Input type="date" value={exportStartDate} onChange={e => setExportStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">End Date</label>
                <Input type="date" value={exportEndDate} onChange={e => setExportEndDate(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExportDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleExport}>Export Word</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
