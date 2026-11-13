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

  it('points the browser bar colour at the forced theme, and back at each scheme under system', () => {
    document.head.innerHTML =
      '<meta name="theme-color" content="#ECE6DB" media="(prefers-color-scheme: light)">' +
      '<meta name="theme-color" content="#12100D" media="(prefers-color-scheme: dark)">'
    const bar = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content)
    applyTheme('dark')
    expect(bar()).toEqual(['#12100D', '#12100D'])
    applyTheme('light')
    expect(bar()).toEqual(['#ECE6DB', '#ECE6DB'])
    applyTheme('system')
    expect(bar()).toEqual(['#ECE6DB', '#12100D'])
    document.head.innerHTML = ''
  })
})
