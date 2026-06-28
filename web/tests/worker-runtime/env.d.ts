// Type the bindings exposed to the Workers-runtime test lane via `cloudflare:test`'s
// `env` (Cloudflare.Env). Mirrors the wrangler.toml DO binding plus the test-only
// IMGCHEST_API_TOKEN provided through the vitest miniflare config.
declare namespace Cloudflare {
  interface Env {
    RATE_LIMITER: DurableObjectNamespace;
    IMGCHEST_API_TOKEN?: string;
    KEK_API_KEY?: string;
  }
}
