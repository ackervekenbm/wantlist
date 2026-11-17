import { goHome } from '../lib/route'
import { BackIcon } from './icons'

/** The way home, on a phone and a PC. */
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
