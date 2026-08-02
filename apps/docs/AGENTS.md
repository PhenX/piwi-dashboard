# Documentation site — agent guide

Rules for working inside `apps/docs/` (the VitePress site published to GitHub Pages). Read [`../AGENTS.md`](../AGENTS.md)
first — in particular the **cross-platform shell commands** rule, which applies to every snippet on this site.

```bash
npm run docs:dev      # local preview (runs docs:gen first)
npm run docs:build    # production build (runs docs:gen first)
npm run docs:gen      # regenerate the derived pages only
```

## Two pages are generated — never edit them by hand

### `apps/docs/configuration.md`

Built from the typed env-var registry (`apps/application/shared/piwi-env-vars.ts`) by
`apps/docs/scripts/generate-configuration.mjs`. The file is **gitignored** and rebuilt by `docs:gen`.

- To change a variable's name, description, default or category → edit the **registry**.
- To change section prose or ordering → edit `PIWI_ENV_CATEGORIES` (title/intro/note/order; `mergeInto` folds one
  category's table into another; `internal` hides harness-only vars).
- The interactive generator at `/configuration/generator` reads the **same registry** through the `#shared` Vite alias
  wired in `apps/docs/.vitepress/config.mts`, and emits output through the pure emitters in `apps/application/shared/env-format.ts`
  (unit-tested quoting for .env / compose / docker run / K8s / systemd / shell). Change the emitters, not the markup.
- Keep the section anchors stable (`#general`, `#wasted-time` are deep-linked from the app and other pages).

### The API reference

There is **no `apps/docs/api.md`, and you must not create one.** The auto-generated OpenAPI spec (`/_openapi.json`) and the
self-contained in-app reference at `/docs` in the running app are the single source of truth for API documentation —
the in-app page renders the spec with no third-party CDN, so it works offline and air-gapped.

When documenting a feature here, link to `[API docs](/docs)` (self-hosted) or the live demo
(`https://piwitests.github.io/demo/docs`) rather than inlining endpoint descriptions. Endpoint documentation is
authored in the handler's `defineRouteMeta({ openAPI: … })` block — see
[`../application/AGENTS.md`](../application/AGENTS.md#openapi-annotations).

## Site structure (MUST follow)

The sidebar in `.vitepress/config.mts` is ordered by the **reader's journey**, not by feature. A new page goes in the
group matching what the reader is doing, and each page stays single-purpose:

| Group | Covers | Pages |
|---|---|---|
| Start here | what it is, first run, vocabulary | `getting-started`, `concepts`, `comparison` |
| Sending results | getting data in | `reporter`, `capture-fixtures`, `ci`, `backend-logs` |
| Reading the results | using the dashboard | `ui-overview`, `ai-diagnosis`, `flaky-tests`, `analytics`, `timeline-markers`, `notifications`, `ide-integration` |
| Running your instance | operating it | `deployment`, `configuration`, `configuration/generator`, `authentication`, `storage`, `privacy`, `desktop` |
| Recipes | task-first walkthroughs | `recipes/` |
| Integrate | other tools | in-app API docs (external link), `mcp` |

Extend an existing page before adding a new one.

### `recipes/` — the one task-first group

Every other group is organised by feature. `recipes/` is organised by the question a reader arrives
with ("did I break this, or is it flaky?"), and each page crosses several features to answer one. It
exists for the long-tail searches that never contain the word "Piwi", so:

- **One question per page**, phrased as the reader would phrase it — that phrasing is the H1.
- **Feature pages stay the source of truth.** A recipe links to them; it never becomes a second place
  where the flaky score or the fingerprint algorithm is explained, because that copy will drift.
- **Always give a route for readers who can't install the thing.** State what a step requires (capture
  fixtures, an LLM key, an unpacked extension, a signed-installer-less desktop build) and offer the
  alternative — dashboard, MCP, REST API, or plain trace evidence. Listing a requirement without an
  alternative is the failure mode to avoid.
- Recipes reuse **existing committed screenshots**; add a scene to the feature-screenshot harness only
  if a recipe genuinely needs a screen no page shows yet.

- **`concepts.md` is the vocabulary source of truth** — project / test run / **test case** (a test's identity across
  time) / **execution** (one attempt, one browser — the `test_runs_cases` row) / failure cluster / fingerprint /
  baseline. Use those words consistently in docs *and* UI copy; link the anchor instead of redefining a term.
- **`ui-overview.md` is a map, not a manual** — one short paragraph per view plus a link to the page that explains the
  concept. Feature explanations belong on the feature page.
- **Contributor material does not belong on this site.** Build steps, source layout, migration workflow and dev
  commands live in `CONTRIBUTING.md` / `AGENTS.md` / `packages/reporter/ARCHITECTURE.md`. The site is for people *using* Piwi.
- **Every user-visible reporter option** must appear in `reporter.md`'s options table (and its `PIWI_*` var in the
  table below it) in the same change that adds it to `packages/reporter/src/public/options.ts`.
