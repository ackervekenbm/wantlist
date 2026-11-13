// The colour theme: follow the system, or force light or dark. Stored per
// device; localStorage can be missing or throw, and then the choice is simply
// not remembered.

export type Theme = 'system' | 'light' | 'dark'

const THEME_KEY = 'wantlist.theme'

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

export function writeTheme(t: Theme): void {
  try {
    if (t === 'system') localStorage.removeItem(THEME_KEY)
    else localStorage.setItem(THEME_KEY, t)
  } catch {
    /* storage unavailable */
  }
}

/** The browser bar colour per theme: --bg, as in index.html's theme-color metas. */
const BAR = { light: '#ECE6DB', dark: '#12100D' }

/** Sets `data-theme` on <html>, which the CSS tokens follow, and the browser bar colour with it. */
export function applyTheme(t: Theme): void {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  // Each meta keeps its own scheme under system, and both take the forced theme otherwise.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = BAR[t === 'system' ? (meta.getAttribute('media')?.includes('dark') ? 'dark' : 'light') : t]
  }
}

export function nextTheme(t: Theme): Theme {
  return t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'
}
