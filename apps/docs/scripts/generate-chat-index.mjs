/**
 * Generates apps/docs/public/chat-index.json — the knowledge base the in-docs
 * chat widget retrieves over (see .vitepress/theme/chat/retrieval.ts).
 *
 * Every published Markdown page is split into heading-anchored chunks so a
 * question can be answered from a single section and linked straight to it.
 * The file is a build artifact (gitignored): `docs:gen` runs this after the
 * configuration reference is generated, so the index always covers the whole
 * site — including the generated pages — and can never drift from the prose.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = join(here, '..');

/** Directories and files that are not reader-facing pages. */
const SKIP_DIRS = new Set(['.vitepress', 'node_modules', 'public', 'scripts']);
const SKIP_FILES = new Set(['AGENTS.md']);

/** Collect every Markdown page under the docs root. */
function collectMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry) && !entry.startsWith('.')) out.push(...collectMarkdown(full));
    } else if (entry.endsWith('.md') && !SKIP_FILES.has(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Map a file path to the site route VitePress serves it at. */
function routeFor(file) {
  const rel = relative(docsRoot, file).replace(/\\/g, '/').replace(/\.md$/, '');
  if (rel === 'index') return '/';
  return '/' + rel.replace(/\/index$/, '/');
}

/** GitHub-style heading slug, matching VitePress anchor ids. */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Strip YAML frontmatter and return { title, body }. */
function splitFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { title: undefined, body: raw };
  const title = match[1].match(/^title:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  return { title, body: raw.slice(match[0].length) };
}

/**
 * Reduce Markdown to searchable plain text: drop code fences, HTML tags,
 * images and containers, and flatten links to their visible text. Retrieval
 * scores prose, not syntax, so the noise only hurts.
 */
function toPlainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/^:::.*$/gm, ' ') // VitePress containers (::: tip / :::)
    .replace(/<[^>]+>/g, ' ') // inline HTML / Vue components
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → link text
    .replace(/`([^`]+)`/g, '$1') // inline code → its text
    .replace(/^[#>\s]*#{1,6}\s*/gm, '') // leftover heading markers
    .replace(/[*_~]/g, '') // emphasis
    .replace(/^\s*[-*+]\s+/gm, '') // list bullets
    .replace(/^\s*\|.*\|\s*$/gm, (row) => row.replace(/\|/g, ' ')) // table pipes
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Split a page body into chunks at each `##`/`###` heading. The text before
 * the first heading becomes an intro chunk anchored to the page itself.
 */
function chunkPage(body, { title, route }) {
  const lines = body.split('\n');
  const chunks = [];
  let heading = title ?? route;
  let anchor = '';
  let buffer = [];

  const flush = () => {
    const text = toPlainText(buffer.join('\n'));
    if (text.length >= 40) {
      chunks.push({
        title: title ?? heading,
        heading,
        url: anchor ? `${route}#${anchor}` : route,
        text,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const h = line.match(/^(#{2,3})\s+(.*)$/);
    if (h) {
      flush();
      heading = h[2].replace(/[`*_~]/g, '').trim();
      anchor = slugify(h[2]);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return chunks;
}

const files = collectMarkdown(docsRoot).sort();
const chunks = [];
for (const file of files) {
  const { title, body } = splitFrontmatter(readFileSync(file, 'utf8'));
  const route = routeFor(file);
  for (const chunk of chunkPage(body, { title, route })) {
    chunks.push({ id: chunks.length, ...chunk });
  }
}

const index = { generatedFrom: files.length, chunks };
const outDir = join(docsRoot, 'public');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'chat-index.json'), JSON.stringify(index));
console.log(`generated apps/docs/public/chat-index.json — ${chunks.length} chunks from ${files.length} pages`);
