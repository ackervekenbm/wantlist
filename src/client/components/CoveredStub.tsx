import type { Idea } from '../../types'
import { eurTight, perUnitText, shortDate } from '../lib/format'
import { packText } from '../lib/hunt'
import { Leader, Section } from './Leader'

/** A covered refill: what you bought last, and Running low to hunt again. */
export function CoveredStub({ idea, onRunningLow }: { idea: Idea; onRunningLow: () => void }) {
  const last = idea.purchases[0]
  // An Explore buy from before purchases were recorded only has the bought snapshot.
  const since = last?.at ?? idea.bought?.at
  return (
    <div className="slipwrap">
      <section className="slip covered" aria-label="Covered">
        <p className="cov-h">
          <span className="pill">
            ✓ <span>Covered</span>
          </span>
          {since && <span className="hint">since {shortDate(since)}</span>}
        </p>
        {last ? (
          <p>
            You bought <b>{packText(last.packs, idea, last.title)}</b>
            {last.shop && (
              <>
                {' '}
                at <b>{last.shop}</b>
              </>
            )}{' '}
            for {eurTight(last.paid)}
            {last.perUnit !== null && last.unitLabel && ` · ${perUnitText(last.perUnit, last.unitLabel)}`}.
          </p>
        ) : idea.bought ? (
          <p>
            You bought <b>{idea.bought.title}</b>
            {idea.bought.shop && (
              <>
                {' '}
                at <b>{idea.bought.shop}</b>
              </>
            )}
            .
          </p>
        ) : (
          <p>You bought something else.</p>
        )}
        <p className="hint">This hunt sleeps. When you're running low, it looks again for the cheapest real offer.</p>
        <div className="slip-acts">
          <button type="button" className="btn primary" onClick={onRunningLow}>
            Running low
          </button>
        </div>
      </section>
    </div>
  )
}

/** Every purchase, newest first, per unit when known. */
export function YouPaid({ idea }: { idea: Idea }) {
  if (idea.purchases.length === 0) return null
  return (
    <Section className="panel" title="You paid">
      <ul className="card paid">
        {idea.purchases.map((p) => (
          <li key={p.id}>
            <Leader fig={p.perUnit !== null && p.unitLabel ? perUnitText(p.perUnit, p.unitLabel) : eurTight(p.paid)}>
              {[shortDate(p.at), p.shop, packText(p.packs, idea, p.title)].filter(Boolean).join(' · ')}
            </Leader>
          </li>
        ))}
      </ul>
    </Section>
  )
}
