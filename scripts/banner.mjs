// Renders scripts/banner.html to docs/banner.png (the README banner) at 2x.
// Playwright is deliberately not a dependency; install it for one run:
//   npm i --no-save playwright && npx playwright install chromium && node scripts/banner.mjs
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const page = new URL('./banner.html', import.meta.url).href
const out = fileURLToPath(new URL('../docs/banner.png', import.meta.url))

const browser = await chromium.launch()
const tab = await browser.newPage({ viewport: { width: 860, height: 300 }, deviceScaleFactor: 2 })
await tab.goto(page)
await tab.evaluate(() => document.fonts.ready)
await tab.locator('.banner').screenshot({ path: out, omitBackground: true })
await browser.close()
console.log('wrote docs/banner.png')
