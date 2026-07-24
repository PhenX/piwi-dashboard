# Documentation site — agent guide

Rules for working inside `docs/` (the VitePress site published to GitHub Pages). Read [`../AGENTS.md`](../AGENTS.md)
first — in particular the **cross-platform shell commands** rule, which applies to every snippet on this site.

```bash
npm run docs:dev      # local preview (runs docs:gen first)
npm run docs:build    # production build (runs docs:gen first)
npm run docs:gen      # regenerate the derived pages only
```

## Two pages are generated — never edit them by hand

### `docs/configuration.md`

Built from the typed env-var registry (`application/shared/piwi-env-vars.ts`) by
`docs/scripts/generate-configuration.mjs`. The file is **gitignored** and rebuilt by `docs:gen`.

- To change a variable's name, description, default or category → edit the **registry**.
- To change section prose or ordering → edit `PIWI_ENV_CATEGORIES` (title/intro/note/order; `mergeInto` folds one
  category's table into another; `internal` hides harness-only vars).
- The interactive generator at `/configuration/generator` reads the **same registry** through the `#shared` Vite alias
  wired in `docs/.vitepress/config.mts`, and emits output through the pure emitters in `application/shared/env-format.ts`
  (unit-tested quoting for .env / compose / docker run / K8s / systemd / shell). Change the emitters, not the markup.
- Keep the section anchors stable (`#general`, `#wasted-time` are deep-linked from the app and other pages).

### The API reference

There is **no `docs/api.md`, and you must not create one.** The auto-generated OpenAPI spec (`/_openapi.json`) and the
self-contained in-app reference at `/docs` in the running app are the single source of truth for API documentation —
the in-app page renders the spec with no third-party CDN, so it works offline and air-gapped.

When documenting a feature here, link to `[API docs](/docs)` (self-hosted) or the live demo
(`https://piwitests.github.io/demo/docs`) rather than inlining endpoint descriptions. Endpoint documentation is
authored in the handler's `defineRouteMeta({ openAPI: … })` block — see
[`../application/AGENTS.md`](../application/AGENTS.md#openapi-annotations).

## Writing conventions

- Update the affected page **in the same commit** as the code change; commit scope `docs`.
- American English, sentence-case headings, and the shell-portability rule from the root guide: VitePress uses
  `::: code-group` with ```bash [Linux / macOS] + ```powershell [Windows (PowerShell)] tabs when a command has no
  portable single form.
- Diagrams are theme-aware SVG assets under `docs/public/` — commit the asset rather than embedding a large inline
  `<svg>` in prose.
- Subject-matter pages that already exist: getting started, deployment, configuration, storage, authentication,
  notifications, reporter, capture fixtures, AI diagnosis, flaky tests, timeline markers, MCP, IDE integration,
  desktop, backend logs, UI overview, comparison. Extend one before adding a new page.

## Marketing screenshots

Hero images in `docs/public/screenshots/*.png` are **1280×720**, with a diagonal light-top-left / dark-bottom-right
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
