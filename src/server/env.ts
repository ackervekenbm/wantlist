import fs from 'node:fs'
import path from 'node:path'

export function loadEnv(): void {
  const root = process.env.WANTLIST_ROOT ?? process.cwd()
  const file = path.join(root, '.env')
  if (!fs.existsSync(file)) return

  const lines = fs.readFileSync(file, 'utf8').split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
    if (process.env[key] === undefined && value !== '') {
      process.env[key] = value
    }
  }
}

export function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isNaN(n) ? fallback : n
}