# wantlist

A personal **shopping researcher that works while you don't**. Type a vague
buying idea ("a good fan to add to my indoor biking setup"), optionally a
budget and a must-have or two, and walk away. A background worker researches
it across the Belgian market (big marketplaces, specialists and brand shops,
prices in euro) and when you check in you find a short brief and 3–5 ranked
picks, each with the shop's own price and stock, a photo, a rating, why it
fits, and one honest caveat. Runs on a Raspberry Pi at €0.

## What it can do

- **Capture in one line.** Enter adds the idea; Shift+Enter starts a new
  line. **+ budget & must-haves** adds a ceiling in euro and the constraints
  that matter ("quiet, white, fits a small flat"); both steer the research.
- **Research in the background.** The worker plans search queries, searches
  the Belgian web, shortlists products from the real results, reads the
  product pages and verifies the shortlist against them. Each card shows the
  current step while it runs ("checking 4 offers at the shops…").
- **A brief before the picks.** What the research understood you are after,
  plus the criteria it judged by, so you can tell at a glance whether it
  understood you.
- **Prices you can trust.** Every offer's page is opened. When the shop
  publishes its product data (most do), price and stock come from the shop
  itself, marked with a check; a price only seen in search shows as "≈".
  Offers are ordered in stock first, then cheapest. Dead links are dropped,
  and so are products that only bounced to a shop's home page. Picks over
  your budget are flagged.
- **More than one shop.** The same product at several shops is one pick;
  **+2 shops** lists the other offers with their price and stock.
- **One honest caveat per pick.** "Loud on the top setting", "needs a
  subscription": the thing to check before you buy.
- **A buying lifecycle.** **I bought this** on a pick moves the idea to
  *Bought* with what you paid and where; **don't want it anymore** archives
  it; **want it again** brings it back. Only the *Wanted* list is researched.
- **Refresh when you want.** **edit** changes the text, budget or
  must-haves; **Save & research again** reruns it. Old picks stay visible
  until the new ones are in, and a failed refresh never loses them.
- **Honest about failures.** Free-tier quota, flaky models and blocked pages
  are retried by themselves (the card says when); anything that needs you,
  like a missing key, a search that found nothing or spent search credits,
  says so plainly.
- **Calm on a phone.** Cards collapse to their top pick (remembered per
  device), long lists get a filter, removals can be undone for a few seconds,
  and it follows your system's light or dark mode.

## What you need

- A free **Gemini API key** (<https://aistudio.google.com/apikey>) for the
  reasoning steps, and a free **Serper key** (<https://serper.dev>, 2,500
  one-time search credits, which last months of personal use) for the
  searches. No credit card anywhere.
- Optional extra free fallbacks when Gemini's daily quota is spent:
  `GROQ_API_KEY` (<https://console.groq.com/keys>) and/or `OPENROUTER_API_KEY`
  (<https://openrouter.ai/keys>).
- Somewhere always-on to run one Docker container (the Pi), since research
  happens while you are away.

## How it works

1. **Plan**: a model turns your idea, budget and must-haves into 2–4 search
   queries and a list of criteria.
2. **Search**: Serper runs the queries against Google with Belgium as the
   region.
3. **Shortlist**: a model picks 3–5 products from the real search results.
   It can only use URLs that came back from the search.
4. **Verify**: the server reads the top product pages, including the shop's
   own product data, and a model keeps only what the evidence supports. It
   merges one product sold by several shops into one pick, and adds the why
   and the caveat.
5. **Check the offers**: every remaining shop link is opened once for
   liveness, price, stock, photo and rating.

The models run on free tiers, so the app routes around their limits:
several Gemini models (each has its own quota) and the optional Groq /
OpenRouter fallbacks form a chain. A rate-limited model sits out until its
reset and the next one answers. When everything is out, ideas wait for the
first reset instead of failing.

## Where your data lives

One SQLite file on the server (`data/wantlist.db`, the `wantlist-data`
volume in Docker): your ideas, budgets, notes, picks and what you bought.
API keys live only in the server's environment (`.env`), never in the repo
or the browser. The browser keeps only which cards you collapsed. There is
no login, so keep it on your LAN or tailnet.

## Run it

**Production (Pi / OpenMediaVault):** the image
`ghcr.io/ackervekenbm/wantlist:latest` (amd64 + arm64) with the keys in a
`.env`. See [docs/deployment.md](docs/deployment.md).

**Development:**

```bash
npm install
cp .env.example .env        # add GEMINI_API_KEY and SERPER_API_KEY
npm run dev                 # API on :3091, UI on :5174 (open this one)
```

`npm run spike "your idea here"` runs the research engine directly against
your keys and prints each step, the brief and the picks: the fastest way to
judge quality.

```bash
npm run build     # typecheck + lint + client build + server build
npm test          # vitest: server/research in node, UI in jsdom; no network
```

**Tech stack**: React 19 · TypeScript · Vite · Express 5 · better-sqlite3 ·
Vitest + Testing Library. Contributor notes live in [AGENTS.md](AGENTS.md);
the research design, free-tier facts and risks in [docs/plan.md](docs/plan.md).
