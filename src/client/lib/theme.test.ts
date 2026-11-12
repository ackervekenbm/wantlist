import { describe, expect, it, vi } from 'vitest'
import { applyTheme, nextTheme, readTheme, writeTheme } from './theme'

describe('theme', () => {
  it('toggles system → light → dark → system, writing and applying each', () => {
    expect(readTheme()).toBe('system')
    const seen: Array<string | undefined> = []
    let t = readTheme()
    for (let i = 0; i < 3; i++) {
      t = nextTheme(t)
      writeTheme(t)
      applyTheme(readTheme())
      seen.push(document.documentElement.dataset.theme)
    }
    expect(seen).toEqual(['light', 'dark', undefined])
    expect(readTheme()).toBe('system')
  })

  it('still works when localStorage throws', () => {
    const boom = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom })
    expect(readTheme()).toBe('system')
    expect(() => writeTheme('dark')).not.toThrow()
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})
