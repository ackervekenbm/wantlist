/**
 * Parses model output that should be JSON but may arrive wrapped in a code
 * fence or prose (weaker fallback models do this). Throws when nothing in it
 * parses.
 */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
    if (fence?.[1]) {
      try {
        return JSON.parse(fence[1])
      } catch {
        /* fall through */
      }
    }
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1))
    }
    throw new SyntaxError('no JSON object in the answer')
  }
}
