export type IdeaStatus = 'queued' | 'researching' | 'done' | 'error'

export type UrlStatus = 'live' | 'dead' | 'unknown'

export interface Pick {
  id: number
  ideaId: number
  rank: number
  title: string
  shop: string | null
  url: string
  price: string | null
  why: string | null
  sourceUrls: string[]
  fetchedAt: string | null
}

export interface Idea {
  id: number
  text: string
  status: IdeaStatus
  createdAt: string
  researchedAt: string | null
  error: string | null
  picks: Pick[]
}

export interface IdeaSummary {
  id: number
  text: string
  status: IdeaStatus
  createdAt: string
  researchedAt: string | null
  error: string | null
  pickCount: number
}

export interface WorkerRuntime {
  running: boolean
  lastRunAt: string | null
  lastRunResult: string | null
  queuedCount: number
}

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
  price: string | null
  why: string
}

export interface ResearchRequest {
  ideaId: number
  text: string
}

export interface ResearchEngine {
  research(request: ResearchRequest): Promise<FinalPick[]>
}