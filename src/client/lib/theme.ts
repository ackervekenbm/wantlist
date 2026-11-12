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

/** Sets `data-theme` on <html>; the CSS tokens follow it. */
export function applyTheme(t: Theme): void {
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
}

export function nextTheme(t: Theme): Theme {
  return t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system'
}
