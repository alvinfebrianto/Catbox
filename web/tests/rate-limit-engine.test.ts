import { afterEach, describe, expect, test, vi } from 'vitest';
import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { withRetry } from '../src/retry';
import {
  DurableObjectRateLimitStore,
  FAIL_FAST_RATE_LIMIT_POLICY,
  MemoryRateLimitStore,
  RETRY_AFTER_WAIT_RATE_LIMIT_POLICY,
  executeRateLimited,
} from '../src/rate-limit/engine';
import { ProviderResult } from '../src/provider-protocol';
import { uploadToCatbox } from '../src/providers/catbox';
import { AllRateLimits } from '../src/types';

const retryConfig = {
  maxRetries: 2,
  baseDelayMs: 1,
  maxDelayMs: 5,
  jitterMs: 0,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('provider protocol', () => {
  test('represents provider output without an HTTP response object', () => {
    const result: ProviderResult = {
      status: 200,
      body: { url: 'https://files.example/image.png' },
      rateLimitHeaders: { limit: 10, remaining: 9, bucket: 'bucket-a' },
    };

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ url: 'https://files.example/image.png' });
    expect(result.rateLimitHeaders?.remaining).toBe(9);
  });

  test('lets catbox use plain input, injected fetch, and return a plain result', async () => {
    const captured: { body?: FormData } = {};
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured.body = init?.body as FormData;
      return new Response('https://files.catbox.moe/abc.png', {
        status: 200,
        headers: { 'X-RateLimit-Remaining': '7', 'X-RateLimit-Limit': '10' },
      });
    });

    const result = await uploadToCatbox({ reqtype: 'urlupload', url: 'https://example.com/cat.png' }, { fetch });

    expect(fetch).toHaveBeenCalledWith('https://catbox.moe/user/api.php', expect.objectContaining({
      method: 'POST',
      body: expect.any(FormData),
    }));
    expect(captured.body?.get('reqtype')).toBe('urlupload');
    expect(captured.body?.get('url')).toBe('https://example.com/cat.png');
    expect(result).toEqual({
      status: 200,
      body: 'https://files.catbox.moe/abc.png',
      rateLimitHeaders: { limit: 10, remaining: 7 },
    });
  });

  test('lets catbox shape createalbum requests', async () => {
    const captured: { body?: FormData } = {};
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      captured.body = init?.body as FormData;
      return new Response('abc123', { status: 200 });
    });

    const result = await uploadToCatbox({
      reqtype: 'createalbum',
      title: 'Trip',
      desc: 'Images from the trip',
      files: 'one.png two.png',
    }, { fetch });

    expect(captured.body?.get('reqtype')).toBe('createalbum');
    expect(captured.body?.get('title')).toBe('Trip');
    expect(captured.body?.get('desc')).toBe('Images from the trip');
    expect(captured.body?.get('files')).toBe('one.png two.png');
    expect(result).toEqual({ status: 200, body: 'abc123', rateLimitHeaders: {} });
  });
});

describe('withRetry', () => {
  test('retries retryable results through one shared loop', async () => {
    vi.useFakeTimers();
    let calls = 0;

    const promise = withRetry(
      async () => {
        calls += 1;
        return calls < 3 ? { status: 429 } : { status: 200 };
      },
      {
        config: retryConfig,
        shouldRetry: result => result.status === 429,
      }
    );

    await vi.advanceTimersByTimeAsync(3);

    await expect(promise).resolves.toEqual({ status: 200 });
    expect(calls).toBe(3);
  });
});

describe('MemoryRateLimitStore', () => {
  test('loads and saves rate-limit state asynchronously without file I/O', async () => {
    const store = new MemoryRateLimitStore();
    const state = await store.load();

    state.imgchest.default = {
      limit: 1,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      windowStart: Date.now(),
      lastUpdated: Date.now(),
    };

    await store.save(state);

    const loaded = await store.load();
    expect(loaded.imgchest.default?.remaining).toBe(0);
    expect(loaded).not.toBe(state);
  });
});

