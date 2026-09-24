import { useState, type FormEvent } from 'react'

interface Props {
  onAdd: (text: string) => Promise<void>
}

export function CaptureBox({ onAdd }: Props) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(value)
      setText('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="capture" onSubmit={submit}>
      {error && <p className="capture-error">{error}</p>}
      <textarea
        className="capture-input"
        rows={2}
        maxLength={500}
        value={text}
        placeholder="e.g. A good fan to add to my indoor biking setup"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            void submit(e)
          }
        }}
      />
      <div className="capture-bar">
        <span className="capture-hint">Enter to add · research happens in the background</span>
        <button className="btn-primary" type="submit" disabled={!text.trim() || busy}>
          <span className="btn-plus">{busy ? '···' : '+'}</span>
          Add to wantlist
        </button>
      </div>
    </form>
  )
}