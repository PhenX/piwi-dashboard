// Zips dist/ into a store-ready archive (extension/piwi-picker-v<version>.zip)
// — the same zip Chrome Web Store, Edge Add-ons, and Firefox AMO all accept
// unmodified (see PUBLISHING.md). Run via `npm run extension:zip` (builds
// first). Sourcemaps are excluded: useful locally, not meant to ship.
import { createWriteStream, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import archiver from 'archiver';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(root, 'dist');
const { version } = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const outPath = path.join(root, `piwi-picker-v${version}.zip`);

if (existsSync(outPath)) unlinkSync(outPath);

const output = createWriteStream(outPath);
const archive = archiver('zip', { zlib: { level: 9 } });

const done = new Promise((resolve, reject) => {
  output.on('close', resolve);
  archive.on('error', reject);
});

archive.pipe(output);
// `false` as the second arg: zip the contents of dist/ directly at the
// archive root (manifest.json at the top level), not nested in a dist/ folder
// — stores expect the manifest at the zip root.
archive.directory(distDir, false, (entry) => (entry.name.endsWith('.map') ? false : entry));
await archive.finalize();
await done;

console.log(`Zipped extension into ${path.relative(process.cwd(), outPath)}`);
