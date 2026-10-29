import { useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { cascade, spring } from '@/lib/motion'

let batchIndex = 0
let batchFrame = 0

/** Position of an element among those mounting in the same frame, for the cascade. */
function nextInBatch(): number {
  if (!batchFrame) {
    batchFrame = requestAnimationFrame(() => {
      batchIndex = 0
      batchFrame = 0
    })
  }
  return batchIndex++
}

/**
 * Fades and slides its content in with a soft spring. Several mounting together (a loaded
 * transcript, a refreshed list) come in as a short cascade; one alone appears at once.
 */
export function Appear({ children, className, ...rest }: { children: ReactNode; className?: string; [data: `data-${string}`]: string | undefined }) {
  const [delay] = useState(() => cascade(nextInBatch()))
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { ...spring.soft, delay } }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  )
}
