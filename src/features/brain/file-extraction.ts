import JSZip from 'jszip';

import type { ExtractedKnowledgeFile } from './types';

const countMatches = (value: string, pattern: RegExp) =>
  value.match(pattern)?.length || 0;

const getFileExtension = (file: File) =>
  file.name.split('.').pop()?.toLowerCase() || '';

export const cleanExtractedText = (text: string) =>
  text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

const getTextQualityScore = (text: string) => {
  const cleanedText = cleanExtractedText(text);
  const replacementCount = countMatches(cleanedText, /\uFFFD/g);
  const controlCount = countMatches(cleanedText, /[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g);
  const printableCount = countMatches(cleanedText, /[\p{L}\p{N}\s.,;:!?'"()[\]{}#/@&%+\-=<>|_*]/gu);
  const length = Math.max(cleanedText.length, 1);

  return (printableCount / length) - (replacementCount * 0.25) - (controlCount * 0.1);
};

const decodeTextBuffer = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return cleanExtractedText(new TextDecoder('utf-8').decode(bytes.slice(3)));
  }
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    return cleanExtractedText(new TextDecoder('utf-16le').decode(bytes.slice(2)));
  }
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    return cleanExtractedText(new TextDecoder('utf-16be').decode(bytes.slice(2)));
  }

  const candidates = ['utf-8', 'utf-16le', 'utf-16be', 'windows-1252']
    .map((encoding) => {
      try {
        const text = new TextDecoder(encoding).decode(buffer);
        return { text: cleanExtractedText(text), score: getTextQualityScore(text) };
      } catch {
        return null;
      }
    })
    .filter((item): item is { text: string; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0]?.text || '';
  const replacementRatio = best.length ? countMatches(best, /\uFFFD/g) / best.length : 1;

  if (!best.trim() || replacementRatio > 0.03) {
    throw new Error('This file encoding is not readable. Export it as UTF-8 text and upload again.');
  }

  return best;
};

const extractHtmlText = (text: string) => {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  return cleanExtractedText(doc.body.textContent || text);
};

const extractRtfText = (text: string) =>
  cleanExtractedText(
    text
      .replace(/\\par[d]?/g, '\n')
      .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
      .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
      .replace(/[{}]/g, '')
  );

const extractDocxText = async (buffer: ArrayBuffer) => {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('text');
  if (!documentXml) {
    throw new Error('Could not find document text in this DOCX file.');
  }

  const doc = new DOMParser().parseFromString(documentXml, 'application/xml');
  const paragraphs = Array.from(doc.getElementsByTagName('w:p'))
    .map((paragraph) => Array.from(paragraph.getElementsByTagName('w:t'))
      .map((node) => node.textContent || '')
      .join('')
      .trim()
    )
    .filter(Boolean);

  const text = cleanExtractedText(paragraphs.join('\n\n'));
  if (!text) {
    throw new Error('This DOCX does not contain readable text.');
  }

  return text;
};

export const extractKnowledgeFile = async (file: File): Promise<ExtractedKnowledgeFile> => {
  const extension = getFileExtension(file);
  const buffer = await file.arrayBuffer();

  if (extension === 'docx' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return { text: await extractDocxText(buffer), format: 'DOCX' };
  }

  if (extension === 'pdf' || file.type === 'application/pdf') {
    throw new Error('PDF text extraction is not supported in this lightweight version. Export the PDF as TXT or DOCX first.');
  }

  const decodedText = decodeTextBuffer(buffer);

  if (extension === 'html' || extension === 'htm' || file.type === 'text/html') {
    return { text: extractHtmlText(decodedText), format: 'HTML' };
  }

  if (extension === 'rtf' || file.type === 'application/rtf' || decodedText.startsWith('{\\rtf')) {
    return { text: extractRtfText(decodedText), format: 'RTF' };
  }

  return { text: decodedText, format: extension ? extension.toUpperCase() : 'Text' };
};
