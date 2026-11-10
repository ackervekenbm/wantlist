// Per-device view preferences. localStorage can be missing or throw (private
// mode, blocked storage); the app then just forgets them.

const COLLAPSED_KEY = 'wantlist.collapsed'

export function readCollapsed(): Set<number> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [])
  } catch {
    return new Set()
  }
}

export function writeCollapsed(id: number, collapsed: boolean): void {
  try {
    const set = readCollapsed()
    if (collapsed) set.add(id)
    else set.delete(id)
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set]))
  } catch {
    /* storage unavailable */
  }
}
