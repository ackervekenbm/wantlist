/**
 * queued      - waiting for the worker (new, re-run, or a scheduled retry when
 *               `nextAttemptAt` is set)
 * researching - the worker is on it right now
 * done        - picks are in
 * error       - research gave up; only a manual re-run brings it back
 */
export type IdeaStatus = 'queued' | 'researching' | 'done' | 'error'

/** Why an idea stopped at `error`: no new product turned up, or something broke. */
export type ErrorKind = 'nothing-new' | 'stopped'

export type UrlStatus = 'live' | 'dead' | 'unknown'

/**
 * Where the idea sits for you, independent of research:
 * wanted   - still deciding (the only list the worker researches)
 * bought   - done; `bought` records what you bought
 * archived - no longer wanted
 */
export type IdeaList = 'wanted' | 'bought' | 'archived'

/** A snapshot of the pick you bought; picks are replaced on re-research. */
export interface BoughtPick {
  title: string
  shop: string | null
  url: string
  price: number | null
  /** ISO-8601. */
  at: string
}

export type Availability = 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown'

/** One shop's offer for a product. */
export interface PickSupplier {
  shop: string
  url: string
  /** EUR. From the shop page when `checked`, else what search or the model saw. */
  price: number | null
  availability: Availability
  /** Price and stock were read from the shop page's own product data. */
  checked: boolean
  /** A bill-discount partner deal at this shop; added when the API serves the idea. */
  partner?: PartnerOffer | null
}

/**
 * A partner program (Viking Deals, ...) gives part of the price back when the
 * purchase starts from its page. Percentages differ by category or customer,
 * so the lowest and highest are both kept.
 */
export interface PartnerOffer {
  /** "Viking Deals". */
  program: string
  /** Lowest share of the item price back, in percent. */
  percent: number
  /** Highest; equals `percent` when the shop has one deal. */
  percentMax: number
  /** EUR back at `percent`; null without a price. */
  saving: number | null
  /** What the deal covers when the shop has one; null when it depends on what you buy. */
  scope: string | null
  /** Last day of a promotion (YYYY-MM-DD), or null. */
  until: string | null
  /** Start the purchase here, or it is not counted. */
  link: string
}

export interface Rating {
  /** Normalized to a 0-5 scale. */
  value: number
  count: number | null
}

export type Reaction = 'no' | 'maybe' | 'yes'

/** What the owner wants, learned from reactions or edited by hand. */
export interface Preferences {
  summary: string
  mustHaves: string[]
  avoid: string[]
  likes: string[]
}

export type IdeaMode = 'explore' | 'hunt'
export type Condition = 'new' | 'refurbished' | 'used' | 'any'

/** The exact product a hunt looks for. */
export interface HuntTarget {
  product: string
  variant: string
  condition: Condition
  exclude: string[]
  /** "vial", "kg"; null when packs never differ. */
  unit: string | null
  /** How many the owner buys at once; absent or null means one. */
  quantity?: number | null
}

export type DeliveryKind = 'free' | 'paid' | 'free_over' | 'pickup_only' | 'no_be' | 'unknown'

export interface Delivery {
  kind: DeliveryKind
  cost: number | null
  threshold: number | null
}

/** A volume price the shop page states: from `min` items on, a price each or a percentage off. */
export interface BulkTier {
  min: number
  each: number | null
  percentOff: number | null
}

export type OfferGroup = 'best' | 'exact' | 'unavailable' | 'mismatch'

/** What a hunt knows about one shop's offer. */
export interface OfferFacts {
  match: 'exact' | 'mismatch'
  mismatch: string | null
  packs: number
  unitsPerPack: number | null
  delivery: Delivery
  /** What the shop page said, kept while the owner's own cost stands in `delivery`. */
  foundDelivery?: Delivery
  /** Item price plus delivery, when known. */
  delivered: number | null
  perUnit: number | null
  condition: Condition | null
  sellerNote: string | null
  group: OfferGroup
  /** Volume prices from the shop page; absent on offers read before they were. */
  bulk?: BulkTier[]
}

