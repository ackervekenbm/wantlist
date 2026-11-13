import { useId, type ReactNode, type Ref } from 'react'

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

/** A titled section: small caps heading, an optional count, a rule, then its content. */
export function Section({
  title,
  count,
  className = 'sec',
  ref,
  children,
}: {
  title: string
  count?: number
  /** `sec` on home, `panel` on the idea screen. */
  className?: string
  ref?: Ref<HTMLElement>
  children: ReactNode
}) {
  const id = useId()
  return (
    <section className={className} aria-labelledby={id} ref={ref}>
      <h2 className="sec-h" id={id}>
        {title}
        {count !== undefined && (
          <>
            {' '}
            <span className="n">{count}</span>
          </>
        )}
        <span className="rule" />
      </h2>
      {children}
    </section>
  )
}
