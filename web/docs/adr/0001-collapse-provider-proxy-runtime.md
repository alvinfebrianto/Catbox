# Collapse the provider proxy runtime into a layered engine + providers

Status: accepted (2026-06-15)
Scope: `web/src` — `server.ts`, `worker.ts`, `rate-limiter.ts`, new `providers/`, new `rate-limit/`

The provider proxy runtime — upload orchestration, response parsing, retry, and rate-limit behaviour — was duplicated across the Node server (`server.ts`), the Cloudflare Worker (`worker.ts`), and the Durable Object (`rate-limiter.ts`), and had already drifted (catbox `validReqTypes`, kek env fallback, sxcu/imgchest validation, fire-and-forget DO persistence). We are collapsing it into one layered set of modules shared by all three hosts.

## Decision

- **Layered, not monolithic.** A rate-limit/retry engine plus separate per-provider upload modules, rather than one deep module. The two stateless providers (catbox, kek) have no rate-limit state and must not be coupled to the engine.
- **`RateLimitStore` seam.** `load(): Promise<AllRateLimits>` / `save(state): Promise<void>`. Whole-object granularity (matches both existing stores). Three implementations: file-backed (Node), Durable-Object-backed (production), in-memory (tests). Making `save` awaitable also fixes the DO's existing fire-and-forget persistence bug.
- **Engine is policy-parametric.** The sxcu vs imgchest divergence is expressed as a `RateLimitRetryPolicy` data value (`onPreFlightBlocked`, `onResponse429` ∈ `{retry, return}`), not `if (provider === 'sxcu')` branches inside the loop. sxcu fails fast on both forks; imgchest waits and retries. The engine returns a tagged-union result (`ok | rate-limited | error`) and never constructs an HTTP `Response`.
- **One `withRetry` loop.** The retry loop exists once; stateless providers use it directly, the rate-limit engine layers policy + store on top of it. The kek mature-PUT stays best-effort inside `providers/kek.ts`.
- **Inject `fetch`; providers return a plain `ProviderResult`.** Each provider function takes an injectable `fetch` (default global) and returns `{ status, body, rateLimitHeaders }`. The runtime host shapes the `Response` — CORS, content-type, and a shared `forwardRateLimitHeaders` helper — so the engine and providers stay HTTP-shape-agnostic.
- **Engine stays inside the Durable Object for imgchest/sxcu.** See below.

## The non-obvious part: the engine stays in the Durable Object

This is the decision most likely to be "simplified" away, so it gets called out explicitly.

A natural-looking refactor would move the engine to the Worker and reduce the Durable Object to a pure `RateLimitStore` reached via RPC (one `check` call, the fetch, one `update` call). **We deliberately did not do this.** The per-client-IP Durable Object exists to *serialize* rate-limit checks for that IP on a single thread: `check()` and `update()` run in the same execution context with no interleaving. If the engine moves to the Worker, the check-then-fetch-then-update window becomes non-atomic, and two simultaneous uploads from the same IP can both pass the pre-flight check and both consume the bucket. The rate limit degrades from an enforcement to a hint. For sxcu — whose entire purpose is avoiding a global ban — that is a correctness regression, not an optimization.

Keeping the engine in the DO preserves per-IP single-flight atomicity. The refactor only swaps the DO's inlined engine copy for the shared engine module bound to a `DurableObjectRateLimitStore`; the request topology is unchanged.

If this is ever revisited, do it in an ADR that addresses the atomicity gap — most likely by giving the store a single atomic `checkAndReserve` RPC rather than splitting check from update.

## Considered options (rejected)

- **Single deep module** bundling provider orchestration and the engine. Rejected: forces stateless providers through engine/store machinery they don't need, or reintroduces conditional branches inside the "deep" module.
- **Low-level key/value `RateLimitStore`** mirroring `DurableObjectStorage`. Rejected: the engine would have to re-derive the `AllRateLimits` shape from scattered keys, losing the single-transaction coalesce the current blob persistence relies on. Available later as an internal optimization without changing the interface.
- **Engine in the Worker, DO as pure store.** Rejected for the atomicity reason above.
- **Each provider owns its own retry loop.** Rejected: the loop is the most error-prone, most-duplicated piece (~90 lines, 6 copies); pushing it back out to N callers resurrects the problem this ADR exists to solve.

## Consequences

- `rate-limiter.ts` shrinks from ~767 lines to a thin DO: construct a `DurableObjectRateLimitStore` from `ctx.storage`, construct an engine bound to it, route `/upload/imgchest/*` and `/upload/sxcu/*` to the shared provider modules, shape the `ProviderResult` into a `Response`.
- `server.ts` and `worker.ts` shrink correspondingly; all `check*`/`update*`/`executeWithRateLimitRetry`/`cleanupExpiredEntries`/`isSxcuGlobalError` logic deletes from the hosts and lives once in the engine.
- The engine and each provider become directly unit-testable via `MemoryRateLimitStore` and an injected `fetch`, without monkeypatching `globalThis.fetch`. The sxcu-vs-imgchest policy fork gets direct coverage for the first time.
- A follow-up (architecture review candidate-5) remains open: add `@cloudflare/vitest-pool-workers` to exercise the real Worker + DO runtime seam, including SQLite storage.
- Proxy auth on the Worker (an `X-Proxy-Auth` / `PROXY_AUTH_TOKEN` check) is explicitly out of scope. It previously existed only as assertions in `tests/worker.test.ts` against a hand-built mock DO — the real `worker.ts` has never implemented it. Those fantasy assertions are corrected to match actual behavior; adding the check is a separate security task.
