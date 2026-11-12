import type { ReactNode } from 'react'
import type { ServerStatus } from '../../types'
import { clockTime } from '../lib/format'
import { nextTheme, type Theme } from '../lib/theme'
import { quotaResetAt } from '../lib/triage'
import { LogoMark, MoonIcon, SunIcon, SystemThemeIcon } from './icons'

interface TopBarProps {
  status: ServerStatus | null
  /** Title of the idea being researched, when there is one. */
  currentTitle?: string | null
  theme: Theme
  onTheme: (t: Theme) => void
}

const THEME_ICON = { system: SystemThemeIcon, light: SunIcon, dark: MoonIcon }

export function TopBar({ status, currentTitle, theme, onTheme }: TopBarProps) {
  const Icon = THEME_ICON[theme]
  const next = nextTheme(theme)
  return (
    <header className="top">
      <div className="mark">
        <LogoMark />
        <span>wantlist</span>
      </div>
      <ResearcherChip status={status} currentTitle={currentTitle} />
      <button
        type="button"
        className="iconbtn"
        aria-label={`Theme: ${theme}. Switch to ${next}`}
        title={`Theme: ${theme}`}
        onClick={() => onTheme(next)}
      >
        <Icon width={18} height={18} />
      </button>
    </header>
  )
}

function ResearcherChip({ status, currentTitle }: { status: ServerStatus | null; currentTitle?: string | null }) {
  if (!status) return <div className="chip chip-blank" aria-hidden="true" />
  const chip = (dot: string, body: ReactNode, title?: string) => (
    <div className="chip" role="status" aria-label="Researcher" title={title}>
      <span className={`dot ${dot}`} aria-hidden="true" />
      <span>{body}</span>
    </div>
  )

  if (!status.researchEnabled) {
    return chip(
      'off',
      <>
        <b>Research off</b> · API keys missing
      </>,
    )
  }
  const queued = status.queuedCount > 0 ? ` · ${status.queuedCount} queued` : ''
  if (status.running) {
    return chip(
      'live',
      <>
        <b>Researching</b> {currentTitle ?? 'an idea'}
        {queued}
      </>,
    )
  }
  const reset = quotaResetAt(status)
  if (reset) {
    return chip(
      'warn',
      <>
        <b>Out of quota</b> until {clockTime(reset)}
      </>,
      status.models.map((m) => `${m.id}: ${m.reason}`).join('\n'),
    )
  }
  if (status.queuedCount > 0) return chip('', <b>{status.queuedCount} queued</b>)
  return chip('', 'Researcher idle')
}
