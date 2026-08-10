/**
 * Optional semantic-search tier for the docs chat. A small sentence-embedding
 * model (MiniLM, ~23 MB int8) runs in the browser via Transformers.js — WASM,
 * so no WebGPU is required (it is used only if present, for speed). The doc
 * chunks are embedded once and the vectors cached in IndexedDB, so every later
 * question only has to embed the query: one fast forward pass, then a dot
 * product against the cached matrix.
 *
 * Loaded lazily from a pinned CDN when a reader opts in, exactly like the
 * WebLLM tier — the default lexical tier stays dependency-free and offline.
 */
import { snippetFor, type Chunk, type RankedChunk } from './retrieval'

const TRANSFORMERS_MODULE_URL = 'https://esm.run/@huggingface/transformers@3.3.3'
export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'
const EMBED_DIMS = 384
const BATCH = 16
/** Only the heading and the opening words of a chunk are embedded — enough to
 *  place it semantically, and far quicker to index than the full body. */
const EMBED_WORDS = 120

export interface PrepareProgress {
  phase: 'download' | 'index' | 'ready'
  progress: number
  text: string
}

// The pipeline and its output tensor are untyped here — the module is a runtime
// CDN import, so only the surface this file uses is described.
type Extractor = (
  input: string | string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array }>

let extractorPromise: Promise<Extractor> | null = null

// Use WebGPU only when an adapter is actually obtainable — a browser can
// expose `navigator.gpu` yet fail to grant one, and this tier's promise is
// that it runs on WASM without a GPU either way.
async function preferredDevice(): Promise<'webgpu' | 'wasm'> {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const adapter = await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter()
      if (adapter) return 'webgpu'
    } catch {
      // fall through to WASM
    }
  }
  return 'wasm'
}

async function loadExtractor(onProgress: (p: PrepareProgress) => void): Promise<Extractor> {
  if (extractorPromise) return extractorPromise
  extractorPromise = (async () => {
    const transformers = await import(/* @vite-ignore */ TRANSFORMERS_MODULE_URL)
    return transformers.pipeline('feature-extraction', EMBED_MODEL, {
      dtype: 'q8',
      device: await preferredDevice(),
      progress_callback: (report: { status: string; progress?: number }) => {
        if (report.status === 'progress') {
          const pct = report.progress ?? 0
          onProgress({ phase: 'download', progress: pct / 100, text: `Downloading model… ${Math.round(pct)}%` })
        }
      },
    }) as Promise<Extractor>
  })()
  return extractorPromise
}

/** Embed a batch of strings into normalized mean-pooled vectors. */
async function embedBatch(extractor: Extractor, texts: string[]): Promise<Float32Array[]> {
  const output = await extractor(texts, { pooling: 'mean', normalize: true })
  const vectors: Float32Array[] = []
  for (let i = 0; i < texts.length; i++) {
    vectors.push(output.data.slice(i * EMBED_DIMS, (i + 1) * EMBED_DIMS))
  }
  return vectors
}

function embedText(chunk: Chunk): string {
  return `${chunk.heading}. ${chunk.text.split(/\s+/).slice(0, EMBED_WORDS).join(' ')}`
}

/** A prepared semantic index — the doc matrix plus the loaded query embedder. */
export class SemanticIndex {
  constructor(
    private chunks: Chunk[],
    private matrix: Float32Array,
    private extractor: Extractor,
  ) {}

  async search(query: string, limit = 4): Promise<RankedChunk[]> {
    const [q] = await embedBatch(this.extractor, [query])
    if (!q) return []
    const scored = this.chunks.map((_, i) => {
      let dot = 0
      const offset = i * EMBED_DIMS
      for (let d = 0; d < EMBED_DIMS; d++) dot += this.matrix[offset + d]! * q[d]!
      return { i, score: dot }
    })
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ i, score }) => ({
        ...this.chunks[i]!,
        score,
        snippet: snippetFor(this.chunks[i]!.text, query),
      }))
  }
}

/**
 * Load the model, then load the doc matrix from IndexedDB or build it once.
 * `signature` invalidates the cache when the docs (and so the vectors) change.
 */
export async function prepareSemanticIndex(
  chunks: Chunk[],
  signature: string,
  onProgress: (p: PrepareProgress) => void,
): Promise<SemanticIndex> {
  const extractor = await loadExtractor(onProgress)

  const cached = await loadCache(signature)
  if (cached && cached.length === chunks.length * EMBED_DIMS) {
    onProgress({ phase: 'ready', progress: 1, text: 'Ready' })
    return new SemanticIndex(chunks, cached, extractor)
  }

  const matrix = new Float32Array(chunks.length * EMBED_DIMS)
  for (let start = 0; start < chunks.length; start += BATCH) {
    const slice = chunks.slice(start, start + BATCH)
    const vectors = await embedBatch(extractor, slice.map(embedText))
    for (let j = 0; j < vectors.length; j++) matrix.set(vectors[j]!, (start + j) * EMBED_DIMS)
    const done = Math.min(start + BATCH, chunks.length)
    onProgress({ phase: 'index', progress: done / chunks.length, text: `Indexing docs… ${done}/${chunks.length}` })
  }

  await saveCache(signature, matrix).catch(() => {})
  onProgress({ phase: 'ready', progress: 1, text: 'Ready' })
  return new SemanticIndex(chunks, matrix, extractor)
}

/** A cheap signature so stale vectors are rebuilt when the docs change. */
export function indexSignature(chunks: Chunk[]): string {
  let textLen = 0
  for (const chunk of chunks) textLen += chunk.text.length
  return `${EMBED_MODEL}:${chunks.length}:${textLen}`
}

// ── IndexedDB cache ────────────────────────────────────────────────────────
// Vectors are the only thing cached; the chunk text ships in chat-index.json.

const DB_NAME = 'piwi-docs-chat'
const STORE = 'embeddings'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function loadCache(signature: string): Promise<Float32Array | null> {
  if (typeof indexedDB === 'undefined') return null
  try {
    const db = await openDb()
    return await new Promise<Float32Array | null>((resolve) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(signature)
      request.onsuccess = () => {
        const value = request.result as ArrayBuffer | undefined
        resolve(value ? new Float32Array(value) : null)
      }
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function saveCache(signature: string, matrix: Float32Array): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    // Only the freshest signature is worth keeping; clear the rest.
    tx.objectStore(STORE).clear()
    tx.objectStore(STORE).put(matrix.buffer, signature)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
