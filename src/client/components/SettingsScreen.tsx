import type { ModelHealth, RateLimit, ServerStatus } from '../../types'
import { clockTime } from '../lib/format'
import { BackLink } from './BackLink'
import { Leader, Section } from './Leader'

const PROVIDERS: Record<string, { name: string; key: string; dashboard: string }> = {
  gemini: { name: 'Gemini', key: 'GEMINI_API_KEY', dashboard: 'https://aistudio.google.com/usage' },
  groq: { name: 'Groq', key: 'GROQ_API_KEY', dashboard: 'https://console.groq.com/dashboard/usage' },
  openrouter: { name: 'OpenRouter', key: 'OPENROUTER_API_KEY', dashboard: 'https://openrouter.ai/activity' },
}

/** Models and keys as the server sees them: read-only, set in the server's environment. */
export function SettingsScreen({ status }: { status: ServerStatus | null }) {
  const keySet = (name: string) => status?.keys.find((k) => k.name === name)?.set ?? false
  const chain = status?.models ?? []
  // Providers in chain order, then the ones that are not in it.
  const order = [...new Set([...chain.map((m) => m.provider), ...Object.keys(PROVIDERS)])]

  return (
    <div className="screen">
      <BackLink />
      <h1 tabIndex={-1}>Settings</h1>
      {status && (
        <>
          <Section title="Research models" note="read-only, set in .env">
            {order.map((id) => {
              const p = PROVIDERS[id]
              if (!p) return null
              return (
                <div key={id} className="card prov">
                  <Leader fig={<KeyState set={keySet(p.key)} />}>
                    <DashLink href={p.dashboard}>{p.name}</DashLink>
                  </Leader>
                  {chain.map((m, i) => (m.provider === id ? <ModelRow key={m.id} m={m} n={i + 1} /> : null))}
                </div>
              )
            })}
          </Section>
          <Section title="Search">
            <div className="card prov">
              <Leader fig={<KeyState set={keySet('SERPER_API_KEY')} />}>
                <DashLink href="https://serper.dev/dashboard">Serper</DashLink>
              </Leader>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

function DashLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

const KeyState = ({ set }: { set: boolean }) => (set ? <>key ✓</> : <>not set</>)

function ModelRow({ m, n }: { m: ModelHealth; n: number }) {
  const state =
    m.reason === 'quota'
      ? `out of quota until ${m.benchedUntil ? clockTime(m.benchedUntil) : 'later'}`
      : m.reason === 'unavailable'
        ? `unavailable: ${m.lastError ?? 'check the model name and key'}`
        : 'ready'
  return (
    <div className="mrow">
      <div>
        {n}. <b>{m.model}</b>
        {m.modelSource === 'default' && <span className="n"> (default)</span>}
        {' · '}
        {state}
      </div>
      {!m.reason && m.lastError && <div className="n">last error: {m.lastError}</div>}
      {m.limits ? (
        <>
          <Limit what="requests" l={m.limits.requests} />
          <Limit what="tokens" l={m.limits.tokens} />
        </>
      ) : (
        m.provider !== 'gemini' && <div className="n">no limits reported yet</div>
      )}
    </div>
  )
}

function Limit({ what, l }: { what: string; l: RateLimit | null }) {
  if (!l || l.remaining === null) return null
  const reset = !l.reset ? '' : /^\d{13,}$/.test(l.reset) ? ` · resets ${clockTime(new Date(Number(l.reset)).toISOString())}` : ` · resets in ${l.reset}`
  return (
    <div className="n">
      {l.remaining}
      {l.limit !== null && ` of ${l.limit}`} {what} left{reset}
    </div>
  )
}
