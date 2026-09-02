// Watch mode: rebuilds dist/ whenever a source file changes, so a reload in
// chrome://extensions picks up the change without re-running the build by hand.
// Run via `npm run extension:dev`.
//
// Rebuilds everything rather than only the changed entry: a full build is well
// under a second, and the nine standalone bundles share source files
// (src/shared/**, @piwitests/core, @piwitests/picker-dom), so mapping a changed
// file back to just the bundles that import it would be both slower to get
// right and easy to get subtly wrong.
import { watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildExtension } from './build.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Everything the build reads. `dist/` is deliberately absent — watching the
// build's own output would retrigger it forever.
const WATCHED = ['src', 'public', 'popup.html', 'options.html', 'manifest.json'];
const DEBOUNCE_MS = 80;

let timer = null;
let building = false;
let queued = false;

async function rebuild() {
  if (building) {
    queued = true;
    return;
  }
  building = true;
  const startedAt = Date.now();
  try {
    await buildExtension();
    console.log(`[${new Date().toLocaleTimeString()}] rebuilt in ${Date.now() - startedAt}ms`);
  } catch (error) {
    // Keep watching after a failed build — a syntax error mid-edit shouldn't
    // kill the session; the next save should be able to fix it.
    console.error(`[${new Date().toLocaleTimeString()}] build failed:`, error.message);
  } finally {
    building = false;
    if (queued) {
      queued = false;
      void rebuild();
    }
  }
}

function scheduleRebuild() {
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), DEBOUNCE_MS);
}

await rebuild();

for (const target of WATCHED) {
  watch(path.join(root, target), { recursive: true }, scheduleRebuild);
}

console.log(`Watching ${WATCHED.join(', ')} — Ctrl+C to stop.`);
console.log('Reload the extension at chrome://extensions after a rebuild to pick up changes.');
