// Exercises the real Worker -> Durable Object seam inside workerd
// (@cloudflare/vitest-pool-workers), the production topology ADR-0001 depends on:
// Worker forwarding, the RATE_LIMITER binding, the engine running *inside* the DO,
// and real DurableObjectStorage (SQLite). Complements the fast Node suites, which
// only approximate this boundary with a mock DO namespace.
import { env, SELF, runInDurableObject } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyRateLimitState } from '../../src/rate-limit/engine';
import type { AllRateLimits } from '../../src/types';

const ORIGIN = 'http://localhost:3000';

function pngFile(name = 'a.png'): File {
  return new File(['fake-image-bytes'], name, { type: 'image/png' });
}

interface UpstreamMockOptions {
  imgchest?: () => Response;
  sxcu?: () => Response;
}

/**
 * Replace globalThis.fetch (which the providers resolve via getDefaultFetch at call
 * time) so upstream provider calls are mocked. Unknown URLs fall through to the real
 * fetch so the pool's internals keep working. Returns the spy for call assertions.
 */
function mockUpstream(options: UpstreamMockOptions) {
  const realFetch = globalThis.fetch;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (options.imgchest && url.includes('api.imgchest.com')) {
      return options.imgchest();
    }
    if (options.sxcu && url.includes('sxcu.net')) {
      return options.sxcu();
    }
    return realFetch(input as RequestInfo, init);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Worker -> Durable Object forwarding (real binding, via SELF)', () => {
  it('forwards an imgchest upload through the Worker to the real DO and threads the env token to the upstream call', async () => {
    const fetchSpy = mockUpstream({
      imgchest: () =>
        new Response(JSON.stringify({ data: { id: 'post-1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const form = new FormData();
    form.append('images[]', pngFile());

    const response = await SELF.fetch('https://worker.test/upload/imgchest/post', {
      method: 'POST',
      headers: { Origin: ORIGIN },
      body: form,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { id: 'post-1' } });

    // The upstream call only happens if the Worker forwarded to the DO, the DO ran
    // handleUploadRequest, and the provider fired — proving the full seam.
    const imgchestCall = fetchSpy.mock.calls.find((c) =>
      String(c[0] instanceof Request ? c[0].url : c[0]).includes('api.imgchest.com'),
    );
    expect(imgchestCall).toBeDefined();
    const init = imgchestCall![1] as RequestInit;
    const authHeader = new Headers(init.headers).get('Authorization');
    // Worker injected env.IMGCHEST_API_TOKEN; DO resolved it; provider sent it upstream.
    expect(authHeader).toBe('Bearer env-imgchest-token');
  });

  it('forwards an sxcu file upload through the Worker to the real DO and returns the upstream response', async () => {
    mockUpstream({
      sxcu: () =>
        new Response(JSON.stringify({ url: 'https://sxcu.net/abc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    });

    const form = new FormData();
    form.append('file', pngFile());

    const response = await SELF.fetch('https://worker.test/upload/sxcu/files', {
      method: 'POST',
      headers: { Origin: ORIGIN },
      body: form,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: 'https://sxcu.net/abc' });
  });
});

describe('Engine inside the Durable Object with real SQLite storage', () => {
  it('persists rate-limit state to real DurableObjectStorage after an imgchest upload', async () => {
    mockUpstream({
      imgchest: () =>
        new Response(JSON.stringify({ data: { id: 'post-2' } }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': '60',
            'X-RateLimit-Remaining': '42',
          },
        }),
    });

    const id = env.RATE_LIMITER.idFromName('client-test-persist');
    const stub = env.RATE_LIMITER.get(id);

    const form = new FormData();
    form.append('images[]', pngFile());
    const request = new Request('https://do.test/upload/imgchest/post', {
      method: 'POST',
      headers: { 'X-Origin': ORIGIN, Authorization: 'Bearer do-token' },
      body: form,
    });

    const response = await stub.fetch(request);
    expect(response.status).toBe(200);

    // Inspect the DO's real SQLite-backed storage directly.
    const stored = await runInDurableObject(stub, (_instance, state) =>
      state.storage.get<AllRateLimits>('rateLimits'),
    );
    expect(stored?.imgchest.default).not.toBeNull();
    expect(stored?.imgchest.default?.remaining).toBe(42);
    expect(stored?.imgchest.default?.limit).toBe(60);
  });

  it('reads persisted state inside the DO and fail-fast blocks an sxcu upload without calling upstream', async () => {
    const fetchSpy = mockUpstream({
      sxcu: () => new Response(JSON.stringify({ url: 'unexpected' }), { status: 200 }),
    });

    const id = env.RATE_LIMITER.idFromName('client-test-block');
    const stub = env.RATE_LIMITER.get(id);

    // Seed the DO's real storage so the sxcu global bucket is exhausted but unexpired.
    const now = Date.now();
    await runInDurableObject(stub, async (_instance, state) => {
      const seeded = createEmptyRateLimitState();
      seeded.sxcu.global = {
        limit: 240,
        remaining: 0,
        resetAt: now + 30_000,
        windowStart: now,
        lastUpdated: now,
      };
      await state.storage.put('rateLimits', seeded);
    });

    const form = new FormData();
    form.append('file', pngFile());
    const request = new Request('https://do.test/upload/sxcu/files', {
      method: 'POST',
      headers: { 'X-Origin': ORIGIN },
      body: form,
    });

    const response = await stub.fetch(request);

    expect(response.status).toBe(429);
    // Fail-fast: the engine blocked pre-flight from persisted state; upstream untouched.
    const sxcuCalled = fetchSpy.mock.calls.some((c) =>
      String(c[0] instanceof Request ? c[0].url : c[0]).includes('sxcu.net'),
    );
    expect(sxcuCalled).toBe(false);
  });
});
