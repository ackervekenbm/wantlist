import type { Idea, PartnerOffer } from '../../types'
import { vikingDeals } from './vikingDeals'

/** One deal a shop has in a program: a percentage of the item price back. */
export interface PartnerDeal {
  percent: number
  /** What it covers ("All online purchases at bol", "Game consoles"). */
  scope: string
  /** Last day of a promotion (YYYY-MM-DD), or null. */
  until: string | null
}

/** One partner shop, as a program's loader returns it. */
export interface PartnerShop {
  /** Shop hosts ("nl.fnac.be"); a URL on one of them, or a subdomain, matches. */
  hosts: string[]
  /** Shop names ("bol-com", "Coolblue"), compared with the URL's host ("bol.com", "coolblue.be"). */
  names: string[]
  /** Only deals above 0%. */
  deals: PartnerDeal[]
  /** The page that starts a tracked purchase. */
  link: string
}

/**
 * A bill-discount partner program. Adding one: write a loader that turns its
 * partner list into `PartnerShop`s and add it to `PROGRAMS`; the owner turns it
 * on with `PARTNER_PROGRAMS=<id>`.
 */
export interface PartnerProgram {
  /** The value in `PARTNER_PROGRAMS`. */
  id: string
  /** Shown to the owner. */
  name: string
  /** Throws when the list cannot be read; `today` is YYYY-MM-DD, for promotions. */
  load(fetchFn: typeof fetch, today: string): Promise<PartnerShop[]>
}

export const PROGRAMS: readonly PartnerProgram[] = [vikingDeals]

const DAY_MS = 24 * 60 * 60 * 1000
const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const bare = (host: string): string => host.toLowerCase().replace(/^www\./, '')
const cents = (n: number): number => Math.round(n * 100) / 100

function hostOf(url: string): string | null {
  try {
    return bare(new URL(url).hostname)
  } catch {
    return null
  }
}

export function shopMatches(shop: PartnerShop, host: string): boolean {
  if (shop.hosts.some((h) => host === bare(h) || host.endsWith(`.${bare(h)}`))) return true
  const keys = [key(host), key(host.split('.')[0] ?? '')]
  return shop.names.some((n) => keys.includes(key(n)))
}

export interface PartnersOptions {
  fetch?: typeof fetch
  log?: (msg: string) => void
  now?: () => Date
}

/**
 * The partner lists of the programs the owner uses, refreshed once a day and
 * held in memory. A failed refresh keeps the last list (or none): partner data
 * is a bonus, never an error.
 */
export class Partners {
  private loaded = new Map<PartnerProgram, PartnerShop[]>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    readonly programs: readonly PartnerProgram[],
    private readonly opts: PartnersOptions = {},
  ) {}

  /** The programs named in `PARTNER_PROGRAMS` (comma-separated ids); unknown ids are reported. */
  static fromEnv(raw: string | undefined, opts: PartnersOptions = {}): Partners {
    const ids = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const unknown = ids.filter((id) => !PROGRAMS.some((p) => p.id === id))
    if (unknown.length) opts.log?.(`unknown PARTNER_PROGRAMS: ${unknown.join(', ')}`)
    return new Partners(PROGRAMS.filter((p) => ids.includes(p.id)), opts)
  }

  async refresh(): Promise<void> {
    const today = (this.opts.now?.() ?? new Date()).toISOString().slice(0, 10)
    for (const p of this.programs) {
      try {
        const shops = await p.load(this.opts.fetch ?? fetch, today)
        this.loaded.set(p, shops)
        this.opts.log?.(`${p.name}: ${shops.length} partner shops`)
      } catch (err) {
        this.opts.log?.(`${p.name}: partner list not refreshed (${err instanceof Error ? err.message : String(err)})`)
      }
    }
  }

  start(): void {
    if (this.programs.length === 0 || this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), DAY_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** The best partner deal for a shop URL (highest guaranteed percentage), or null. */
  offerFor(url: string, price: number | null): PartnerOffer | null {
    const host = hostOf(url)
    if (!host) return null
    let best: PartnerOffer | null = null
    for (const [program, shops] of this.loaded) {
      const shop = shops.find((s) => s.deals.length > 0 && shopMatches(s, host))
      if (!shop) continue
      const percents = shop.deals.map((d) => d.percent)
      const percent = Math.min(...percents)
      if (best && percent <= best.percent) continue
      const one = shop.deals.length === 1 ? shop.deals[0] : undefined
      best = {
        program: program.name,
        percent,
        percentMax: Math.max(...percents),
        saving: price === null ? null : cents((price * percent) / 100),
        scope: one?.scope ?? null,
        until: one?.until ?? null,
        link: shop.link,
      }
    }
    return best
  }

  /** EUR back on a price at a shop URL, at the lowest rate: what ranking may count on. */
  saving(url: string, price: number): number {
    return this.offerFor(url, price)?.saving ?? 0
  }

  /** The idea with each shop offer's partner deal filled in. */
  withPartners(idea: Idea): Idea {
    if (this.loaded.size === 0) return idea
    return {
      ...idea,
      picks: idea.picks.map((p) => ({
        ...p,
        suppliers: p.suppliers.map((s) => ({ ...s, partner: this.offerFor(s.url, s.price) })),
      })),
    }
  }
}