/** What was paid for an idea, newest first on the idea. */
export interface Purchase {
  id: number
  ideaId: number
  /** ISO-8601 (UTC). */
  at: string
  shop: string | null
  url: string | null
  title: string
  packs: number
  unitsPerPack: number | null
  unitLabel: string | null
  /** EUR, delivery included. */
  paid: number
  perUnit: number | null
}

/** Body of the buy action. */
export interface NewPurchase {
  pickId: number | null
  /** How many of the offer were bought; one when left out. */
  quantity?: number
  paid: number
  refill: boolean
}

export interface Pick {
  id: number
  ideaId: number
  rank: number
  kind: 'pick' | 'offer'
  /** Only for kind 'offer'. */
  offer: OfferFacts | null
  /** Research round that produced this pick (1-based). */
  round: number
  reaction: Reaction | null
  /** Why the owner reacted that way. */
  reason: string | null
  title: string
  /** Mirror of suppliers[0], the best offer. */
  shop: string | null
  url: string
  price: number | null
  why: string | null
  /** One honest trade-off or thing to check before buying. */
  caveat: string | null
  /** Product photo from the shop page. */
  image: string | null
  rating: Rating | null
  /** Pages the verification read. */
  sourceUrls: string[]
  fetchedAt: string | null
  /** Every known offer, best first: in stock before out of stock, then cheapest. */
  suppliers: PickSupplier[]
}

/** What the research understood the idea to be about. */
export interface ResearchBrief {
  title: string
  preferences: Preferences
  mode?: IdeaMode
  target?: HuntTarget | null
  refill?: boolean | null
}

export interface HistoryPick {
  round: number
  title: string
  shop: string | null
  price: number | null
  why: string | null
  reaction: Reaction | null
  reason: string | null
  /** The pick url plus every supplier url. */
  urls: string[]
}

export interface ResearchHistory {
  mode: 'learn' | 'fresh'
  preferences: Preferences | null
  preferencesEdited: boolean
  picks: HistoryPick[]
}

export interface Idea {
  id: number
  text: string
  /** Most you want to spend, in EUR. Steers the research. */
  budget: number | null
  /** Must-haves, constraints, context ("for a small flat", "no subscription"). */
  notes: string | null
  list: IdeaList
  bought: BoughtPick | null
  status: IdeaStatus
  /** ISO-8601 (UTC). */
  createdAt: string
  /** When the current picks were researched (ISO-8601), null before the first success. */
  researchedAt: string | null
  /**
   * The last failure. Set on `error`, and on `queued` while a retry is
   * scheduled; cleared by a success or a manual re-run.
   */
  error: string | null
  /** Set with `error` only when `status === 'error'`; null otherwise. */
  errorKind: ErrorKind | null
  /** Failed attempts since the last success or manual re-run. */
  attempts: number
  /** When a scheduled retry becomes due (ISO-8601), or null. */
  nextAttemptAt: string | null
  /** Model-written card title; `titleByOwner` marks one the owner set. */
  title: string | null
  titleByOwner: boolean
  /** Rounds researched so far. */
  round: number
  preferences: Preferences | null
  /** The owner edited `preferences` since the last round. */
  preferencesEdited: boolean
  /** The idea was reworded after this round: earlier picks are not history. */
  freshSinceRound: number | null
  mode: IdeaMode
  /** The owner chose the mode; research no longer re-guesses it. */
  modeByOwner: boolean
  target: HuntTarget | null
  targetByOwner: boolean
  /** Buy again when it runs out; null = unknown. */
  refill: boolean | null
  /** Newest first. */
  purchases: Purchase[]
  /** Ordered by round descending, then rank. */
  picks: Pick[]
}

/** A hunt idea that was bought and will be bought again. */
export function isCovered(idea: Idea): boolean {
  return idea.mode === 'hunt' && idea.list === 'bought' && idea.refill === true
}

