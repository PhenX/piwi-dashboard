/**
 * In-browser retrieval over the docs knowledge base (public/chat-index.json,
 * built by scripts/generate-chat-index.mjs). Pure BM25 — no model, no network,
 * no dependency — so "instant answers" work everywhere with zero download and
 * the WebLLM tier only has to phrase the passages this finds.
 */

export interface Chunk {
  id: number
  title: string
  heading: string
  url: string
  text: string
}

export interface ChatIndex {
  generatedFrom: number
  chunks: Chunk[]
}

export interface RankedChunk extends Chunk {
  score: number
  /** The sentences within the chunk that matched the query, for extractive answers. */
  snippet: string
}

// A short English stopword set — enough to stop "the"/"a"/"is" from dominating
// the ranking without needing a linguistics library.
const STOPWORDS = new Set(
  ('a an and are as at be but by for from has have how in into is it its of on or that the to was were what when where which who why will with your you can do does'
    .split(' ')),
)

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
}

const K1 = 1.5
const B = 0.75

/** A prepared BM25 index. Build once per session, query many times. */
export class Retriever {
  private chunks: Chunk[]
  private docTokens: string[][]
  private docFreq = new Map<string, number>()
  private avgLen = 0

  constructor(index: ChatIndex) {
    this.chunks = index.chunks
    // Weight the page title and section heading alongside the body so a query's
    // topic words count even when the prose phrases them differently, without
    // letting a short generic heading ("Set it up") outscore the body it heads.
    this.docTokens = this.chunks.map((chunk) => tokenize(`${chunk.title} ${chunk.heading} ${chunk.text}`))
    let total = 0
    for (const tokens of this.docTokens) {
      total += tokens.length
      for (const term of new Set(tokens)) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1)
      }
    }
    this.avgLen = total / Math.max(1, this.docTokens.length)
  }

  /** Inverse document frequency, floored at zero so common terms never hurt. */
  private idf(term: string): number {
    const n = this.docTokens.length
    const df = this.docFreq.get(term) ?? 0
    return Math.max(0, Math.log(1 + (n - df + 0.5) / (df + 0.5)))
  }

  search(query: string, limit = 4): RankedChunk[] {
    const queryTerms = new Set(tokenize(query))
    if (queryTerms.size === 0) return []

    const scored = this.docTokens.map((tokens, i) => {
      const counts = new Map<string, number>()
      for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
      const len = tokens.length
      let score = 0
      for (const term of queryTerms) {
        const tf = counts.get(term)
        if (!tf) continue
        const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * (len / this.avgLen)))
        score += this.idf(term) * norm
      }
      return { i, score }
    })

    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ i, score }) => ({
        ...this.chunks[i]!,
        score,
        snippet: bestSnippet(this.chunks[i]!.text, queryTerms),
      }))
  }
}

/** Extractive snippet for a chunk against a raw query string. */
export function snippetFor(text: string, query: string): string {
  return bestSnippet(text, new Set(tokenize(query)))
}

/**
 * Pick the two or three consecutive sentences of a chunk that carry the most
 * query terms — the extractive answer shown when no model is loaded.
 */
function bestSnippet(text: string, queryTerms: Set<string>, window = 3): string {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((sentence) => sentence.trim().length > 0)
  if (sentences.length <= window) return text.slice(0, 320)

  const hits = sentences.map((sentence) => {
    const tokens = new Set(tokenize(sentence))
    let count = 0
    for (const term of queryTerms) if (tokens.has(term)) count++
    return count
  })

  let bestStart = 0
  let bestScore = -1
  for (let start = 0; start + window <= sentences.length; start++) {
    let score = 0
    for (let j = start; j < start + window; j++) score += hits[j]!
    if (score > bestScore) {
      bestScore = score
      bestStart = start
    }
  }
  return sentences.slice(bestStart, bestStart + window).join(' ').slice(0, 400)
}

/**
 * Assemble the retrieved passages into the numbered context block the model
 * is asked to ground its answer in. Kept small so it fits a tiny model's
 * window and stays fast to generate from.
 */
export function buildContext(chunks: RankedChunk[], maxChars = 2400): string {
  const parts: string[] = []
  let used = 0
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!
    const body = chunk.text.slice(0, 900)
    const block = `[${i + 1}] ${chunk.title} — ${chunk.heading}\n${body}`
    if (used + block.length > maxChars && parts.length > 0) break
    parts.push(block)
    used += block.length
  }
  return parts.join('\n\n')
}
