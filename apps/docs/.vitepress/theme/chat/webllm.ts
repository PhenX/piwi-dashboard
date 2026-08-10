/**
 * Optional local-LLM tier for the docs chat. WebLLM runs a small instruct
 * model entirely in the browser over WebGPU — no server, no API key, no data
 * leaving the page. It is loaded lazily from a pinned CDN the first time a
 * reader opts in, so the default "instant answers" tier stays fully offline
 * and nothing here costs anything until it is asked for.
 */

// Pinned so a reader always gets the version this POC was written against.
// The model weights are fetched (and cached by the browser) from the MLC CDN
// on first use; only this opt-in tier touches the network.
const WEBLLM_MODULE_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.84'

// Smallest instruct model that still answers grounded questions well. ~350 MB
// on first load, then served from the browser's Cache Storage. Swap for
// 'Llama-3.2-1B-Instruct-q4f16_1-MLC' (~900 MB) for noticeably better answers.
export const DEFAULT_MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC'

export interface LoadProgress {
  /** 0–1 overall download/compile progress, when the engine reports it. */
  progress: number
  text: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** Feature-detect WebGPU without importing the (large) WebLLM module. */
export function webgpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator
}

// The MLCEngine instance is untyped here — the module is a runtime CDN import,
// so we describe only the surface this wrapper uses.
type Engine = {
  chat: {
    completions: {
      create: (opts: Record<string, unknown>) => Promise<AsyncIterable<{ choices: Array<{ delta: { content?: string } }> }>>
    }
  }
}

let enginePromise: Promise<Engine> | null = null

/**
 * Load the model once and reuse it. `onProgress` reports the (one-time)
 * download and GPU-compile so the UI can show a real progress bar.
 */
export async function loadEngine(model: string, onProgress: (p: LoadProgress) => void): Promise<Engine> {
  if (enginePromise) return enginePromise
  enginePromise = (async () => {
    const webllm = await import(/* @vite-ignore */ WEBLLM_MODULE_URL)
    return webllm.CreateMLCEngine(model, {
      initProgressCallback: (report: { progress: number; text: string }) =>
        onProgress({ progress: report.progress, text: report.text }),
    }) as Promise<Engine>
  })()
  return enginePromise
}

const SYSTEM_PROMPT = [
  'You are the assistant for the Piwi Dashboard documentation.',
  'Answer the user strictly from the numbered CONTEXT passages provided with each question.',
  'Cite the passages you use inline as [1], [2], etc.',
  'If the context does not contain the answer, say so plainly and suggest what to search for instead — never invent APIs, options, or behavior.',
  'Be concise and concrete: name the exact option, command, or page.',
].join(' ')

/**
 * Stream a grounded answer. `context` is the numbered passage block from
 * retrieval.buildContext(); `history` is prior turns for follow-up questions.
 * Yields the answer incrementally so the UI can render tokens as they arrive.
 */
export async function* streamAnswer(
  engine: Engine,
  question: string,
  context: string,
  history: ChatTurn[],
): AsyncGenerator<string> {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-4),
    { role: 'user', content: `CONTEXT:\n${context}\n\nQUESTION: ${question}` },
  ]
  const stream = await engine.chat.completions.create({ messages, stream: true, temperature: 0.2, max_tokens: 512 })
  for await (const part of stream) {
    const delta = part.choices[0]?.delta?.content
    if (delta) yield delta
  }
}
