import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0 leading-7">{children}</p>,
        ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="leading-7">{children}</li>,
        strong: ({ children }) => <strong className="font-black">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-bold underline decoration-2 underline-offset-4"
          >
            {children}
          </a>
        ),
        code: ({ children, className }) => (
          <code className={`rounded bg-black/10 px-1 py-0.5 font-mono text-[0.95em] ${className || ''}`}>
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="mb-3 overflow-x-auto rounded-lg bg-black/10 p-3 font-mono text-sm last:mb-0">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-3 border-l-4 border-black/50 pl-4 italic last:mb-0">
            {children}
          </blockquote>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
