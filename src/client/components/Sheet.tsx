import { useEffect, useId, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/**
 * A modal native <dialog>: showModal() gives focus containment, Escape and an
 * inert page. A bottom sheet below 900 px, a centred dialog from 900 px.
 * Closing hands focus back to whatever had it when the sheet opened.
 */
export function Sheet({ open, onClose, title, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    const back = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => {
      dialog.close()
      back?.focus()
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      // 'close' arrives a task after close(); by then another sheet may be open, so only Escape on an open sheet counts.
      onClose={() => {
        if (open) onClose()
      }}
      // A click on the dialog box itself, not its content, is a click on the backdrop.
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      {open && (
        <div className="sheet-in">
          <div className="grab" aria-hidden="true" />
          <h2 id={titleId}>{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  )
}
