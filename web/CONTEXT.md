# catbox/web

A multi-provider image-upload proxy. The browser app uploads to a local Node server (development) or a Cloudflare Worker (production); the server forwards to one of several image-hosting providers, enforcing per-provider rate limits along the way.

## Language

**Provider**:
An external image-hosting service the proxy forwards uploads to. There are four: catbox, kek, sxcu, imgchest.
_Avoid_: host, service, backend, target

**Provider proxy runtime**:
The shared logic that performs an upload to a provider: request shaping, outbound fetch, response parsing, and retry. Collapsed into one set of modules shared across the Node server, Worker, and Durable Object.
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
A runtime that wires the provider modules and engine to an HTTP entry point and shapes responses. Three: the Node server, the Cloudflare Worker, and the Durable Object.
_Avoid_: runtime, server, adapter

**Upload sequencer**:
A client-side module that orchestrates one provider's multi-file upload flow against our own proxy — request shaping, multi-file/URL looping, burst pacing, response parsing, and incremental result emission. One per provider: catbox, kek, sxcu, imgchest. Distinct from the provider proxy runtime (which talks to the upstream provider) and from a provider (which is the external service).
_Avoid_: client provider module, upload handler, uploader

**Upload observer**:
The seam an upload sequencer emits events through — results, progress, rate-limit-wait, and completion. Implemented by the `ImageUploader` class in production (bridging to its rendering methods) and by a recording double in tests.
_Avoid_: callback, event emitter, listener, handler

**Upload input**:
The plain, DOM-free contract object the `ImageUploader` class builds from form state and hands to an upload sequencer. One shape per provider. Carries everything the sequencer needs (files, URLs, options) with no DOM access.
_Avoid_: form data, options, params, request
