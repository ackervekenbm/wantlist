import type { Idea, WorkerRuntime } from '../types'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${res.status} ${body}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function listIdeas(): Promise<Idea[]> {
  return req('/api/ideas')
}

export function getIdea(id: number): Promise<Idea> {
  return req(`/api/ideas/${id}`)
}

export function addIdea(text: string): Promise<{ id: string; text: string; status: string }> {
  return req('/api/ideas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

export function deleteIdea(id: number): Promise<void> {
  return req(`/api/ideas/${id}`, { method: 'DELETE' })
}

export function rerunIdea(id: number): Promise<{ ok: boolean }> {
  return req(`/api/ideas/${id}/rerun`, { method: 'POST' })
}

export function getStatus(): Promise<WorkerRuntime> {
  return req('/api/status')
}