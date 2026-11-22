import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractText, fetchPage, listingLinks, referralTargets } from './http'

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

  it('marks a category page and drops the price of its first entry', async () => {
    respond(
      `<html><head><title>Toothbrushes</title>
       <script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"ListItem","item":{"@type":"Product","name":"iO9","offers":{"price":"399","priceCurrency":"EUR"}}}]}</script>
       </head><body>8 van 8 producten</body></html>`,
    )
    const page = await fetchPage(URL_)
    expect(page).toMatchObject({ status: 'live', kind: 'listing', product: null })
  })

  it('marks a page with a price per product and none of its own a listing', async () => {
    const tiles = Array.from({ length: 12 }, (_, i) => `<li>Spiegel ${i} € ${100 + i},00</li>`).join('')
    respond(`<html><head><title>Spiegels</title><meta property="og:image" content="https://shop.be/hero.jpg"></head><body><ul>${tiles}</ul></body></html>`)
    expect(await fetchPage(URL_)).toMatchObject({ status: 'live', kind: 'listing', product: null, links: [] })
  })

  it('keeps a product page with its own price live, however many prices it shows', async () => {
    const related = Array.from({ length: 20 }, (_, i) => `<li>Other € ${100 + i},00</li>`).join('')
    respond(
      `<html><head><title>Spiegel</title>
       <script type="application/ld+json">{"@type":"Product","name":"Spiegel","offers":{"price":"129","priceCurrency":"EUR"}}</script>
       </head><body><ul>${related}</ul></body></html>`,
    )
    const page = await fetchPage(URL_)
    expect(page.kind).toBeUndefined()
    expect(page.product).toMatchObject({ price: 129 })
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

  it('calls a bot check unknown, never a live page', async () => {
    respond("<html><head><title>Human verification</title></head><body><main>Checking if you're human We are running a quick security check to protect this site from bots.</main></body></html>")
    expect(await fetchPage(URL_)).toMatchObject({ status: 'unknown', text: '' })
    respond('<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue</body></html>')
    expect((await fetchPage(URL_)).status).toBe('unknown')
  })

  it('keeps a shop page that merely mentions reCAPTCHA live', async () => {
    respond(`<html><head><title>Fan | Shop</title></head><body><main>${'Quiet 40 dB desk fan. '.repeat(80)}</main><footer>This site is protected by reCAPTCHA</footer></body></html>`)
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

describe('listingLinks', () => {
  const PAGE = 'https://www.shop.be/spiegels'
  it('lists named links on its own site, products first, never menus, listings, other sites or itself', () => {
    const html = [
      '<nav><a href="/spiegels/menu-item-spiegel">Menu spiegel link</a></nav>',
      '<a href="/lampen">Alle lampen &amp; licht</a>',
      '<a href="/spiegels/ronde-spiegel-100"><img src="a.jpg" alt="Ronde spiegel 100 cm"></a>',
      '<a class="t" href="/spiegels/ronde-spiegel-100">Ronde spiegel 100 cm</a>',
      '<a href="https://cdn.shop.be/spiegels/arch#reviews" title="Arch spiegel messing"></a>',
      '<a href="https://other.be/spiegel">Spiegel elders</a>',
      '<a href="/zoeken?q=spiegel">Zoek spiegels</a>',
      '<a href="/spiegels">Spiegels home</a>',
      '<a href="/spiegels/x">Kort</a>',
    ].join('')
    expect(listingLinks(html, PAGE)).toEqual([
      { title: 'Ronde spiegel 100 cm', url: 'https://www.shop.be/spiegels/ronde-spiegel-100' },
      { title: 'Arch spiegel messing', url: 'https://cdn.shop.be/spiegels/arch' },
      { title: 'Alle lampen & licht', url: 'https://www.shop.be/lampen' },
    ])
  })
})

describe('referralTargets', () => {
  const PAGE = 'https://www.afvalbakkenwinkel.nl/product/brabantia-stepup-10l/'
  const BOL = 'https://www.bol.com/nl/nl/p/brabantia-pedaalemmer-stepup-10-liter-dark-grey/9300000161151384/'

  it('reads the shop page an affiliate link carries in its query', () => {
    const href = `https://partner.bol.com/click/click?p=1&#038;t=url&#038;s=1115040&#038;url=${encodeURIComponent(BOL)}&#038;f=TXL`
    expect(referralTargets(`<a class="button alt" href="${href}" target="_blank">Bekijk bij bol</a>`, PAGE)).toEqual([BOL])
  })

  it('ignores share buttons, its own site, images, listings and plain links', () => {
    const html = [
      `<a href="https://www.facebook.com/sharer.php?u=${encodeURIComponent(PAGE)}">share</a>`,
      `<a href="https://pinterest.com/pin/create?url=x&media=${encodeURIComponent('https://cdn.shop.be/bin.jpg')}">pin</a>`,
      `<a href="/login?redirect=${encodeURIComponent('https://www.afvalbakkenwinkel.nl/account')}">login</a>`,
      `<a href="https://tt.example/c?r=${encodeURIComponent('https://www.shop.be/search?q=bin')}">search</a>`,
      `<a href="https://tt.example/c?r=${encodeURIComponent('https://www.shop.be/')}">home</a>`,
      '<a href="https://www.bol.com/nl/nl/p/x/1/">direct</a>',
    ].join('')
    expect(referralTargets(html, PAGE)).toEqual([])
  })

  it('keeps each destination once, at most three', () => {
    const link = (u: string) => `<a href="https://aff.example/go?url=${encodeURIComponent(u)}">x</a>`
    const html = [1, 1, 2, 3, 4].map((n) => link(`https://shop${n}.be/p/bin`)).join('')
    expect(referralTargets(html, PAGE)).toEqual(['https://shop1.be/p/bin', 'https://shop2.be/p/bin', 'https://shop3.be/p/bin'])
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
