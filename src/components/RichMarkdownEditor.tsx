import { useEffect, useRef } from 'react';
import { Bold, Code2, Heading1, Heading2, Italic, Link, List, ListOrdered, Quote, Underline } from 'lucide-react';

import { Button } from '@/components/ui/button';

type FormatCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'h1'
  | 'h2'
  | 'bullet'
  | 'numbered'
  | 'quote'
  | 'code'
  | 'link';

const FORMAT_BUTTONS: Array<{
  command: FormatCommand;
  title: string;
  icon: typeof Bold;
}> = [
  { command: 'h1', title: 'Heading 1', icon: Heading1 },
  { command: 'h2', title: 'Heading 2', icon: Heading2 },
  { command: 'bold', title: 'Bold', icon: Bold },
  { command: 'italic', title: 'Italic', icon: Italic },
  { command: 'underline', title: 'Underline', icon: Underline },
  { command: 'link', title: 'Link', icon: Link },
  { command: 'bullet', title: 'Bullet list', icon: List },
  { command: 'numbered', title: 'Numbered list', icon: ListOrdered },
  { command: 'quote', title: 'Quote', icon: Quote },
  { command: 'code', title: 'Code', icon: Code2 },
];

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const sanitizeHref = (href: string) => {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return `mailto:${trimmed}`;
  return `https://${trimmed.replace(/^\/+/, '')}`;
};

const renderInlineMarkdown = (value: string) => {
  let html = escapeHtml(value);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label, href) =>
    `<a href="${escapeHtml(sanitizeHref(href))}" target="_blank" rel="noreferrer">${label}</a>`
  );
  html = html.replace(/\+\+([^+\n][\s\S]*?[^+\n])\+\+/g, '<u>$1</u>');
  html = html.replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return html;
};

export const markdownToEditorHtml = (markdown: string) => {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    if (line.startsWith('# ')) {
      html.push(`<h1>${renderInlineMarkdown(line.slice(2).trim())}</h1>`);
      continue;
    }

    if (line.startsWith('## ')) {
      html.push(`<h2>${renderInlineMarkdown(line.slice(3).trim())}</h2>`);
      continue;
    }

    if (line.startsWith('> ')) {
      html.push(`<blockquote>${renderInlineMarkdown(line.slice(2).trim())}</blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^[-*]\s+/, '').trim())}</li>`);
        index += 1;
      }
      index -= 1;
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\d+\.\s+/, '').trim())}</li>`);
        index += 1;
      }
      index -= 1;
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  return html.join('') || '<p><br></p>';
};

const inlineNodeToMarkdown = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map(inlineNodeToMarkdown).join('');

  if (tag === 'strong' || tag === 'b') return `**${children}**`;
  if (tag === 'em' || tag === 'i') return `*${children}*`;
  if (tag === 'u') return `++${children}++`;
  if (tag === 'code') return `\`${children}\``;
  if (tag === 'a') return `[${children}](${element.getAttribute('href') || ''})`;
  if (tag === 'br') return '\n';

  return children;
};

const blockNodeToMarkdown = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const text = Array.from(element.childNodes).map(inlineNodeToMarkdown).join('').trim();

  if (tag === 'h1') return `# ${text}\n\n`;
  if (tag === 'h2') return `## ${text}\n\n`;
  if (tag === 'h3') return `### ${text}\n\n`;
  if (tag === 'blockquote') {
    return `${text.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
  }
  if (tag === 'ul') {
    return `${Array.from(element.children).map((item) => `- ${inlineNodeToMarkdown(item).trim()}`).join('\n')}\n\n`;
  }
  if (tag === 'ol') {
    return `${Array.from(element.children).map((item, index) => `${index + 1}. ${inlineNodeToMarkdown(item).trim()}`).join('\n')}\n\n`;
  }
  if (tag === 'pre') return `\`\`\`\n${element.textContent || ''}\n\`\`\`\n\n`;
  if (tag === 'p' || tag === 'div') return text ? `${text}\n\n` : '';

  return text ? `${text}\n\n` : '';
};

export const editorHtmlToMarkdown = (html: string) => {
  const container = document.createElement('div');
  container.innerHTML = html;
  return Array.from(container.childNodes)
    .map(blockNodeToMarkdown)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const insertInlineCode = () => {
  const selection = window.getSelection();
  const selectedText = selection?.toString() || 'code';
  document.execCommand('insertHTML', false, `<code>${escapeHtml(selectedText)}</code>`);
};

type RichMarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

export default function RichMarkdownEditor({ value, onChange }: RichMarkdownEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastAppliedMarkdownRef = useRef('');

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || lastAppliedMarkdownRef.current === value) return;
    editor.innerHTML = markdownToEditorHtml(value);
    lastAppliedMarkdownRef.current = value;
  }, [value]);

  const syncMarkdown = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const markdown = editorHtmlToMarkdown(editor.innerHTML);
    lastAppliedMarkdownRef.current = markdown;
    onChange(markdown);
  };

  const applyFormat = (command: FormatCommand) => {
    editorRef.current?.focus();

    if (command === 'h1') document.execCommand('formatBlock', false, 'h1');
    if (command === 'h2') document.execCommand('formatBlock', false, 'h2');
    if (command === 'bold') document.execCommand('bold');
    if (command === 'italic') document.execCommand('italic');
    if (command === 'underline') document.execCommand('underline');
    if (command === 'bullet') document.execCommand('insertUnorderedList');
    if (command === 'numbered') document.execCommand('insertOrderedList');
    if (command === 'quote') document.execCommand('formatBlock', false, 'blockquote');
    if (command === 'code') insertInlineCode();
    if (command === 'link') {
      const url = window.prompt('URL');
      if (!url?.trim()) return;
      document.execCommand('createLink', false, sanitizeHref(url));
    }

    syncMarkdown();
  };

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap gap-2 border-b border-[var(--lux-border)] pb-3">
        {FORMAT_BUTTONS.map(({ command, title, icon: FormatIcon }) => (
          <Button
            key={command}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyFormat(command)}
            className="glass-btn h-9 px-3"
            title={title}
            aria-label={title}
          >
            <FormatIcon className="h-4 w-4 stroke-[1.75]" />
          </Button>
        ))}
      </div>

      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={syncMarkdown}
        onBlur={syncMarkdown}
        className="rich-card-editor glass-input mt-4 overflow-y-auto rounded-xl p-4 text-base leading-7"
      />
    </div>
  );
}
