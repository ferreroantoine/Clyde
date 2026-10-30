import { memo, useEffect, useMemo, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Check, Copy } from 'lucide-react'
import { t } from '@shared/i18n'
import { monaco } from '@/lib/monaco/setup'
import { useResolvedTheme } from '@/lib/theme'
import { ImageViewer } from '@/components/ImageViewer'
import { cn } from '@/lib/utils'

/** Fence names models use, mapped to Monaco's language ids. */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps: 'powershell',
  ps1: 'powershell',
  yml: 'yaml',
  md: 'markdown',
  rs: 'rust',
  cs: 'csharp',
  'c++': 'cpp',
  kt: 'kotlin',
  rb: 'ruby'
}

function languageId(lang: string): string | null {
  const id = ALIASES[lang.toLowerCase()] ?? lang.toLowerCase()
  return monaco.languages.getLanguages().some((l) => l.id === id) ? id : null
}

/** Copies text and shows a check for a moment. */
export function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])
  return (
    <button
      type="button"
      aria-label={label ?? t('Copy')}
      title={label ?? t('Copy')}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
      className={cn('press inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground', className)}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {copied ? t('Copied') : null}
    </button>
  )
}

/** A fenced code block, colored by Monaco's tokenizer (the editor's own colors), with a copy button. */
function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const theme = useResolvedTheme((s) => s.theme)
  const [html, setHtml] = useState<string | null>(null)
  const id = lang ? languageId(lang) : null
  useEffect(() => {
    if (!id) return
    let alive = true
    // Monaco injects its token colors with the theme; set it so colorize() output is styled
    // even before an editor exists.
    monaco.editor.setTheme(theme === 'dark' ? 'clyde-dark' : 'clyde-light')
    void monaco.editor.colorize(code, id, { tabSize: 2 }).then((out) => alive && setHtml(out))
    return () => {
      alive = false
    }
  }, [code, id, theme])
  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">{lang || t('text')}</span>
        <CopyButton text={code} label={t('Copy the code')} />
      </div>
      {html && id ? (
        // Monaco's colorizer escapes the code and only adds its own spans.
        <pre className="monaco-colorized overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">{code}</pre>
      )}
    </div>
  )
}

const baseComponents: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const match = /language-([\w+#-]+)/.exec(className ?? '')
    const text = String(children ?? '')
    // Inline code has no language and no newline.
    if (!match && !text.includes('\n')) return <code className="rounded bg-muted px-1 py-px font-mono text-[0.9em]">{children}</code>
    return <CodeBlock code={text.replace(/\n$/, '')} lang={match?.[1] ?? ''} />
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th style={style} className="border-b bg-muted/50 px-3 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b px-3 py-1.5 align-top">
      {children}
    </td>
  ),
  img: ({ alt }) => <span className="text-muted-foreground">[{alt || t('image')}]</span>
}

/** For a Markdown file shown in the editor: its images and links point at other files. */
export interface MarkdownFileOptions {
  /** The URL to load an image from, or null to show its alt text. */
  imageUrl: (src: string) => string | null
  /** Handles a click on a link; false lets it open in the browser. */
  openLink: (href: string) => boolean
}

function fileComponents(options: MarkdownFileOptions, zoom: (src: string, alt: string) => void): Components {
  return {
    ...baseComponents,
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (href && options.openLink(href)) e.preventDefault()
        }}
        className="text-primary underline underline-offset-2 hover:no-underline"
      >
        {children}
      </a>
    ),
    img: ({ src, alt }) => {
      const url = typeof src === 'string' ? options.imageUrl(src) : null
      if (!url) return <span className="text-muted-foreground">[{alt || t('image')}]</span>
      return (
        <img
          src={url}
          alt={alt ?? ''}
          loading="lazy"
          className="inline-block max-w-full cursor-zoom-in rounded"
          onClick={() => zoom(url, alt ?? '')}
        />
      )
    }
  }
}

/**
 * Markdown as claude.ai shows it: GitHub tables and task lists, math with KaTeX, code with
 * syntax colors. Raw HTML in the text is not rendered.
 */
export const Markdown = memo(function Markdown({
  text,
  streaming = false,
  file,
  className
}: {
  text: string
  streaming?: boolean
  file?: MarkdownFileOptions
  className?: string
}) {
  const [zoomed, setZoomed] = useState<{ src: string; alt: string } | null>(null)
  const components = useMemo(() => (file ? fileComponents(file, (src, alt) => setZoomed({ src, alt })) : baseComponents), [file])
  return (
    <div className={cn('chat-prose', streaming && 'chat-streaming', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]} rehypePlugins={[rehypeKatex]} components={components}>
        {text}
      </ReactMarkdown>
      {file && <ImageViewer src={zoomed?.src ?? null} alt={zoomed?.alt ?? ''} onClose={() => setZoomed(null)} />}
    </div>
  )
})
