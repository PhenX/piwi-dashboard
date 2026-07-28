// Builds the extension into dist/. Content scripts and the background
// service worker are each built as a standalone IIFE (no shared chunks) via
// Vite's library mode, since chrome.scripting.executeScript({ files: [...] })
// injects them as plain classic scripts with no module resolution — unlike
// popup.html, which is loaded as a normal extension page and gets Vite's
// standard (chunk-splitting-friendly) HTML-entry build.
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'dist');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

async function buildStandalone(name, entry) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      lib: { entry: path.join(root, entry), formats: ['iife'], name: `Piwi_${name}`, fileName: () => `${name}.js` },
      rollupOptions: { output: { extend: true } },
    },
  });
}

await buildStandalone('pick', 'src/content/pick.ts');
await buildStandalone('hover-inspect', 'src/content/hover-inspect.ts');
await buildStandalone('locator-console', 'src/content/locator-console.ts');
await buildStandalone('multi-pick', 'src/content/multi-pick.ts');
await buildStandalone('background', 'src/background/index.ts');

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: false,
    rollupOptions: { input: path.join(root, 'popup.html') },
  },
});

const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
cpSync(path.join(root, 'public', 'icons'), path.join(outDir, 'icons'), { recursive: true });

console.log(`Built extension into ${path.relative(process.cwd(), outDir)}`);
