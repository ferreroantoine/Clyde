import { useEffect, useRef } from 'react'
import { terminals } from '@/lib/terminal/registry'

/** Hosts an existing xterm instance; resizing the container refits the terminal. */
export function TerminalView({ id, focused }: { id: string; focused: boolean }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = container.current
    if (!el) return
    terminals.attach(id, el)
    const observer = new ResizeObserver(() => terminals.fit(id))
    observer.observe(el)
    return () => {
      observer.disconnect()
      terminals.detach(id)
    }
  }, [id])

  useEffect(() => {
    if (focused) terminals.focus(id)
  }, [focused, id])

  return <div ref={container} className="h-full w-full px-3 pt-1.5" />
}
