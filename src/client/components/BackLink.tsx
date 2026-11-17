import { goHome } from '../lib/route'
import { BackIcon } from './icons'

/** The way home on a phone; a PC has the sidebar's logo instead. */
export function BackLink() {
  return (
    <a
      className="back"
      href="#/"
      onClick={(e) => {
        e.preventDefault()
        goHome()
      }}
    >
      <BackIcon width={18} height={18} /> Home
    </a>
  )
}
