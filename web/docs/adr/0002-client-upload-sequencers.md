# Split the client upload flows into DOM-free sequencers behind an observer seam

Status: accepted (2026-06-17)
Scope: `web/src/app.ts`, new `web/src/upload/`, `web/tests/app.test.ts`, new `web/tests/upload/`

The browser's `ImageUploader` class (`app.ts`, ~1231 lines) owned everything: DOM wiring, form reading, all four providers' multi-file upload flows, fetch calls, burst/progressive sequencing, rate-limit countdown, and result rendering. Because the class exported nothing, `tests/app.test.ts` shipped a hand-maintained `ImageUploaderTestable` copy (~303 lines) that drifted from production and tested none of the real sequencing logic. This is the client-side form of the duplication sickness ADR-0001 cured server-side.

## Decision

- **A new layer, not a reuse of `src/providers/`.** The client upload flows become DOM-free modules under `web/src/upload/` — one per provider. These are distinct from the server-side provider proxy runtime in `src/providers/`: the server modules talk to the upstream provider API and return a `ProviderResult`; the client sequencers drive *our own proxy*, do multi-file/URL sequencing, and emit incremental results through an observer. They cannot share code because their fetch targets, responsibilities, and I/O shapes differ.
- **Observer seam + injectable fetch.** Each sequencer is `uploadToX(input, observer, fetchFn)`. `UploadObserver` has four events: `onResult(result, index)`, `onProgress(percent, label)`, `onRateLimitWait(secondsRemaining)` (0 = resumed, remove the notice), `onDone(results)`. The sequencer owns the canonical `results` array; the class implements the observer as a bridge to its rendering methods.
- **`onRateLimitWait` is the sequencing/rendering boundary for the rate-limit notice.** sxcu's rate-limit warning banner is a DOM element with create/update/scroll/remove lifecycle driven by sequencing events. The sequencer emits `onRateLimitWait` on each countdown tick and on resume; the class manages the DOM element. This keeps the triggering (a sequencing decision) testable in node and the rendering (DOM mutation) in the class.
- **Class keeps DOM wiring, rendering, and pre-flight form checks.** `init`/event listeners, `updateUI`, `addFiles`, the rendering methods (`updateProgress`, `addIncrementalResult`, `displayResults`, `showError`, `setLoading`), and `handleSubmit`'s pre-flight validation (no-files, imgchest anonymous+postId conflict) stay. The four `uploadTo*` methods shrink to: build the `UploadInput` from form state, call the sequencer with the class's observer and `fetch`.
- **Validation helpers stay shared in `types.ts`.** `validateImgchestFiles`, `validateKekFiles`, and the extension/size constants are imported by both the client and the hosts (server/worker/DO). They are not client-owned. The imgchest file-validation *call* moves from the class into the imgchest sequencer (it's a property of that upload), but the helper itself stays in `types.ts`.
- **Behavior-preserving by construction.** Every fork in the extracted flows reproduces existing semantics exactly. Three imgchest failure forks are called out as explicit preservation requirements (see below).

## The non-obvious part: the three imgchest failure forks

These are easy to accidentally flatten into "always continue on error." They must not be.

- **`uploadImgchestProgressive` (no postId):** if the *first* file fails (no `currentPostId`, `index === 0`), the whole upload **stops** and calls `displayResults` immediately. If a later file fails, it **continues** to the next file.
- **`uploadImgchestProgressiveAddToPost`:** **always** continues on error — no first-file special case.
- **`uploadImgchestBatch`:** single request, so error = whole batch fails; no per-file continuation.

Each fork gets a dedicated sequencer test.

## Considered options (rejected)

- **Reuse `src/providers/*` from the client.** Rejected: those modules target the upstream provider API, have no multi-file sequencing or incremental rendering, and return a `ProviderResult` (final status + body + rate-limit headers) rather than an event stream. They solve a different problem at a different layer.
- **Async-generator seam (`async function*` yielding events).** Rejected: every existing flow is callback/Promise-chain based (sxcu burst + countdown, imgchest progressive), and forcing them through a generator would be a gratuitous rewrite of working logic, not a mechanical extraction.
- **Return-all-results (`Promise<UploadResult[]>`).** Rejected: drops the incremental-result UX (`addIncrementalResult` streaming results in as each file lands), which is a real feature, not ceremony.
- **Leave the rate-limit notice DOM code inside the sxcu sequencer.** Rejected: violates the DOM-free seam — the sequencer wouldn't be node-testable, which is candidate-4's whole point.
- **A generic `onNotice(kind, text)` event.** Rejected: rate-limit-wait is the only transient notice in the codebase; one purpose-built event beats a speculative dispatcher (YAGNI).
- **Put sequencers under `src/providers/client/`.** Rejected: `providers/` semantically means "talks to an upstream provider API" (per `CONTEXT.md`); the client sequencers drive our proxy. Co-locating them would blur the layer boundary.

## Consequences

- `app.ts` shrinks substantially; the four `uploadTo*` methods become one-line delegators. The class exports `ImageUploader` (it previously exported nothing — the root defect that forced the test copy).
- The `ImageUploaderTestable` copy in `tests/app.test.ts` is deleted entirely. Sequencer behavior is tested directly in node via a `RecordingObserver` and injected `fetch`; DOM-only class behavior is tested in jsdom against the real class.
- sxcu's countdown and inter-burst pacing get real coverage for the first time (fake timers). The three imgchest failure forks get dedicated tests.
- ADR-0001 (server-side collapse) is untouched; this is a different layer and a different seam.
- Candidate-5 (real Worker/DO runtime via `@cloudflare/vitest-pool-workers`) remains deferred as ADR-0001 records.
