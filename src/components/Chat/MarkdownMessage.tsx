import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import rehypeSanitize from 'rehype-sanitize'
import type { Components } from 'react-markdown'
import { LinkPreview } from './LinkPreview'

const URL_RE = /https?:\/\/[^\s<>")\]]+/g

function extractFirstUrl(text: string): string | null {
  return text.match(URL_RE)?.[0] ?? null
}

function buildComponents(isOwn: boolean): Components {
  const linkClass = isOwn
    ? 'underline text-purple-200 hover:text-white'
    : 'underline text-purple-400 hover:text-purple-300'
  const codeBlockClass = isOwn
    ? 'bg-purple-900/50 text-purple-100'
    : 'bg-gray-900/70 text-gray-100'
  const inlineCodeClass = isOwn
    ? 'bg-purple-900/50 text-purple-100 rounded px-1 py-0.5 text-xs font-mono'
    : 'bg-gray-900/60 text-gray-200 rounded px-1 py-0.5 text-xs font-mono'
  const quoteClass = isOwn
    ? 'border-l-2 border-purple-300/60 pl-2.5 text-purple-200/80 italic'
    : 'border-l-2 border-gray-500 pl-2.5 text-gray-400 italic'

  return {
    p: ({ children }) => (
      <p className="text-sm leading-relaxed break-words">{children}</p>
    ),
    strong: ({ children }) => (
      <strong className="font-bold">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="italic">{children}</em>
    ),
    del: ({ children }) => (
      <del className="line-through opacity-70">{children}</del>
    ),
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {children}
      </a>
    ),
    code: ({ className, children }) => {
      if (className?.startsWith('language-')) {
        return (
          <pre className={`rounded-lg p-3 overflow-x-auto text-xs font-mono my-1 ${codeBlockClass}`}>
            <code>{children}</code>
          </pre>
        )
      }
      return <code className={inlineCodeClass}>{children}</code>
    },
    blockquote: ({ children }) => (
      <blockquote className={`my-0.5 ${quoteClass}`}>{children}</blockquote>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-inside space-y-0.5 text-sm">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-inside space-y-0.5 text-sm">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    h1: ({ children }) => <p className="text-base font-bold">{children}</p>,
    h2: ({ children }) => <p className="text-base font-semibold">{children}</p>,
    h3: ({ children }) => <p className="text-sm font-semibold">{children}</p>,
    hr: () => <hr className="border-current opacity-20 my-1" />,
  }
}

// Built once at module load — isOwn only has two states
const COMPONENTS_OWN   = buildComponents(true)
const COMPONENTS_OTHER = buildComponents(false)

interface MarkdownMessageProps {
  content: string
  isOwn: boolean
}

export function MarkdownMessage({ content, isOwn }: MarkdownMessageProps) {
  if (!content) return null
  const firstUrl = extractFirstUrl(content)

  return (
    <div className="space-y-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeSanitize]}
        components={isOwn ? COMPONENTS_OWN : COMPONENTS_OTHER}
      >
        {content}
      </ReactMarkdown>
      {firstUrl && <LinkPreview url={firstUrl} isOwn={isOwn} />}
    </div>
  )
}
