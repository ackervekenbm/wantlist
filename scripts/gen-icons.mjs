// Writes every app icon from the one drawing below: a brass magnifier with a
// price tag in its lens, on the Quote Slip green. Run `npm run icons` after
// changing the drawing, and commit the files it writes to public/.
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const pub = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url))

const GREEN = '#2C5B4B'
const PAPER = '#FFFDF8'
const BRASS = '#E9C987'

// The mark, drawn on a 512 grid and optically centred (lens + handle).
const mark = `
  <circle cx="232" cy="232" r="132" fill="${PAPER}" stroke="${BRASS}" stroke-width="32"/>
  <path d="M332 332 L404 404" stroke="${BRASS}" stroke-width="44" stroke-linecap="round"/>
  <path d="M190 196 L232 154 L274 196 V300 a12 12 0 0 1 -12 12 H202 a12 12 0 0 1 -12 -12 Z" fill="${GREEN}"/>
  <circle cx="232" cy="194" r="12" fill="${PAPER}"/>`

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}\n</svg>\n`

// Rounded tile: browser tab and the plain manifest icons.
const rounded = svg(`\n  <rect width="512" height="512" rx="112" fill="${GREEN}"/>${mark}`)
// Full-bleed square, mark shrunk into the safe zone: iOS and Android cut their own shape out of it.
const square = svg(
  `\n  <rect width="512" height="512" fill="${GREEN}"/>\n  <g transform="translate(256 256) scale(0.8) translate(-256 -256)">${mark}\n  </g>`,
)

await mkdir(pub('icons'), { recursive: true })
await writeFile(pub('favicon.svg'), rounded)
const png = (src, size, name) => sharp(Buffer.from(src)).resize(size, size).png().toFile(pub(name))
await png(rounded, 192, 'icons/icon-192.png')
await png(rounded, 512, 'icons/icon-512.png')
await png(square, 512, 'icons/icon-512-maskable.png')
await png(square, 180, 'apple-touch-icon.png')
console.log('wrote favicon.svg, apple-touch-icon.png, icons/icon-192.png, icon-512.png, icon-512-maskable.png')
