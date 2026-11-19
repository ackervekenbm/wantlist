import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { modelHealth, status } from '../test/fakeApi'
import { SettingsScreen } from './SettingsScreen'

const KEYS = [
  { name: 'GEMINI_API_KEY', set: true },
  { name: 'GROQ_API_KEY', set: true },
  { name: 'OPENROUTER_API_KEY', set: false },
  { name: 'SERPER_API_KEY', set: true },
]
const gemini = (model: string, over = {}) => modelHealth({ id: `gemini:${model}`, provider: 'gemini', model, ...over })
const groq = (over = {}) =>
  modelHealth({ id: 'groq:llama', provider: 'groq', model: 'llama', modelSource: 'default', ...over })

describe('SettingsScreen', () => {
  it('groups models under their provider in chain order', () => {
    const models = [gemini('g-1'), gemini('g-2'), gemini('g-3'), groq()]
    render(<SettingsScreen status={status({ models, keys: KEYS })} />)
    const names = screen.getAllByRole('link', { name: /Gemini|Groq|OpenRouter/ }).map((a) => a.textContent)
    expect(names).toEqual(['Gemini', 'Groq', 'OpenRouter'])
    const groupOf = (name: string) => screen.getByRole('link', { name }).closest('.prov') as HTMLElement
    expect(within(groupOf('Groq')).getByText('(default)')).toBeInTheDocument()
    expect(within(groupOf('Gemini')).getByText('g-3')).toBeInTheDocument()
  })

  it('links each provider to its dashboard in a new tab', () => {
    render(<SettingsScreen status={status({ keys: KEYS })} />)
    const gem = screen.getByRole('link', { name: 'Gemini' })
    expect(gem).toHaveAttribute('href', 'https://aistudio.google.com/usage')
    expect(gem).toHaveAttribute('target', '_blank')
    expect(gem.getAttribute('rel')).toContain('noopener')
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href')
    expect(href('Groq')).toBe('https://console.groq.com/settings/limits')
    expect(href('OpenRouter')).toBe('https://openrouter.ai/activity')
    expect(screen.getByRole('link', { name: 'Serper' })).toHaveAttribute('href', 'https://serper.dev/dashboard')
  })

  it('shows a provider without a key', () => {
    render(<SettingsScreen status={status({ models: [gemini('g-1')], keys: KEYS })} />)
    const group = screen.getByRole('link', { name: 'OpenRouter' }).closest('.prov') as HTMLElement
    expect(within(group).getByText('not set')).toBeInTheDocument()
  })

  it('shows state and limits', () => {
    const models = [
      gemini('g-1', { reason: 'quota', benchedUntil: '2026-11-19T10:00:00Z', lastError: 'rate-limited upstream' }),
      gemini('g-2', { reason: 'unavailable', lastError: 'model not found' }),
      groq({
        limits: {
          requests: { limit: 1000, remaining: 980, reset: '2m59.56s' },
          tokens: null,
          seenAt: '2026-11-19T09:00:00Z',
        },
      }),
    ]
    render(<SettingsScreen status={status({ models, keys: KEYS })} />)
    expect(screen.getByText(/out of quota until/)).toBeInTheDocument()
    expect(screen.getByText('rate-limited upstream')).toBeInTheDocument()
    expect(screen.getByText(/model not found/)).toBeInTheDocument()
    expect(screen.getByText(/980 of 1000/)).toBeInTheDocument()
    expect(screen.getByText(/2m59.56s/)).toBeInTheDocument()
    expect(screen.getByText(/^as of /)).toBeInTheDocument()
  })

  it('renders while status is still loading', () => {
    render(<SettingsScreen status={null} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
  })
})
