# Capture-overhead benchmark

What the capture fixtures cost a suite that uses them. Two harnesses, because the question has two halves:

| Harness | Command | Answers |
|---|---|---|
| End-to-end | `npm run reporter:bench` | "how much slower is my suite" — real browser, real protocol round trips |
| Micro | `npm run reporter:bench:micro` | "where does the worker's CPU go" — no browser, low variance |

Both live here rather than in the Vitest unit suite or the integration project: `vitest.config.ts` excludes
`tests/bench/**` from `reporter:test`, and points `benchmark.include` at the `.bench.ts` file.

## End-to-end (`run.mjs`)

`workload.spec.ts` is one workload — a navigation, two form fills, N clicks that each trigger a fetch, and N web-first
assertions — run under a ladder of capture configurations. Each rung adds one layer, so the gap between neighbors is
the cost of that layer alone:

| Variant | What it adds |
|---|---|
| `baseline` | plain `@playwright/test`, no Piwi fixtures registered |
| `fixtures` | console/network listeners, web vitals, the teardown flush |
| `page-state` | the end-of-test page/storage/cookie read |
| `full` | locator healing capture — the shipped default |

Variants are selected through the same `PIWI_*` env vars users set (`PIWI_CAPTURE_LOCATORS`,
`PIWI_CAPTURE_PAGE_STATE`), and the spec imports `dist/` — the built package is what users install, so that is what
gets benchmarked. Run `npm run reporter:build` first (`reporter:bench` does it for you).

Every variant runs once per round and the rounds repeat, so a machine that drifts drifts across all variants rather
than penalizing whichever ran last. The first round is a warm-up and is discarded.

```bash
npm run reporter:bench                                          # defaults below
node tests/bench/run.mjs --rounds 5 --rows 800 --actions 20      # heavier page, more actions
node tests/bench/run.mjs --only baseline,full --target roleless  # isolate the ARIA snapshot
node tests/bench/run.mjs --json results.json                     # machine-readable
```

| Flag | Default | Meaning |
|---|---|---|
| `--rounds` | 3 | measured rounds (plus one discarded warm-up) |
| `--rows` | 200 | table rows on the fixture page — the DOM-size axis |
| `--tests` | 12 | test cases per run |
| `--actions` / `--assertions` | 10 / 10 | captured operations per test |
| `--target` | `role` | `role` (buttons) or `roleless` (plain spans) |
| `--only` | all | comma-separated variant keys |
| `--json` | — | write the aggregated rows to a file |

### Two things worth knowing before reading the output

**DOM size is a primary axis.** The element probe runs several document-wide `querySelectorAll` scans (uniqueness
counts, the role-source scan, the ancestor walk), so capture cost tracks page weight, not just action count. A number
measured at `--rows 50` does not predict `--rows 800`. Run the size you care about.

**Assertions capture once per call site.** The fixtures probe an assertion's target once per source location per test,
so a loop over a single `expect` line would measure one probe however high the count went. `assertVisible` in the
workload is therefore a list of one-per-line callers, mirroring how real suites write assertions. Actions have no such
dedupe — they probe on every call.

## Micro (`hot-path.bench.ts`)

Vitest benches for the Node-side work the fixtures do in the worker process: the stack capture taken on every action,
the Proxy indirection on every locator property access, alternative generation, and the teardown serialization. These
scale with test count rather than page weight, and they run against `src/` with fakes standing in for the browser, so
the browser's variance is out of the picture entirely.

The instrumented-action bench drives the **real** fixtures (`piwiFixtures.page` + `piwiFixtures.piwiCapture`) against a
fake page whose probe resolves immediately — no reimplementation of the hot path to drift out of sync.

## Reference numbers

Measured on the sandbox this was developed in — 4-core Xeon @ 2.10GHz, Node 22.22, Playwright 1.61.1, headless
Chromium. Treat them as shape, not as a spec; re-run on your own hardware for absolute figures.

End-to-end, 12 tests × (10 actions + 10 assertions), 3 rounds, median per test:

| Page size | baseline | + fixtures | + page state | + locator healing | per captured op |
|---|---|---|---|---|---|
| 50 rows (~420 elements) | 591 ms | −1.5% | −2.2% | **+17.7%** | 5.2 ms |
| 200 rows (~1,620 elements) | 663 ms | +2.6% | +2.6% | **+38.7%** | 12.8 ms |
| 800 rows (~6,420 elements) | 1086 ms | +2.1% | +3.7% | **+58.9%** | 32.0 ms |

Everything except locator healing sits in the low single digits and is within run-to-run noise at the small sizes.
Locator healing dominates, and its per-operation cost grows roughly linearly with DOM size.

Splitting that cost with `--target roleless` at 200 rows: 7.4 ms per operation without the ARIA snapshot versus 12.8 ms
with it, so the extra `ariaSnapshot()` round trip each role-bearing capture takes is a bit over 40% of the total.

Micro, per captured operation:

| | mean |
|---|---|
| `captureCallerLocation()` | 53 µs |
| └ `new Error().stack` (capture half) | 40 µs |
| └ walking the stack (parse half) | 4.4 µs |
| `generateAlternatives()` | 1.9 µs |
| `JSON.stringify` of the origin args | 0.3 µs |
| dedupe + serialize 40 snapshots (per test, at teardown) | 58 µs |
| locator property read, bare → through the proxy | 0.07 µs → 0.13 µs |

The Node-side total is ~60 µs per operation — three orders of magnitude below the browser round trips above, so it
never shows up in the end-to-end numbers. Within it, though, materializing the stack for the call-site location is
~88% of the cost, and the parsing this package controls is the remaining 12%.
