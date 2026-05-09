import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const remarkUnderline = () => (tree: any) => {
  const visit = (node: any) => {
    if (!node?.children) return;

    node.children = node.children.flatMap((child: any) => {
      if (child.type !== 'text' || !child.value.includes('++')) {
        visit(child);
        return child;
      }

      const parts: any[] = [];
      const pattern = /\+\+([^+\n][\s\S]*?[^+\n])\+\+/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(child.value))) {
        if (match.index > lastIndex) {
          parts.push({ type: 'text', value: child.value.slice(lastIndex, match.index) });
        }
        parts.push({
          type: 'underline',
          data: { hName: 'u' },
          children: [{ type: 'text', value: match[1] }],
        });
        lastIndex = pattern.lastIndex;
      }

      if (lastIndex < child.value.length) {
        parts.push({ type: 'text', value: child.value.slice(lastIndex) });
      }

      return parts.length > 0 ? parts : child;
    });

    node.children.forEach(visit);
  };

  visit(tree);
};

export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkUnderline]}
      components={{
        h1: ({ children }) => <h1 className="mb-3 text-2xl font-black uppercase leading-tight text-black">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-3 text-xl font-black leading-tight text-black">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 text-lg font-black leading-tight text-black">{children}</h3>,
        p: ({ children }) => <p className="mb-3 last:mb-0 leading-7">{children}</p>,
        ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="leading-7">{children}</li>,
        strong: ({ children }) => <strong className="font-black">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        u: ({ children }) => <u className="decoration-2 underline-offset-4">{children}</u>,
        table: ({ children }) => <div className="mb-3 overflow-x-auto"><table className="w-full border-collapse text-sm">{children}</table></div>,
        th: ({ children }) => <th className="border-2 border-black bg-black/10 px-2 py-1 text-left font-black">{children}</th>,
        td: ({ children }) => <td className="border-2 border-black px-2 py-1 align-top">{children}</td>,
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
