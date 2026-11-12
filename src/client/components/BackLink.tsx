import { BackIcon } from './icons'

/** The phone's way home; the PC keeps home in the left pane. */
export function BackLink() {
  return (
    <a className="back" href="#/">
      <BackIcon width={18} height={18} /> Home
    </a>
  )
}
