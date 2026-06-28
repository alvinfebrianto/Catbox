# Add a Workers-runtime test lane for the real Worker ↔ Durable Object seam

Status: accepted (2026-06-28)
Scope: `web` — `vitest.config.ts`, `tsconfig.json`, `package.json`, new `tests/worker-runtime/`

ADR-0001 collapsed the provider proxy runtime and deliberately kept the rate-limit engine *inside* the `RateLimiter` Durable Object for per-IP atomicity, leaving one follow-up open: the Worker ↔ DO seam that the atomicity argument depends on was only ever exercised by Node Vitest against a **hand-built mock DO namespace** (`tests/worker.test.ts`'s `createMockDurableObject`). The forwarding shape was tested, but `workerd`, the real `RATE_LIMITER` binding, real `DurableObjectStorage` (SQLite), and the request context were not — so the production implementation could drift while the Node suite stayed green. ADR-0001, ADR-0002, ADR-0003, and ADR-0004 all explicitly recorded this as the remaining architecture-review candidate (the "Promote the Worker/DO seam into a real runtime test adapter" candidate). This ADR closes it.

## Decision

- **A second test lane, not a replacement.** The fast Node/jsdom suites stay exactly as they are (pure functions, sequencers, the upload-endpoint module, the host-scoped concerns). A new lane runs **only** the Worker + DO seam inside `workerd` via `@cloudflare/vitest-pool-workers`. The two lanes are Vitest `projects` in a single `vitest.config.ts`, so `pnpm test` runs both; `pnpm test:workers` runs just the runtime lane.
- **`@cloudflare/vitest-pool-workers` `0.16.20`, configured with the current `cloudflareTest()` plugin API.** This version's plugin is `cloudflareTest(options)` imported from `@cloudflare/vitest-pool-workers` (the older `defineWorkersConfig` from `…/config` is gone), and requires `vitest@^4.1.0` — which the repo already had (`vitest ^4.1.8`). The workers project sets `main: './src/worker.ts'` so the **TypeScript source** Worker (and its exported `RateLimiter` DO class) runs through Vite transforms, rather than the built `dist/worker.js` the deploy uses.
- **Test-only runtime config stays out of production `wrangler.toml`.** `nodejs_compat` (needed by the pool's in-`workerd` test runner) and a test `IMGCHEST_API_TOKEN` binding are supplied through the plugin's `miniflare` option, not added to `wrangler.toml`. The DO binding and the `new_sqlite_classes` migration are read from the existing `wrangler.toml`, so the test runs against the real production binding/migration definition.
- **The seam is proven both end-to-end and at the DO boundary.** Two complementary access styles:
  - `SELF.fetch()` drives the full production topology (Worker route fall-through → `RATE_LIMITER` binding → DO `fetch` → `handleUploadRequest` → provider), asserting the Worker's `Authorization`/`X-Origin` injection actually threads through the DO to the upstream call, and that the DO's response passes back through.
  - `env.RATE_LIMITER.get(idFromName(...))` + `runInDurableObject(stub, (instance, state) => …)` reads the DO's **real SQLite storage** directly to assert the engine persisted rate-limit state, and seeds storage to assert the in-DO engine reads it back and fail-fast blocks an `sxcu` upload **without** calling upstream.
- **Upstream provider calls are mocked via `globalThis.fetch`, not a binding mock.** The providers resolve their `fetch` through `getDefaultFetch()` (`globalThis.fetch`) at call time, and `SELF`/direct-DO code runs in the same isolate as the test runner, so a `vi.spyOn(globalThis, 'fetch')` that matches `api.imgchest.com`/`sxcu.net` (and falls through to the real `fetch` for everything else) is sufficient. This matches the pool's guidance after `fetchMock` was removed from `cloudflare:test`.

## The non-obvious part: this lane adds evidence, it does not move the engine

It would be tempting to use the new runtime confidence to "simplify" ADR-0001 by moving the engine to the Worker and making the DO a pure store. **This ADR does not do that and is not a license to.** The lane exists precisely to *protect* ADR-0001's placement: the fail-fast-from-persisted-state test is the first automated proof that the check-then-call sequence runs inside the DO's single execution context against real storage. Removing that property would now break a test, which is the point.

## Considered options (rejected)

- **Convert the whole suite to the workers pool.** Rejected: `tests/app.test.ts` is jsdom and the rest are Node pure-function tests that have no reason to pay `workerd` startup cost; the review explicitly asked for a *small second lane*. Custom Vitest `environment`/`runner` (e.g. jsdom) is also unsupported under the workers pool.
- **Keep the mock DO namespace and add assertions there.** Rejected: a richer mock is still not `workerd`, still not real SQLite, and still drifts from production — the exact gap this candidate names.
- **Add `nodejs_compat` / test token to `wrangler.toml`.** Rejected: they are test-runtime concerns; putting them in the deploy config changes production surface for no production reason. They live in the test `miniflare` config instead.
- **Test against `dist/worker.js`.** Rejected: that requires a build step before tests and tests stale output; pointing the pool at `src/worker.ts` tests the source of truth with Vite transforms.
- **Use `cloudflare:workers` `env`/`exports` instead of `cloudflare:test` `env`/`SELF`.** The newer imports are what `0.16.20` recommends (the `cloudflare:test` ones carry `@deprecated` JSDoc), but their ambient types are not provided by the repo's pinned `@cloudflare/workers-types`. Kept the still-functional `cloudflare:test` imports to avoid a types bump unrelated to this candidate; revisit when `@cloudflare/workers-types` is upgraded.

## Consequences

- `vitest.config.ts` now defines two projects (`node`, `workers`); the `node` project excludes `tests/worker-runtime/**`, the `workers` project includes only it.
- `tsconfig.json` adds `@cloudflare/vitest-pool-workers/types` to `types` so `cloudflare:test` resolves under `tsc --noEmit`. A `tests/worker-runtime/env.d.ts` augments `Cloudflare.Env` with the `RATE_LIMITER` binding and the test token.
- `package.json` gains the `@cloudflare/vitest-pool-workers` dev dependency and a `test:workers` script.
- `tests/worker-runtime/worker-do-seam.test.ts` is the new evidence: Worker→DO forwarding for imgchest and sxcu, real-storage persistence, and in-DO fail-fast enforcement.
- Follow-ups still open (out of scope here, and explicitly gated behind this lane): review candidate-4 (consolidate static provider capability rules used by the browser UI and sequencers) and candidate-5 (deepen result rendering inside `ImageUploader`). Neither is unblocked or blocked by this change.
