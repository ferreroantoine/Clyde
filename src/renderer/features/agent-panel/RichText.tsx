import { Fragment, type ReactNode } from 'react'

/** Inline `code` and **bold**. Everything else stays plain text; nothing is parsed as HTML. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g
  let last = 0
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0
    if (index > last) out.push(text.slice(last, index))
    const token = match[0]
    out.push(
      token.startsWith('`') ? (
        <code key={`${keyBase}-${index}`} className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">
          {token.slice(1, -1)}
        </code>
      ) : (
        <strong key={`${keyBase}-${index}`} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      )
    )
    last = index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Agent text with fenced code blocks. A fence still being streamed renders as code too. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/^```/m)
  return (
    <div className="space-y-2 text-[13px] leading-relaxed break-words">
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const newline = part.indexOf('\n')
          const lang = newline > 0 ? part.slice(0, newline).trim() : ''
          const code = newline >= 0 ? part.slice(newline + 1) : part
          return (
            <pre
              key={i}
              data-lang={lang || undefined}
              className="overflow-x-auto rounded-md border bg-muted/60 px-3 py-2 font-mono text-xs leading-snug"
            >
              {code.replace(/\n$/, '')}
            </pre>
          )
        }
        const trimmed = part.replace(/^\n+|\n+$/g, '')
        if (!trimmed) return null
        return (
          <p key={i} className="whitespace-pre-wrap">
            {trimmed.split('\n').map((line, j, lines) => (
              <Fragment key={j}>
                {inline(line, `${i}-${j}`)}
                {j < lines.length - 1 && '\n'}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
