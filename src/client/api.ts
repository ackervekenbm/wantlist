import type { Idea, IdeaPatch, NewIdea, PickPatch, ServerStatus } from '../types'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `request failed (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function listIdeas(): Promise<Idea[]> {
  return req('/api/ideas')
}

export function addIdea(idea: NewIdea): Promise<Idea> {
  return req('/api/ideas', json('POST', idea))
}

export function patchIdea(id: number, patch: IdeaPatch): Promise<Idea> {
  return req(`/api/ideas/${id}`, json('PATCH', patch))
}

/**
 * `keepalive` lets a delete that was waiting out its undo window finish
 * while the tab closes.
 */
export function deleteIdea(id: number, opts: { keepalive?: boolean } = {}): Promise<void> {
  return req(`/api/ideas/${id}`, { method: 'DELETE', keepalive: opts.keepalive })
}

export function rerunIdea(id: number): Promise<Idea> {
  return req(`/api/ideas/${id}/rerun`, { method: 'POST' })
}

export function refineIdea(id: number): Promise<Idea> {
  return req(`/api/ideas/${id}/refine`, { method: 'POST' })
}

export function patchPick(id: number, patch: PickPatch): Promise<Idea> {
  return req(`/api/picks/${id}`, json('PATCH', patch))
}

export function getStatus(): Promise<ServerStatus> {
  return req('/api/status')
}
