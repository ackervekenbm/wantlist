import { describe, expect, it } from 'vitest'
import { availabilityOf, decodeEntities, extractProductData, parsePriceEur } from '../src/server/research/product'

const PAGE = 'https://shop.be/nl/p/fan/123'

function ld(...blocks: unknown[]): string {
  return blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join('\n')
}

describe('parsePriceEur', () => {
  it.each([
    ['229', 229],
    ['€ 229,99', 229.99],
    ['229.99', 229.99],
    ['€1.299', 1299],
    ['1.299,00 €', 1299],
    ['1,299.00', 1299],
    ['1 299,95', 1299.95],
    ['1\u00a0299', 1299],
    ['129,-', 129],
    ['from €129', 129],
    ['129-180', 129],
    ['12.345.678', 12345678],
    ['0', null],
    ['', null],
    ['n/a', null],
  ])('%s → %s', (input, expected) => {
    expect(parsePriceEur(input)).toBe(expected)
  })

  it('accepts numbers and rejects everything else', () => {
    expect(parsePriceEur(59.999)).toBe(60)
    expect(parsePriceEur(-3)).toBeNull()
    expect(parsePriceEur(Number.NaN)).toBeNull()
    expect(parsePriceEur(null)).toBeNull()
    expect(parsePriceEur({ price: 3 })).toBeNull()
  })
})

describe('availabilityOf', () => {
  it('maps schema.org values and plain words', () => {
    expect(availabilityOf('https://schema.org/InStock')).toBe('in_stock')
    expect(availabilityOf('http://schema.org/LimitedAvailability')).toBe('in_stock')
    expect(availabilityOf('OutOfStock')).toBe('out_of_stock')
    expect(availabilityOf('https://schema.org/Discontinued')).toBe('out_of_stock')
    expect(availabilityOf('https://schema.org/PreOrder')).toBe('preorder')
    expect(availabilityOf('BackOrder')).toBe('preorder')
    expect(availabilityOf('in stock')).toBe('in_stock')
    expect(availabilityOf('')).toBe('unknown')
    expect(availabilityOf(undefined)).toBe('unknown')
  })
})

describe('extractProductData', () => {
  it('reads a plain Product with one Offer', () => {
    const html = ld({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Wahoo KICKR Headwind',
      brand: { '@type': 'Brand', name: 'Wahoo' },
      image: ['/img/headwind.jpg', '/img/2.jpg'],
      aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.6', reviewCount: '88' },
      offers: {
        '@type': 'Offer',
        price: '249.99',
        priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock',
      },
    })
    expect(extractProductData(html, PAGE)).toEqual({
      name: 'Wahoo KICKR Headwind',
      brand: 'Wahoo',
      price: 249.99,
      availability: 'in_stock',
      image: 'https://shop.be/img/headwind.jpg',
      rating: { value: 4.6, count: 88 },
    })
  })

  it('finds the product inside @graph and skips related products without offers', () => {
    const html = ld({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Fans' },
        { '@type': 'BreadcrumbList', itemListElement: [] },
        { '@type': ['Product'], name: 'Related fan' },
        {
          '@type': ['Product', 'Thing'],
          name: 'The fan',
          offers: [{ '@type': 'Offer', price: 59, priceCurrency: 'EUR', availability: 'OutOfStock' }],
        },
      ],
    })
    expect(extractProductData(html, PAGE)).toMatchObject({ name: 'The fan', price: 59, availability: 'out_of_stock' })
  })

  it('prefers the cheapest offer in stock, and ignores other currencies', () => {
    const html = ld({
      '@type': 'Product',
      name: 'Fan',
      offers: [
        { '@type': 'Offer', price: '39', priceCurrency: 'GBP', availability: 'InStock' },
        { '@type': 'Offer', price: '45', priceCurrency: 'EUR', availability: 'OutOfStock' },
        { '@type': 'Offer', price: '55', priceCurrency: 'EUR', availability: 'InStock' },
        { '@type': 'Offer', price: '52', priceCurrency: 'EUR', availability: 'InStock' },
      ],
    })
    expect(extractProductData(html, PAGE)).toMatchObject({ price: 52, availability: 'in_stock' })
  })

  it('reads AggregateOffer low prices and ProductGroup variants', () => {
    const aggregate = ld({
      '@type': 'Product',
      name: 'Fan',
      offers: { '@type': 'AggregateOffer', lowPrice: '79,95', highPrice: '99', priceCurrency: 'EUR' },
    })
    expect(extractProductData(aggregate, PAGE)?.price).toBe(79.95)

    const group = ld({
      '@type': 'ProductGroup',
      name: 'Fan',
      hasVariant: [{ '@type': 'Product', offers: { price: '64.00', priceCurrency: 'EUR', availability: 'InStock' } }],
    })
    expect(extractProductData(group, PAGE)).toMatchObject({ price: 64, availability: 'in_stock' })
  })

  it('normalizes ratings to a 5-point scale', () => {
    const html = ld({
      '@type': 'Product',
      offers: { price: 10 },
      aggregateRating: { ratingValue: '9,2', bestRating: '10', ratingCount: 12 },
    })
    expect(extractProductData(html, PAGE)?.rating).toEqual({ value: 4.6, count: 12 })
  })

  it('tolerates broken JSON-LD and falls back to meta tags', () => {
    const html = `
      <script type="application/ld+json">{ "@type": "Product", "name": "Fan", </script>
      <meta property="og:title" content="Quiet fan">
      <meta property="og:image" content="//cdn.shop.be/fan.jpg">
      <meta property="product:price:amount" content="1.299,00">
      <meta property="product:price:currency" content="EUR">
      <meta content="instock" property="product:availability">`
    expect(extractProductData(html, PAGE)).toEqual({
      name: 'Quiet fan',
      brand: null,
      price: 1299,
      availability: 'in_stock',
      image: 'https://cdn.shop.be/fan.jpg',
      rating: null,
    })
  })

  it('accepts JSON-LD with raw newlines in strings', () => {
    const html = '<script type="application/ld+json">{"@type":"Product","name":"Fan\nPro","offers":{"price":"19"}}</script>'
    expect(extractProductData(html, PAGE)).toMatchObject({ name: 'Fan Pro', price: 19 })
  })

  it('returns null for pages without product data', () => {
    expect(extractProductData('<html><title>Blog</title><p>best fans</p></html>', PAGE)).toBeNull()
    expect(extractProductData(ld({ '@type': 'Article', headline: 'x' }), PAGE)).toBeNull()
  })

  it('never returns a non-http image URL', () => {
    const html = ld({ '@type': 'Product', image: 'javascript:alert(1)', offers: { price: 5 } })
    expect(extractProductData(html, PAGE)?.image).toBeNull()
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric entities, ampersand last', () => {
    expect(decodeEntities('Fan &amp;lt;3 &euro;&#160;59 &#x41; &quot;x&quot;')).toBe('Fan &lt;3 €\u00a059 A "x"')
    expect(decodeEntities('&#99999999;')).toBe('')
  })
})
