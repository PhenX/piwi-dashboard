/**
 * The one syntax-highlighting setup, shared by the dashboard components and
 * the offline export.
 *
 * Registering languages in each consumer meant the sets drifted — `yaml` was
 * passed by ARIA-snapshot call sites but registered nowhere, so those blocks
 * fell through to auto-detection. Add a language here and every surface gets it.
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = { bash, css, diff, javascript, json, python, typescript, xml, yaml } as const;

for (const [name, language] of Object.entries(LANGUAGES)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
}
// Aliases the codebase actually writes in fences and `lang` props.
if (!hljs.getLanguage('sh')) hljs.registerLanguage('sh', bash);
if (!hljs.getLanguage('ts')) hljs.registerLanguage('ts', typescript);
if (!hljs.getLanguage('js')) hljs.registerLanguage('js', javascript);
if (!hljs.getLanguage('yml')) hljs.registerLanguage('yml', yaml);
if (!hljs.getLanguage('html')) hljs.registerLanguage('html', xml);

/**
 * Auto-detection walks every registered grammar, which is far too slow for a
 * multi-megabyte ARIA snapshot or trace payload.
 */
const MAX_AUTO_DETECT_CHARS = 100_000;

export interface HighlightResult {
  /** HTML with `hljs-*` spans. highlight.js escapes the source, so this is safe to inject. */
  html: string;
  /** The language actually used, or '' when the text was left plain. */
  language: string;
}

export function isKnownLanguage(lang: string | null | undefined): boolean {
  return Boolean(lang && hljs.getLanguage(lang));
}

/**
 * Highlight `code`, honoring an explicit language and falling back to
 * auto-detection. Never throws: an unhighlightable block returns escaped text.
 */
export function highlightCode(code: string, lang?: string | null): HighlightResult {
  try {
    if (lang && hljs.getLanguage(lang)) {
      return { html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, language: lang };
    }
    if (code.length <= MAX_AUTO_DETECT_CHARS) {
      const result = hljs.highlightAuto(code);
      return { html: result.value, language: result.language ?? '' };
    }
  } catch {
    // Fall through to plain escaped text.
  }
  return { html: escapeForPre(code), language: '' };
}

function escapeForPre(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
