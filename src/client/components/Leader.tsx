import type { ReactNode } from 'react'

/** Text, a dotted leader, then a figure: the receipt line the design is built on. */
export function Leader({ children, fig, className }: { children: ReactNode; fig: ReactNode; className?: string }) {
  return (
    <span className={className ? `lead ${className}` : 'lead'}>
      <span className="t">{children}</span>{' '}
      <span className="l" aria-hidden="true" />{' '}
      <span className="f">{fig}</span>
    </span>
  )
}
