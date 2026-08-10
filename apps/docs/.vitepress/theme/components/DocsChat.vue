<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { Retriever, buildContext, type ChatIndex, type RankedChunk } from '../chat/retrieval'
import {
  DEFAULT_MODEL,
  loadEngine,
  streamAnswer,
  webgpuAvailable,
  type ChatTurn,
  type LoadProgress,
} from '../chat/webllm'

interface Message {
  role: 'user' | 'assistant'
  content: string
  sources?: RankedChunk[]
  /** True while the local model is still streaming this answer. */
  streaming?: boolean
}

type Mode = 'instant' | 'local'
type EngineState = 'idle' | 'loading' | 'ready' | 'error'

const base = import.meta.env.BASE_URL

const open = ref(false)
const mode = ref<Mode>('instant')
const input = ref('')
const busy = ref(false)
const messages = ref<Message[]>([])
const scroller = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)

// Retrieval index — fetched once, on first open, so an unopened widget costs
// nothing beyond the button.
const retriever = shallowRef<Retriever | null>(null)
const indexError = ref('')

// Local-AI tier state.
const hasWebgpu = ref(true)
const engineState = ref<EngineState>('idle')
const loadProgress = ref<LoadProgress>({ progress: 0, text: '' })
const engineError = ref('')

const withBase = (url: string) => base.replace(/\/$/, '') + url

async function ensureIndex() {
  if (retriever.value || indexError.value) return
  try {
    const res = await fetch(withBase('/chat-index.json'))
    if (!res.ok) throw new Error(`status ${res.status}`)
    const index = (await res.json()) as ChatIndex
    retriever.value = new Retriever(index)
  } catch (err) {
    indexError.value = `Could not load the docs index (${(err as Error).message}).`
  }
}

function toggle() {
  open.value = !open.value
  if (open.value) {
    hasWebgpu.value = webgpuAvailable()
    void ensureIndex()
    void nextTick(() => inputEl.value?.focus())
  }
}

async function scrollToBottom() {
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
}

async function enableLocalAi() {
  if (!hasWebgpu.value || engineState.value === 'loading') return
  engineState.value = 'loading'
  engineError.value = ''
  try {
    await loadEngine(DEFAULT_MODEL, (p) => (loadProgress.value = p))
    engineState.value = 'ready'
  } catch (err) {
    engineState.value = 'error'
    engineError.value = (err as Error).message || 'Failed to load the model.'
  }
}

async function send() {
  const question = input.value.trim()
  if (!question || busy.value) return
  await ensureIndex()
  if (!retriever.value) return

  input.value = ''
  busy.value = true
  messages.value.push({ role: 'user', content: question })
  const sources = retriever.value.search(question, 4)
  await scrollToBottom()

  try {
    if (mode.value === 'local' && engineState.value === 'ready') {
      await answerWithModel(question, sources)
    } else {
      answerFromPassages(sources)
    }
  } finally {
    busy.value = false
    await scrollToBottom()
  }
}

/** Zero-download answer: the best-matching passages, verbatim, with sources. */
function answerFromPassages(sources: RankedChunk[]) {
  if (sources.length === 0) {
    messages.value.push({
      role: 'assistant',
      content: "I couldn't find anything about that in the docs. Try different words, or the search box at the top of the page.",
    })
    return
  }
  const lead = sources[0]!
  const content = `From **${lead.title} → ${lead.heading}**:\n\n${lead.snippet}`
  messages.value.push({ role: 'assistant', content, sources })
}

/** Grounded answer streamed from the in-browser model. */
async function answerWithModel(question: string, sources: RankedChunk[]) {
  const context = buildContext(sources)
  const history: ChatTurn[] = messages.value
    .filter((m) => !m.streaming)
    .slice(-5, -1)
    .map((m) => ({ role: m.role, content: m.content }))

  const message: Message = { role: 'assistant', content: '', sources, streaming: true }
  messages.value.push(message)

  try {
    for await (const token of streamAnswer((await loadEngine(DEFAULT_MODEL, () => {})), question, context, history)) {
      message.content += token
      await scrollToBottom()
    }
  } catch (err) {
    message.content = message.content || `The model errored: ${(err as Error).message}. The passages below still answer this from the docs.`
  } finally {
    message.streaming = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void send()
  }
}

const SUGGESTIONS = [
  'How do I set up the reporter?',
  'What is a flaky score?',
  'How do I deploy with Docker?',
  'Does Piwi send my data anywhere?',
]

function ask(suggestion: string) {
  input.value = suggestion
  void send()
}

