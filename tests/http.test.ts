import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractText, fetchPage } from '../src/server/research/http'

const URL_ = 'https://shop.be/nl/p/fan/123'

function respond(body: string, init: ResponseInit & { url?: string; redirected?: boolean } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const res = new Response(body, {
        status: init.status ?? 200,
        headers: init.headers ?? { 'content-type': 'text/html; charset=utf-8' },
      })
      Object.defineProperty(res, 'url', { value: init.url ?? URL_ })
      Object.defineProperty(res, 'redirected', { value: init.redirected ?? false })
      return res
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchPage', () => {
  it('returns text, title and product data for a live product page', async () => {
    respond(
      `<html><head><title>Fan | Shop</title>
       <script type="application/ld+json">{"@type":"Product","name":"Fan","offers":{"price":"59","priceCurrency":"EUR","availability":"InStock"}}</script>
       </head><body><nav>Menu Home Sale</nav><main>${'Quiet 40 dB desk fan. '.repeat(30)}</main><footer>© shop</footer></body></html>`,
    )
    const page = await fetchPage(URL_)
    expect(page.status).toBe('live')
    expect(page.title).toBe('Fan | Shop')
    expect(page.text).toContain('Quiet 40 dB desk fan.')
    expect(page.text).not.toContain('Menu Home Sale')
    expect(page.product).toMatchObject({ price: 59, availability: 'in_stock' })
  })

  it('calls 404 and 410 dead', async () => {
    respond('gone', { status: 404 })
    expect((await fetchPage(URL_)).status).toBe('dead')
    respond('gone', { status: 410 })
    expect((await fetchPage(URL_)).status).toBe('dead')
  })

  it('does not call bot walls or server errors dead', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      respond('nope', { status })
      expect((await fetchPage(URL_)).status).toBe('unknown')
    }
  })

  it('treats network failures as unknown and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))))
    await expect(fetchPage(URL_)).resolves.toMatchObject({ status: 'unknown', text: '' })
  })

  it('calls a product page that bounced to the home page dead', async () => {
    respond('<title>Welcome</title>', { redirected: true, url: 'https://shop.be/' })
    expect((await fetchPage(URL_)).status).toBe('dead')
  })

  it('keeps a redirect to another product page live', async () => {
    respond('<title>Fan v2</title>', { redirected: true, url: 'https://shop.be/nl/p/fan-v2/124' })
    expect((await fetchPage(URL_)).status).toBe('live')
  })

  it('calls a soft-404 page dead', async () => {
    respond('<title>Pagina niet gevonden - Shop</title>')
    expect((await fetchPage(URL_)).status).toBe('dead')
  })

  it('calls a non-HTML answer live without reading it', async () => {
    respond('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } })
    expect(await fetchPage(URL_)).toMatchObject({ status: 'live', text: '', product: null })
  })

  it('stops reading huge pages', async () => {
    respond(`<title>Big</title><p>${'x'.repeat(3_000_000)}</p>`)
    const page = await fetchPage(URL_)
    expect(page.status).toBe('live')
    expect(page.text.length).toBeLessThanOrEqual(12_000)
  })
})

describe('extractText', () => {
  it('drops comments before tags, so a ">" inside a comment leaks nothing', () => {
    expect(extractText('<p>a</p><!-- if x > 1 show <b>secret</b> -->b')).toBe('a b')
  })

  it('ignores a <main> too small to be the content', () => {
    expect(extractText('<main>Hi</main><div>Real content</div>')).toBe('Hi Real content')
  })
})
