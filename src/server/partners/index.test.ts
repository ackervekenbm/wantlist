import { describe, expect, it, vi } from 'vitest'
import type { Idea } from '../../types'
import { Partners, PROGRAMS, type PartnerProgram, type PartnerShop } from './index'

const shop = (o: Partial<PartnerShop>): PartnerShop => ({
  hosts: [],
  names: [],
  deals: [{ percent: 2, scope: 'All purchases', until: null }],
  link: 'https://partner.example/shop/',
  ...o,
})

function program(id: string, load: () => Promise<PartnerShop[]>): PartnerProgram {
  return { id, name: id.toUpperCase(), load }
}

async function loaded(...programs: PartnerProgram[]): Promise<Partners> {
  const p = new Partners(programs)
  await p.refresh()
  return p
}

describe('Partners', () => {
  it('matches a shop by host (and subdomain) or by name against the host', async () => {
    const p = await loaded(
      program('a', async () => [
        shop({ hosts: ['fnac.be'], link: 'https://a/fnac/' }),
        shop({ names: ['bol-com', 'bol'], link: 'https://a/bol/' }),
        shop({ names: ['coolblue'], link: 'https://a/coolblue/' }),
      ]),
    )
    expect(p.offerFor('https://nl.fnac.be/x', 100)?.link).toBe('https://a/fnac/')
    expect(p.offerFor('https://www.bol.com/be/nl/p/1', 100)?.link).toBe('https://a/bol/')
    expect(p.offerFor('https://www.coolblue.be/nl/1', 100)?.link).toBe('https://a/coolblue/')
    expect(p.offerFor('https://www.krefel.be/x', 100)).toBeNull()
    expect(p.offerFor('not a url', 100)).toBeNull()
  })

  it('gives the lowest and highest rate, the saving at the lowest, and the scope only for a single deal', async () => {
    const p = await loaded(
      program('a', async () => [
        shop({
          names: ['bol'],
          deals: [
            { percent: 2.5, scope: 'Everything', until: '2026-11-30' },
            { percent: 1.5, scope: 'Consoles', until: null },
          ],
        }),
        shop({ names: ['hema'], deals: [{ percent: 3, scope: 'All purchases', until: '2026-12-24' }] }),
      ]),
    )
    expect(p.offerFor('https://bol.com/x', 129)).toEqual({
      program: 'A', percent: 1.5, percentMax: 2.5, saving: 1.94, scope: null, until: null, link: 'https://partner.example/shop/',
    })
    expect(p.offerFor('https://hema.com/x', null)).toMatchObject({ percent: 3, percentMax: 3, saving: null, scope: 'All purchases', until: '2026-12-24' })
    expect(p.saving('https://hema.com/x', 50)).toBe(1.5)
    expect(p.saving('https://other.be/x', 50)).toBe(0)
  })

  it('picks the program that guarantees the most when two cover a shop', async () => {
    const p = await loaded(
      program('a', async () => [shop({ names: ['bol'] })]),
      program('b', async () => [shop({ names: ['bol'], deals: [{ percent: 3, scope: '', until: null }] })]),
    )
    expect(p.offerFor('https://bol.com/x', 100)).toMatchObject({ program: 'B', saving: 3 })
  })

  it('keeps the last list when a refresh fails, and has none before the first success', async () => {
    const load = vi.fn<() => Promise<PartnerShop[]>>().mockRejectedValueOnce(new Error('down'))
    const log = vi.fn()
    const p = new Partners([program('a', load)], { log })
    await p.refresh()
    expect(p.offerFor('https://bol.com/x', 100)).toBeNull()
    expect(log).toHaveBeenCalledWith('A: partner list not refreshed (down)')
    load.mockResolvedValueOnce([shop({ names: ['bol'] })]).mockRejectedValueOnce(new Error('down again'))
    await p.refresh()
    await p.refresh()
    expect(p.offerFor('https://bol.com/x', 100)?.saving).toBe(2)
  })

  it('fills every shop offer of an idea', async () => {
    const p = await loaded(program('a', async () => [shop({ names: ['bol'] })]))
    const supplier = (url: string) => ({ shop: 's', url, price: 10, availability: 'in_stock' as const, checked: true })
    const idea = { picks: [{ suppliers: [supplier('https://bol.com/1'), supplier('https://x.be/1')] }] } as unknown as Idea
    const [s1, s2] = p.withPartners(idea).picks[0]?.suppliers ?? []
    expect(s1?.partner).toMatchObject({ program: 'A', saving: 0.2 })
    expect(s2?.partner).toBeNull()
  })

  it('turns on only the programs named in PARTNER_PROGRAMS and reports unknown ones', () => {
    const log = vi.fn()
    expect(Partners.fromEnv(undefined).programs).toEqual([])
    expect(Partners.fromEnv(' viking-deals , nope', { log }).programs).toEqual(PROGRAMS.filter((x) => x.id === 'viking-deals'))
    expect(log).toHaveBeenCalledWith('unknown PARTNER_PROGRAMS: nope')
  })
})
