# catbox/web

A multi-provider image-upload proxy. The browser app uploads to a local Node server (development) or a Cloudflare Worker (production); the server forwards to one of several image-hosting providers, enforcing per-provider rate limits along the way.

## Language

**Provider**:
An external image-hosting service the proxy forwards uploads to. There are four: catbox, kek, sxcu, imgchest.
_Avoid_: host, service, backend, target

**Provider proxy runtime**:
The shared logic that performs an upload to a provider: outbound fetch, response parsing, and retry. Collapsed into one set of modules shared across the Node server, Worker, and Durable Object. It receives an already-shaped provider input (request shaping is the upload endpoint module's job) and returns a ProviderResult.
_Avoid_: upload handler, proxy logic, fetch wrapper

**Rate-limit engine**:
The provider-agnostic machinery that decides whether a request may proceed based on stored rate-limit state, and that drives retry on a 429. Parameterised by a policy and a store; it does not know provider names.
_Avoid_: rate limiter, rate-limit logic, throttle

**Rate-limit store**:
The persistence seam behind the rate-limit engine. Holds per-provider rate-limit state. Three implementations: file-backed (Node), Durable-Object-backed (production), in-memory (tests).
_Avoid_: rate-limit storage, state store, cache

**Rate-limit policy**:
The per-provider decision rule the engine applies when a request is blocked pre-flight or receives a 429: _retry-after-wait_ (imgchest) or _fail-fast_ (sxcu).
_Avoid_: retry strategy, backoff policy, rate-limit mode

**Host**:
A runtime that wires the provider modules and engine to an HTTP entry point and supplies runtime dependencies (CORS origins, secrets, the rate-limit store, static assets). Three: the Node server, the Cloudflare Worker, and the Durable Object. A host no longer shapes upload requests or responses itself — that is the upload endpoint module's job.
_Avoid_: runtime, server, adapter

**Upload endpoint module**:
The deep module a host calls to perform one upload. Its interface is one function — `handleUploadRequest(request, deps): Promise<Response>` — and nothing else. It owns route matching, request shaping (form-data reading, token resolution, validation), the provider/engine call, and response shaping (status normalization, the JSON error envelope, CORS header projection, rate-limit header projection). The three hosts each reduce to a single call to it, plus their own runtime wiring (static assets in Node, the DO forwarding boundary and `X-Origin`/token injection in the Worker, per-IP `idFromName` and engine-in-DO atomicity in the Durable Object per ADR-0001).
_Avoid_: upload handler, request handler, endpoint, controller, route module

**Upload sequencer**:
A client-side module that orchestrates one provider's multi-file upload flow against our own proxy — request shaping, multi-file/URL looping, burst pacing, response parsing, incremental result emission, and completion. One per provider: catbox, kek, sxcu, imgchest. Its interface is `(input, observer, fetchFn) => Promise<UploadResult[]>`: the promise is the single completion signal (it resolves with the full results array); the observer carries only incremental events. Distinct from the provider proxy runtime (which talks to the upstream provider) and from a provider (which is the external service).
_Avoid_: client provider module, upload handler, uploader

**Upload observer**:
The seam an upload sequencer emits *incremental* events through — per-result (`onResult`), progress (`onProgress`), and rate-limit-wait (`onRateLimitWait`). It carries no completion signal: completion is the sequencer's resolved promise, not an observer event. Implemented by the `ImageUploader` class in production (bridging to its rendering methods) and by a recording double in tests.
_Avoid_: callback, event emitter, listener, handler

**Sequencer completion**:
The terminal signal of an upload sequencer — its promise resolving with the final `UploadResult[]`. Per-item upload failures are *data* in that array (`{ type: 'error', message }`); the flow that produced them **resolves**, because a partial upload is a completed flow, not a failed one. The promise **rejects** only for an unexpected exception the sequencer did not convert to per-item data (a bug), so the host can surface a real error instead of swallowing it. Replacing the former `observer.onDone` callback, which carried the same payload as the promise and was a redundant second completion signal.
_Avoid_: done callback, finish handler, onDone, terminal callback

**Upload input**:
The plain, DOM-free contract object the `ImageUploader` class builds from form state and hands to an upload sequencer. One shape per provider. Carries everything the sequencer needs (files, URLs, options) with no DOM access.
_Avoid_: form data, options, params, request

**Provider input**:
The plain, host-free contract object a provider input reader produces from an incoming `Request`'s formData (and, where relevant, the resolved bearer token). One shape per provider: catbox, kek, sxcu (file or collection), imgchest (post or add-to-post). The provider proxy runtime consumes it. Validation failures surface as a tagged `{ ok: false, error }` return, not as a thrown exception across the seam.
_Avoid_: form data, request body, params, input object

**Provider input reader**:
The single function, per provider, that turns an incoming `Request` into either a valid Provider input or a validation error. Lives in the upload endpoint module (one reader per provider, in `request-shaping.ts`). Owns form-data reading, token resolution against `deps.secrets`, and validation gating (file/size/count caps per provider). Baking validation into the reader is what makes the catbox/imgchest/sxcu-files validation uniform across all hosts.
_Avoid_: parser, request parser, form reader, provider parser

**Request shaping**:
The upload endpoint module's job of turning an incoming `Request` into a Provider input via the provider input reader — form-data reading, token resolution, validation. Distinct from a provider proxy runtime (outbound fetch/response parsing/retry) and from an upload sequencer (client-side multi-file orchestration).
_Avoid_: request parsing, request building, request preparation

**Response shaping**:
The upload endpoint module's job of turning a ProviderResult into an outgoing `Response`: per-provider status normalization (2xx→200 for catbox/kek; passthrough for imgchest/sxcu), the single JSON error envelope (`{ error }`), CORS header application (from `deps.corsHeaders`), and rate-limit header projection.
_Avoid_: response building, response formatting, response handler

**Rate-limit header projection**:
The single function that maps a `RateLimitHeaders` object onto the `X-RateLimit-*` response headers. Lives in the upload endpoint module's response-shaping code. Replaces the former per-host duplicates `buildRateLimitHeaders` (Node) and `createResponseHeadersFromProvider` (Durable Object), which were the same logic under two names.
_Avoid_: rate-limit headers, RL header builder, rate-limit header mapping