const modelName = DEFAULT_MODEL.replace(/-MLC$/, '').replace(/-q4f16_1$/, '')
const progressPct = computed(() => Math.round(loadProgress.value.progress * 100))

// Escape everything, then re-introduce a little safe formatting: **bold**,
// citation links [1], line breaks. Answer text is from our own docs and the
// local model — never a remote party — but escaping first keeps it robust.
function format(message: Message): string {
  const escaped = message.content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(\d+)\]/g, (whole, n: string) => {
      const source = message.sources?.[Number(n) - 1]
      return source ? `<a class="cite" href="${withBase(source.url)}">[${n}]</a>` : whole
    })
    .replace(/\n/g, '<br>')
}

onMounted(() => {
  hasWebgpu.value = webgpuAvailable()
})

watch(mode, (next) => {
  if (next === 'local' && engineState.value === 'idle') hasWebgpu.value = webgpuAvailable()
})
</script>

<template>
  <div class="docs-chat">
    <button
      class="chat-launcher"
      type="button"
      :aria-expanded="open"
      aria-label="Ask the docs assistant"
      @click="toggle"
    >
      <span v-if="!open" class="launcher-inner">
        <span class="launcher-icon" aria-hidden="true">✦</span>
        <span class="launcher-label">Ask AI</span>
        <span class="launcher-beta">beta</span>
      </span>
      <span v-else class="launcher-icon" aria-hidden="true">✕</span>
    </button>

    <div v-if="open" class="chat-panel" role="dialog" aria-label="Docs assistant">
      <header class="chat-head">
        <div class="head-title">
          <strong>Docs assistant</strong>
          <span class="head-sub">Answers from these docs, in your browser</span>
        </div>
        <div class="mode-switch" role="tablist" aria-label="Answer mode">
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'instant'"
            :class="{ active: mode === 'instant' }"
            @click="mode = 'instant'"
          >
            Instant
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'local'"
            :class="{ active: mode === 'local' }"
            @click="mode = 'local'"
          >
            Local AI
          </button>
        </div>
      </header>

      <div ref="scroller" class="chat-body">
        <div v-if="indexError" class="notice error">{{ indexError }}</div>

        <div v-if="messages.length === 0" class="empty">
          <p v-if="mode === 'instant'">
            Ask a question and I'll pull the most relevant sections straight from the docs — no download, no
            server, works offline.
          </p>
          <p v-else>
            <strong>Local AI</strong> writes a conversational, cited answer using a small model that runs entirely
            in your browser. Enable it below to download the model once (~350&nbsp;MB, then cached).
          </p>
          <div class="suggestions">
            <button v-for="s in SUGGESTIONS" :key="s" type="button" class="chip" @click="ask(s)">{{ s }}</button>
          </div>
        </div>

        <div v-for="(message, i) in messages" :key="i" class="msg" :class="message.role">
          <div class="bubble">
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div class="bubble-text" v-html="format(message)"></div>
            <span v-if="message.streaming && !message.content" class="typing">Thinking…</span>
            <ul v-if="message.sources && message.sources.length" class="sources">
              <li v-for="(source, s) in message.sources" :key="source.id">
                <a :href="withBase(source.url)">
                  <span class="src-n">{{ s + 1 }}</span>
                  <span class="src-title">{{ source.title }}</span>
                  <span class="src-heading">{{ source.heading }}</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Local-AI enablement panel, shown until the model is ready. -->
      <div v-if="mode === 'local' && engineState !== 'ready'" class="local-panel">
        <template v-if="!hasWebgpu">
          <p class="notice warn">
            This browser has no WebGPU, so the local model can't run here. Chrome or Edge 113+ (or Safari 18+) support
            it. <strong>Instant</strong> answers work regardless.
          </p>
        </template>
        <template v-else-if="engineState === 'loading'">
          <p class="load-text">{{ loadProgress.text || 'Loading model…' }}</p>
          <div class="progress"><div class="bar" :style="{ width: progressPct + '%' }"></div></div>
          <p class="load-hint">Downloads once, then cached by your browser for next time.</p>
        </template>
        <template v-else>
          <p class="notice">
            Runs <code>{{ modelName }}</code> fully in your browser over WebGPU. First use downloads ~350&nbsp;MB
            (cached afterwards); nothing you type leaves the page.
          </p>
          <button type="button" class="enable-btn" @click="enableLocalAi">Enable local AI</button>
          <p v-if="engineState === 'error'" class="notice error">{{ engineError }}</p>
        </template>
      </div>

      <form class="chat-input" @submit.prevent="send">
        <textarea
          ref="inputEl"
          v-model="input"
          rows="1"
          placeholder="Ask about the docs…"
          :disabled="busy"
          @keydown="onKeydown"
        ></textarea>
        <button type="submit" :disabled="busy || !input.trim()" aria-label="Send">
          {{ busy ? '…' : '↑' }}
        </button>
      </form>
      <p class="disclaimer">
        POC · answers are grounded in the docs but can be wrong — follow the source links.
      </p>
    </div>
  </div>
