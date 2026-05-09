import JSZip from 'jszip';

import { auth } from '@/lib/firebase';
import { db, type AppUser, type BrainCard, type DSP, type ExportDateRange, type Log, type LogFile, type Tag, type WatchtowerPreferences } from '@/lib/db';

export interface MarkdownExportOptions {
  startDate?: string;
  endDate?: string;
  includeAttachments: boolean;
}

export interface MarkdownExportStats {
  fileName: string;
  exportedAt: string;
  dateRangeLabel: string;
  counts: {
    dsps: number;
    logs: number;
    tags: number;
    brainCards: number;
    watchtowerPreferences: number;
    attachments: number;
    skippedAttachments: number;
  };
}

interface AttachmentRef {
  label: string;
  name: string;
  type: string;
  archivePath?: string;
  skipped?: boolean;
}

const EXPORT_FORMAT_VERSION = '1.0.0';

const pad = (value: number) => String(value).padStart(2, '0');

const localDateStamp = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const toIso = (timestamp?: number) =>
  typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : '';

const parseDateBoundary = (value: string | undefined, boundary: 'start' | 'end') => {
  if (!value) return undefined;
  const time = boundary === 'start' ? '00:00:00.000' : '23:59:59.999';
  const date = new Date(`${value}T${time}`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${boundary} date.`);
  }
  return date.getTime();
};

const buildDateRange = (options: MarkdownExportOptions): ExportDateRange => {
  const startMs = parseDateBoundary(options.startDate, 'start');
  const endMs = parseDateBoundary(options.endDate, 'end');
  if (typeof startMs === 'number' && typeof endMs === 'number' && startMs > endMs) {
    throw new Error('Start date must be before end date.');
  }
  return { startMs, endMs };
};

const dateRangeLabel = (options: MarkdownExportOptions) => {
  if (options.startDate && options.endDate) return `${options.startDate} to ${options.endDate}`;
  if (options.startDate) return `${options.startDate} onward`;
  if (options.endDate) return `through ${options.endDate}`;
  return 'all-time';
};

const safeSegment = (value: string | undefined, fallback: string) => {
  const cleaned = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
};

const splitExtension = (path: string) => {
  const dot = path.lastIndexOf('.');
  if (dot <= 0) return { base: path, ext: '' };
  return { base: path.slice(0, dot), ext: path.slice(dot) };
};

const safePathSegment = (segment: string) => {
  const { base, ext } = splitExtension(segment);
  const safeExt = ext.replace(/[^.a-z0-9]/gi, '').toLowerCase();
  return `${safeSegment(base, 'file')}${safeExt}`;
};

const normalizePath = (path: string) =>
  path
    .split('/')
    .map(safePathSegment)
    .join('/');

const uniqueArchivePath = (usedPaths: Set<string>, preferredPath: string) => {
  const normalized = normalizePath(preferredPath);
  if (!usedPaths.has(normalized)) {
    usedPaths.add(normalized);
    return normalized;
  }

  const { base, ext } = splitExtension(normalized);
  let index = 2;
  let candidate = `${base}-${index}${ext}`;
  while (usedPaths.has(candidate)) {
    index += 1;
    candidate = `${base}-${index}${ext}`;
  }
  usedPaths.add(candidate);
  return candidate;
};

const relativeArchiveLink = (fromFilePath: string, toFilePath: string) => {
  const fromParts = fromFilePath.split('/').slice(0, -1);
  const toParts = toFilePath.split('/');
  let common = 0;
  while (fromParts[common] && fromParts[common] === toParts[common]) {
    common += 1;
  }
  const up = fromParts.slice(common).map(() => '..');
  const down = toParts.slice(common);
  return [...up, ...down].join('/') || '.';
};

const yamlScalar = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
};

const frontmatter = (fields: Record<string, unknown>) => {
  const lines = Object.entries(fields).map(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length === 0) return `${key}: []`;
      return `${key}:\n${value.map((item) => `  - ${yamlScalar(item)}`).join('\n')}`;
    }
    return `${key}: ${yamlScalar(value)}`;
  });
  return `---\n${lines.join('\n')}\n---`;
};

const headingText = (value: string | undefined, fallback: string) =>
  String(value || fallback).replace(/\s+/g, ' ').trim() || fallback;

const bodyText = (value: string | undefined, fallback = '_No text recorded._') =>
  String(value || '').trim() || fallback;

const tableCell = (value: unknown) =>
  String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

const tagNamesForLog = (log: Log, tags: Tag[]) =>
  (log.tags || [])
    .map((tagId) => tags.find((tag) => tag.id === tagId)?.name || tagId)
    .filter(Boolean);

const logDatePrefix = (log: Log) => {
  const date = new Date(log.createdAt);
  if (Number.isNaN(date.getTime())) return 'undated';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const addMarkdownFile = (zip: JSZip, usedPaths: Set<string>, preferredPath: string, markdown: string) => {
  const path = uniqueArchivePath(usedPaths, preferredPath);
  zip.file(path, `${markdown.trim()}\n`);
  return path;
};

const addAttachmentFile = async ({
  zip,
  usedPaths,
  preferredPath,
  file,
}: {
  zip: JSZip;
  usedPaths: Set<string>;
  preferredPath: string;
  file: LogFile;
}) => {
  if (!file.data) return null;
  const path = uniqueArchivePath(usedPaths, preferredPath);
  const response = await fetch(file.data);
  if (!response.ok) {
    throw new Error(`Could not read ${file.name}`);
  }
  zip.file(path, await response.arrayBuffer());
  return path;
};

const profileMarkdown = (profile: AppUser, exportedAt: string) => `${frontmatter({
  type: 'profile',
  uid: profile.uid,
  email: profile.email,
  status: profile.status,
  createdAt: toIso(profile.createdAt),
  exportedAt,
})}

# ${headingText(profile.name || profile.email, 'Profile')}

| Field | Value |
| --- | --- |
| Name | ${tableCell(profile.name)} |
| Email | ${tableCell(profile.email)} |
| Status | ${tableCell(profile.status)} |
| Created | ${tableCell(toIso(profile.createdAt))} |`;

const dspMarkdown = (dsp: DSP, logs: Log[]) => `${frontmatter({
  type: 'dsp_record',
  id: dsp.id,
  name: dsp.name,
  starred: Boolean(dsp.starred),
  createdAt: toIso(dsp.createdAt),
  updatedAt: toIso(dsp.updatedAt),
  exportedLogCount: logs.length,
})}

# ${headingText(dsp.name, 'DSP')}

| Field | Value |
| --- | --- |
| ID | ${tableCell(dsp.id)} |
| Starred | ${dsp.starred ? 'Yes' : 'No'} |
| Created | ${tableCell(toIso(dsp.createdAt))} |
| Updated | ${tableCell(toIso(dsp.updatedAt))} |
| Exported Logs | ${logs.length} |`;

const tagMarkdown = (tag: Tag) => `${frontmatter({
  type: 'tag_record',
  id: tag.id,
  name: tag.name,
  color: tag.color,
})}

# ${headingText(tag.name, 'Tag')}

| Field | Value |
| --- | --- |
| ID | ${tableCell(tag.id)} |
| Color | ${tableCell(tag.color)} |`;

const brainCardMarkdown = (card: BrainCard) => `${frontmatter({
  type: 'brain_card',
  id: card.id,
  title: card.title,
  createdAt: toIso(card.createdAt),
  updatedAt: toIso(card.updatedAt),
})}

# ${headingText(card.title, 'Brain Card')}

${bodyText(card.content)}`;

const watchtowerMarkdown = (preferences: WatchtowerPreferences | null, tags: Tag[]) => {
  const visibleTags = preferences?.visibleTagIds
    .map((tagId) => tags.find((tag) => tag.id === tagId)?.name || tagId)
    .filter(Boolean) || [];

  return `${frontmatter({
    type: 'watchtower_preferences',
    updatedAt: toIso(preferences?.updatedAt),
    visibleTagIds: preferences?.visibleTagIds || [],
    visibleTags,
  })}

# Watchtower Preferences

${visibleTags.length > 0
  ? visibleTags.map((tag) => `- ${tag}`).join('\n')
  : '_No Watchtower tag preferences recorded._'}`;
};

const logMarkdown = ({
  log,
  dsp,
  tags,
  attachments,
  markdownPath,
}: {
  log: Log;
  dsp?: DSP;
  tags: Tag[];
  attachments: AttachmentRef[];
  markdownPath: string;
}) => {
  const tagNames = tagNamesForLog(log, tags);
  const attachmentLinks = attachments.map((attachment) => {
    if (attachment.archivePath) {
      return `- [${attachment.name}](${relativeArchiveLink(markdownPath, attachment.archivePath)})`;
    }
    if (attachment.skipped) {
      return `- ${attachment.name} (${attachment.label}, skipped)`;
    }
    return `- ${attachment.name} (${attachment.label})`;
  });

  return `${frontmatter({
    type: 'fleet_log',
    id: log.id,
    dspId: log.dspId,
    dspName: dsp?.name || '',
    status: log.status,
    tags: tagNames,
    createdAt: toIso(log.createdAt),
    updatedAt: toIso(log.updatedAt),
    attachments: attachments.map((attachment) => attachment.archivePath || `${attachment.name} (skipped)`),
  })}

# ${headingText(dsp?.name ? `${dsp.name} Log` : 'Fleet Log', 'Fleet Log')}

| Field | Value |
| --- | --- |
| DSP | ${tableCell(dsp?.name || log.dspId)} |
| Status | ${tableCell(log.status)} |
| Created | ${tableCell(toIso(log.createdAt))} |
| Updated | ${tableCell(toIso(log.updatedAt))} |
| Tags | ${tableCell(tagNames.join(', ') || 'None')} |

## Log Details

${bodyText(log.content)}

${log.resolutionNote ? `## Resolution Notes\n\n${log.resolutionNote.trim()}\n` : ''}
${attachmentLinks.length > 0 ? `## Attachments\n\n${attachmentLinks.join('\n')}` : ''}`;
};

const readExportSnapshot = async (range: ExportDateRange) => {
  const [profile, dsps, tags, logs, brainCards, watchtowerPreferences] = await Promise.all([
    db.getCurrentUserProfileReadOnly(),
    db.getDSPs(),
    db.getTagsReadOnly(),
    db.getLogsForExport(range),
    db.getBrainCardsForExport(range),
    db.getWatchtowerPreferences(),
  ]);

  return { profile, dsps, tags, logs, brainCards, watchtowerPreferences };
};

export const buildPulseMarkdownExport = async (
  options: MarkdownExportOptions,
): Promise<{ blob: Blob; stats: MarkdownExportStats }> => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sign in again before exporting Pulse data.');
  }

  const range = buildDateRange(options);
  const exportedAt = new Date().toISOString();
  const rangeLabel = dateRangeLabel(options);
  const snapshot = await readExportSnapshot(range);
  const zip = new JSZip();
  const usedPaths = new Set<string>();
  const paths: string[] = [];
  const dspById = new Map(snapshot.dsps.map((dsp) => [dsp.id, dsp]));
  const logsByDsp = new Map<string, Log[]>();
  let attachmentCount = 0;
  let skippedAttachmentCount = 0;

  for (const log of snapshot.logs) {
    const grouped = logsByDsp.get(log.dspId) || [];
    grouped.push(log);
    logsByDsp.set(log.dspId, grouped);
  }

  paths.push(addMarkdownFile(zip, usedPaths, 'README.md', `# Pulse Export

Exported: ${exportedAt}

Date range: ${rangeLabel}

Included: profile, Fleet DSPs, Logbook logs, tags, Watchtower preferences, Brain cards.

Omitted: Brain chats, Supabase Brain vector chunks, AI keys, Firebase/Supabase environment secrets.`));

  paths.push(addMarkdownFile(zip, usedPaths, 'profile.md', profileMarkdown(snapshot.profile, exportedAt)));

  for (const tag of snapshot.tags) {
    paths.push(addMarkdownFile(zip, usedPaths, `tags/${tag.name || tag.id}.md`, tagMarkdown(tag)));
  }

  for (const dsp of snapshot.dsps) {
    const dspSegment = safeSegment(dsp.name || dsp.id, dsp.id || 'dsp');
    paths.push(addMarkdownFile(zip, usedPaths, `fleet/${dspSegment}/dsp.md`, dspMarkdown(dsp, logsByDsp.get(dsp.id) || [])));
  }

  for (const log of snapshot.logs) {
    const dsp = dspById.get(log.dspId);
    const dspSegment = safeSegment(dsp?.name || log.dspId, log.dspId || 'dsp');
    const logSegment = safeSegment(`${logDatePrefix(log)}-${log.content.slice(0, 48) || log.id}`, log.id || 'log');
    const markdownPath = uniqueArchivePath(usedPaths, `fleet/${dspSegment}/logs/${logSegment}.md`);
    const attachments: AttachmentRef[] = [];

    for (const [label, file] of [
      ['Log attachment', log.file],
      ['Resolution attachment', log.resolutionFile],
    ] as const) {
      if (!file) continue;
      const attachment: AttachmentRef = {
        label,
        name: file.name,
        type: file.type,
      };

      if (options.includeAttachments) {
        try {
          const archivePath = await addAttachmentFile({
            zip,
            usedPaths,
            preferredPath: `attachments/logs/${log.id}-${label}-${file.name}`,
            file,
          });
          if (archivePath) {
            attachment.archivePath = archivePath;
            attachmentCount += 1;
            paths.push(archivePath);
          }
        } catch (error) {
          console.warn('Pulse export attachment skipped:', error);
          attachment.skipped = true;
          skippedAttachmentCount += 1;
        }
      } else {
        attachment.skipped = true;
        skippedAttachmentCount += 1;
      }

      attachments.push(attachment);
    }

    zip.file(markdownPath, `${logMarkdown({ log, dsp, tags: snapshot.tags, attachments, markdownPath }).trim()}\n`);
    paths.push(markdownPath);
  }

  for (const card of snapshot.brainCards) {
    paths.push(addMarkdownFile(zip, usedPaths, `brain/cards/${card.title || card.id}.md`, brainCardMarkdown(card)));
  }

  paths.push(addMarkdownFile(zip, usedPaths, 'watchtower/preferences.md', watchtowerMarkdown(snapshot.watchtowerPreferences, snapshot.tags)));

  const fileName = `pulse-export-${rangeLabel.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase()}-${localDateStamp()}.zip`;
  const stats: MarkdownExportStats = {
    fileName,
    exportedAt,
    dateRangeLabel: rangeLabel,
    counts: {
      dsps: snapshot.dsps.length,
      logs: snapshot.logs.length,
      tags: snapshot.tags.length,
      brainCards: snapshot.brainCards.length,
      watchtowerPreferences: snapshot.watchtowerPreferences ? 1 : 0,
      attachments: attachmentCount,
      skippedAttachments: skippedAttachmentCount,
    },
  };

  zip.file('manifest.json', JSON.stringify({
    format: 'pulse-markdown-export',
    version: EXPORT_FORMAT_VERSION,
    exportedAt,
    owner: {
      uid: snapshot.profile.uid,
      email: snapshot.profile.email,
      name: snapshot.profile.name,
    },
    dateRange: {
      label: rangeLabel,
      startDate: options.startDate || null,
      endDate: options.endDate || null,
    },
    counts: stats.counts,
    omitted: ['brain_chats', 'supabase_brain_chunks', 'ai_keys', 'environment_secrets'],
    files: paths.sort(),
  }, null, 2));

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { blob, stats };
};
