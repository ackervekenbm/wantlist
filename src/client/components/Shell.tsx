import type { ReactNode } from 'react'
import type { Route } from '../lib/route'

interface ShellProps {
  route: Route
  left: ReactNode
  /** The open idea or the lists screen; home passes null. */
  right?: ReactNode
  banner?: ReactNode
  toast?: ReactNode
}

/**
 * Two panes, always both in the DOM. Which one shows is CSS only: below
 * 900 px the route picks one, from 900 px both sit side by side. On a PC
 * home the right pane is empty and the left pane shows alone, centred.
 */
export function Shell({ route, left, right, banner, toast }: ShellProps) {
  return (
    <div className="shell" data-route={route.name}>
      {banner}
      <div className="pane pane-left">{left}</div>
      <div className="pane pane-right">{right}</div>
      {toast}
    </div>
  )
}