export interface ServerStatus {
  /** False when no LLM key or no SERPER_API_KEY is configured. */
  researchEnabled: boolean
  /** Env vars that keep research disabled, for the UI to name. */
  missingKeys: string[]
  running: boolean
  lastRunAt: string | null
  lastRunResult: string | null
  /** Ideas waiting for the worker, including scheduled retries. */
  queuedCount: number
  /** The idea being researched right now and its latest step. */
  current: { ideaId: number; step: string } | null
  /** The model chain in order, with any model currently benched. */
  models: ModelHealth[]
  /** Which API keys are set; never their values. */
  keys: ApiKeyState[]
}

export interface ApiKeyState {
  name: string
  set: boolean
}

export interface ModelHealth {
  id: string
  /** Before the first ':' of id: 'gemini' | 'groq' | 'openrouter'. */
  provider: string
  /** After the first ':' of id. */
  model: string
  modelSource: ModelSource
  /** Skipped until this time (ISO-8601), or null when usable. */
  benchedUntil: string | null
  /** quota: rate/daily limit; unavailable: model unknown or key refused. */
  reason: 'quota' | 'unavailable' | null
  /** The last error this model returned, cut to 200 chars; cleared when it answers. */
  lastError: string | null
  limits: RateLimits | null
}

export interface RateLimit {
  limit: number | null
  remaining: number | null
  /** Raw header: Groq "2m59.56s", OpenRouter epoch ms. */
  reset: string | null
}

export interface RateLimits {
  requests: RateLimit | null
  tokens: RateLimit | null
  /** ISO-8601, when the headers were read. */
  seenAt: string
}

export type ModelSource = 'default' | 'env'

export interface ResearchCandidate {
  title: string
  shop: string
  url: string
  price?: string | null
  why?: string | null
}

export interface Pass1Result {
  summary: string
  criteria: string[]
  candidates: ResearchCandidate[]
  followUpQueries: string[]
}

export interface FinalPick {
  rank: number
  title: string
  shop: string
  url: string
  price: number | null
  why: string
  caveat: string | null
  image: string | null
  rating: Rating | null
  /**
   * Every known shop offer for this product, best first. The top-level
   * shop/url/price mirror suppliers[0].
   */
  suppliers: PickSupplier[]
  sourceUrls: string[]
  kind?: 'offer'
  offer?: OfferFacts
}

export interface ResearchResult {
  brief: ResearchBrief
  picks: FinalPick[]
}

/** A shop page a hunt always reads: the pick it was started from. */
export interface HuntSource {
  url: string
  shop: string
  title: string
}

export interface ResearchRequest {
  ideaId: number
  text: string
  budget?: number | null
  notes?: string | null
  title?: string | null
  history?: ResearchHistory | null
  mode?: IdeaMode
  target?: HuntTarget | null
  targetByOwner?: boolean
  modeByOwner?: boolean
  /** Shop pages a hunt reads besides what search finds. */
  huntFrom?: HuntSource[]
  /** Called with a short human-readable step ("searching shops", ...). */
  onProgress?: (step: string) => void
}

export interface ResearchEngine {
  research(request: ResearchRequest): Promise<ResearchResult>
}

/** Body of POST /api/ideas. */
export interface NewIdea {
  text: string
  budget?: number | null
  notes?: string | null
}

/** Body of PATCH /api/ideas/:id; every field optional. */
export interface IdeaPatch {
  text?: string
  budget?: number | null
  notes?: string | null
  list?: IdeaList
  /** With list 'bought': the pick you bought, or null when it was none of them. */
  boughtPickId?: number | null
  /** A string sets an owner title; null returns to the model's. */
  title?: string | null
  preferences?: Preferences
  mode?: IdeaMode
  target?: HuntTarget | null
}

/** Body of PATCH /api/picks/:id. */
export interface PickPatch {
  reaction?: Reaction | null
  reason?: string | null
  /** Hunt offers only: what delivery costs you, in euros (0 = free); null brings back what the shop page said. */
  delivery?: number | null
}
