import type { Idea, ServerStatus } from '../types'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `request failed (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function listIdeas(): Promise<Idea[]> {
  return req('/api/ideas')
}

export function addIdea(text: string): Promise<Idea> {
  return req('/api/ideas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

export function deleteIdea(id: number): Promise<void> {
  return req(`/api/ideas/${id}`, { method: 'DELETE' })
}

export function rerunIdea(id: number): Promise<Idea> {
  return req(`/api/ideas/${id}/rerun`, { method: 'POST' })
}

export function getStatus(): Promise<ServerStatus> {
  return req('/api/status')
}