- **In-app help links point here.** `apps/application/app/utils/help-content.ts` builds docs URLs from `doc:` string
  literals that nothing validates — renaming a heading breaks them silently. Grep for the old anchor when you rename
  one.

## Writing conventions

- Update the affected page **in the same commit** as the code change; commit scope `docs`.
- American English, sentence-case headings, and the shell-portability rule from the root guide: VitePress uses
  `::: code-group` with ```bash [Linux / macOS] + ```powershell [Windows (PowerShell)] tabs when a command has no
  portable single form.
- Diagrams are theme-aware SVG assets under `apps/docs/public/` — commit the asset rather than embedding a large inline
  `<svg>` in prose.

### Voice

Informative, specific, honest — never promotional. Piwi is not a product being sold. The canonical positioning line
and the seven surfaces that must carry it are in the [root guide](../AGENTS.md#documentation).

- **Banned**: conversion CTA blocks ("Stop losing your…" + buttons), `for-the-badge` call-to-action badges, "try it
  now" / pointing-hand CTAs, competitor feature tables with a **Price** row in the README (honest prose comparison
  belongs in `comparison.md`), vanity badges (stars), superlatives ("powerful", "seamless", "unlock",
  "best-in-class"), and more than ~8 feature bullets or cards on any one page — past that nobody reads them.
- **Prefer the concrete over the categorical**: "groups forty red tests into three root causes" beats "observability
  platform". Name a number, a behavior, or a limit.
- **State limits plainly.** Playwright-only, pre-1.0, and "not the right tool if…" belong in the README and on the
  landing page. Trust is the point, not a caveat to bury.

## Marketing screenshots

Hero images in `apps/docs/public/screenshots/*.png` are **1280×720**, with a diagonal light-top-left / dark-bottom-right
split. Capture them against the **live demo** (it already has seed data — no local server needed) using the
`playwright-cli` skill:

1. **Capture both themes at the same viewport and scroll position** so they align pixel-for-pixel. Resize to
   `1280 720`, load `https://piwitests.github.io/demo/`, hide the demo banner by injecting
   `.demo-banner{display:none!important}`, and screenshot. Then switch theme with the `nuxt-color-mode` localStorage
   key, reload, re-hide the banner, and screenshot again.
2. **Composite the split.** `playwright-cli` blocks `file://` and `run-code` has no `require`, so serve the two PNGs
   plus a small overlay page over a throwaway local HTTP server and screenshot the stage element. The overlay stacks
   both images at 1280×720 and clips the dark one to the bottom-right triangle, with an SVG seam line:

   ```html
   <div id="stage" style="position:relative;width:1280px;height:720px">
     <img src="hero-light.png" style="position:absolute;inset:0;width:1280px;height:720px">
     <img src="hero-dark.png"  style="position:absolute;inset:0;width:1280px;height:720px;clip-path:polygon(100% 0,100% 100%,0 100%)">
     <svg width="1280" height="720" style="position:absolute;inset:0;pointer-events:none">
       <line x1="1280" y1="0" x2="0" y2="720" stroke="rgba(0,0,0,.35)" stroke-width="4"/>
       <line x1="1280" y1="0" x2="0" y2="720" stroke="rgba(255,255,255,.85)" stroke-width="1.5"/>
     </svg>
   </div>
   ```

3. **Clean up** the temporary PNGs, the overlay page and the server. For a non-split refresh, skip step 2 and use a
   single capture.

Demo *evidence* media (the screenshots, traces and videos shown inside the product) is a different pipeline — see
[`../application/AGENTS.md`](../application/AGENTS.md#demo-evidence-media-committed-binaries).

**Feature illustrations** (a docs page showing a specific screen, including desktop-only UI the live demo cannot
render) come from the feature-screenshot harness instead: from `apps/application/`, run
`node scripts/take-feature-screenshots.mjs <scene> --out ../docs/public/screenshots` — add a scene to its `SCENES`
registry if none fits (desktop UI is captured through the script's mocked Tauri bridge, no shell build needed). Images
written into docs assets this way are committed; keep the scene in the script current so the illustration can be
re-captured when the UI changes.