</template>

<style scoped>
.chat-launcher {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 60;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white, #fff);
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
}
.chat-launcher:hover {
  background: var(--vp-c-brand-2);
}
.launcher-inner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.launcher-icon {
  font-size: 16px;
  line-height: 1;
}
.launcher-beta {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(255, 255, 255, 0.25);
  padding: 1px 6px;
  border-radius: 999px;
}

.chat-panel {
  position: fixed;
  right: 24px;
  bottom: 84px;
  z-index: 60;
  width: min(420px, calc(100vw - 32px));
  height: min(620px, calc(100vh - 120px));
  display: flex;
  flex-direction: column;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.24);
  overflow: hidden;
}

.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.head-title {
  display: flex;
  flex-direction: column;
}
.head-title strong {
  font-size: 14px;
}
.head-sub {
  font-size: 11.5px;
  color: var(--vp-c-text-3);
}
.mode-switch {
  display: inline-flex;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  overflow: hidden;
}
.mode-switch button {
  padding: 5px 12px;
  font-size: 12px;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  border: none;
}
.mode-switch button.active {
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white, #fff);
}

.chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty p {
  font-size: 13.5px;
  color: var(--vp-c-text-2);
  line-height: 1.6;
  margin: 0 0 12px;
}
.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  padding: 6px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.chip:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.msg {
  display: flex;
}
.msg.user {
  justify-content: flex-end;
}
.bubble {
  max-width: 92%;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 13.5px;
  line-height: 1.6;
}
.msg.user .bubble {
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white, #fff);
  border-bottom-right-radius: 4px;
}
.msg.assistant .bubble {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-bottom-left-radius: 4px;
}
.bubble-text :deep(.cite) {
  font-size: 11px;
  vertical-align: super;
  text-decoration: none;
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.typing {
  color: var(--vp-c-text-3);
  font-size: 13px;
}

.sources {
  list-style: none;
  margin: 10px 0 0;
  padding: 8px 0 0;
  border-top: 1px dashed var(--vp-c-divider);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sources a {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  text-decoration: none;
  padding: 3px 4px;
  border-radius: 6px;
}
.sources a:hover {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-brand-1);
}
.src-n {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
  font-size: 10px;
  text-align: center;
  line-height: 16px;
}
.src-title {
  font-weight: 600;
  color: var(--vp-c-text-1);
}
.src-heading {
  color: var(--vp-c-text-3);
}

.local-panel {
  padding: 12px 14px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.notice {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0 0 10px;
}
.notice code {
  font-size: 11.5px;
}
.notice.warn {
  color: var(--vp-c-warning-1, var(--vp-c-text-1));
}
.notice.error {
  color: var(--vp-c-danger-1);
}
.enable-btn {
  width: 100%;
  padding: 8px 14px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 8px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white, #fff);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.enable-btn:hover {
  background: var(--vp-c-brand-2);
}
.load-text {
  font-size: 12.5px;
  color: var(--vp-c-text-2);
  margin: 0 0 8px;
}
.progress {
  height: 6px;
  border-radius: 999px;
  background: var(--vp-c-default-soft);
  overflow: hidden;
}
.bar {
  height: 100%;
  background: var(--vp-c-brand-1);
  transition: width 0.2s;
}
.load-hint {
  font-size: 11.5px;
  color: var(--vp-c-text-3);
  margin: 8px 0 0;
}

.chat-input {
  display: flex;
  gap: 8px;
  padding: 10px 12px 4px;
  border-top: 1px solid var(--vp-c-divider);
}
.chat-input textarea {
  flex: 1;
  resize: none;
  max-height: 120px;
  padding: 8px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13.5px;
  font-family: inherit;
  line-height: 1.5;
}
.chat-input textarea:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}
.chat-input button {
  flex: none;
  width: 38px;
  border: none;
  border-radius: 8px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-white, #fff);
  font-size: 18px;
  cursor: pointer;
}
.chat-input button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.disclaimer {
  font-size: 10.5px;
  color: var(--vp-c-text-3);
  text-align: center;
  margin: 4px 0 8px;
  padding: 0 12px;
}

@media (max-width: 480px) {
  .chat-panel {
    right: 8px;
    left: 8px;
    width: auto;
    bottom: 76px;
  }
}
</style>
