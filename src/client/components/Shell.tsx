import type { ReactNode } from 'react'
import type { Route } from '../lib/route'
import { LogoMark } from './icons'

interface ShellProps {
  route: Route
  left: ReactNode
  /** The open idea or the lists screen; home shows the empty state instead. */
  right?: ReactNode
  banner?: ReactNode
  toast?: ReactNode
}

/**
 * Two panes, always both in the DOM. Which one shows is CSS only: below
 * 900 px the route picks one, from 900 px both sit side by side.
 */
export function Shell({ route, left, right, banner, toast }: ShellProps) {
  return (
    <div className="shell" data-route={route.name}>
      {banner}
      <div className="pane pane-left">{left}</div>
      <div className="pane pane-right">
        {route.name === 'home' ? (
          <div className="pane-empty">
            <LogoMark size={56} />
            <p>Pick an idea on the left, or add one</p>
          </div>
        ) : (
          right
        )}
      </div>
      {toast}
    </div>
  )
}
