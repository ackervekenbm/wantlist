import type { UrlStatus } from '../../types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const TIMEOUT_MS = 12_000

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function checkUrl(url: string): Promise<UrlStatus> {
  try {
    const head = await fetchWithTimeout(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
    })
    const status = rewardStatus(head.status)
    if (status === 'live') return 'live'
    // HEAD sometimes returns 405 even when the page exists - fall back to GET.
    const get = await fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA, Range: 'bytes=0-0' },
    })
    return rewardStatus(get.status)
  } catch {
    return 'unknown'
  }
}

function rewardStatus(status: number): UrlStatus {
  if (status >= 200 && status < 400) return 'live'
  if (status >= 400 && status < 500) return 'dead'
  return 'unknown'
}

export async function fetchPageText(url: string): Promise<{ title: string; text: string }> {
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
  })
  if (!res.ok) throw new Error(`page ${res.status}`)
  const html = await res.text()
  return { title: extractTitle(html), text: extractText(html) }
}

export function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!m) return ''
  return decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200)
}

export function extractText(html: string): string {
  let s = html
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = decodeEntities(s)
  s = s.replace(/\s+/g, ' ').trim()
  return s.slice(0, 12_000)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
}