describe('DurableObjectRateLimitStore', () => {
  test('loads empty state when no stored data exists', async () => {
    const storage = {
      get: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    };
    const store = new DurableObjectRateLimitStore(storage as unknown as DurableObjectStorage);

    const state = await store.load();
    expect(state.imgchest.default).toBeNull();
    expect(state.sxcu.buckets).toEqual({});
    expect(state.sxcu.global).toBeNull();
  });

  test('persists and retrieves rate-limit state', async () => {
    let stored: unknown = undefined;
    const storage = {
      get: vi.fn(async () => stored),
      put: vi.fn(async (key: string, value: unknown) => { stored = value; }),
    };
    const store = new DurableObjectRateLimitStore(storage as unknown as DurableObjectStorage);

    const state = await store.load();
    state.imgchest.default = {
      limit: 60, remaining: 55,
      resetAt: Date.now() + 60_000, windowStart: Date.now(), lastUpdated: Date.now(),
    };
    await store.save(state);

    const loaded = await store.load();
    expect(loaded.imgchest.default?.remaining).toBe(55);
  });
});

describe('executeRateLimited', () => {
  test('returns a structured fail-fast decision when policy blocks pre-flight', async () => {
    const now = Date.now();
    const store = new MemoryRateLimitStore(blockedSxcuState(now));

    const result = await executeRateLimited({
      provider: 'sxcu',
      bucketId: 'bucket-a',
      policy: FAIL_FAST_RATE_LIMIT_POLICY,
      store,
      config: retryConfig,
      operation: async () => ({ status: 200, body: { ok: true } }),
      now: () => now,
    });

    expect(result.type).toBe('rate-limited');
    if (result.type === 'rate-limited') {
      expect(result.providerResult.status).toBe(429);
      expect(result.providerResult.body).toEqual({ error: 'Rate limit exceeded' });
      expect(result.providerResult.rateLimitHeaders?.bucket).toBe('bucket-a');
    }
  });

  test('waits and retries when policy asks for retry-after-wait', async () => {
    vi.useFakeTimers();
    const start = Date.now();
    let now = start;
    const store = new MemoryRateLimitStore(blockedImgchestState(start, 1));
    let calls = 0;

    const promise = executeRateLimited({
      provider: 'imgchest',
      policy: RETRY_AFTER_WAIT_RATE_LIMIT_POLICY,
      store,
      config: retryConfig,
      operation: async () => {
        calls += 1;
        return { status: 200, body: { ok: true } };
      },
      sleep: async ms => {
        now += ms;
      },
      now: () => now,
    });

    await expect(promise).resolves.toMatchObject({
      type: 'ok',
      providerResult: { status: 200, body: { ok: true } },
    });
    expect(calls).toBe(1);
  });

  test('updates the in-memory store from provider rate-limit headers', async () => {
    const now = Date.now();
    const store = new MemoryRateLimitStore();

    const result = await executeRateLimited({
      provider: 'sxcu',
      bucketId: 'bucket-a',
      policy: FAIL_FAST_RATE_LIMIT_POLICY,
      store,
      config: retryConfig,
      operation: async () => ({
        status: 200,
        body: { ok: true },
        rateLimitHeaders: { limit: 10, remaining: 4, bucket: 'bucket-a', resetAfter: 30 },
      }),
      now: () => now,
    });

    expect(result.type).toBe('ok');
    const state = await store.load();
    expect(state.sxcu.buckets['bucket-a'].remaining).toBe(4);
  });
});

function blockedSxcuState(now: number): AllRateLimits {
  return {
    imgchest: { default: null },
    sxcu: {
      global: null,
      buckets: {
        'bucket-a': {
          limit: 10,
          remaining: 0,
          resetAt: now + 1_000,
          windowStart: now - 1_000,
          lastUpdated: now,
        },
      },
    },
    catbox: { default: null },
  };
}

function blockedImgchestState(now: number, resetInMs: number): AllRateLimits {
  return {
    imgchest: {
      default: {
        limit: 1,
        remaining: 0,
        resetAt: now + resetInMs,
        windowStart: now - 1_000,
        lastUpdated: now,
      },
    },
    sxcu: { global: null, buckets: {} },
    catbox: { default: null },
  };
}
