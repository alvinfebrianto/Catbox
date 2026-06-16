import { afterEach, describe, expect, test, vi } from 'vitest';
import { createImgchestPost, imgchestAddToPost, imgchestPatchPost, uploadToImgchest } from '../../src/providers/imgchest';
import { MemoryRateLimitStore } from '../../src/rate-limit/engine';

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? { 'Content-Type': 'application/json' }),
  });
}

describe('createImgchestPost', () => {
  test('uploads images and returns post data', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { id: 'post123', images: [{ link: 'https://imgchest.com/i/img1' }] } })
    );

    const formData = new FormData();
    formData.append('images[]', new File(['a'], 'a.png', { type: 'image/png' }));
    formData.append('title', 'Test Post');

    const result = await createImgchestPost(formData, 'test-token', { fetch: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.imgchest.com/v1/post');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(init.body).toBe(formData);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { id: 'post123', images: [{ link: 'https://imgchest.com/i/img1' }] } });
  });

  test('forwards rate-limit headers from API response', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { id: 'post123', images: [] } }, {
        headers: {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '58',
          'X-RateLimit-Reset': '1700000000',
        },
      })
    );

    const formData = new FormData();
    formData.append('images[]', new File(['a'], 'a.png', { type: 'image/png' }));

    const result = await createImgchestPost(formData, 'test-token', { fetch: fetchMock as unknown as typeof fetch });

    expect(result.rateLimitHeaders).toEqual({
      limit: 60,
      remaining: 58,
      reset: 1700000000,
    });
  });
});

describe('imgchestAddToPost', () => {
  test('adds images to existing post', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { id: 'post123', images: [{ link: 'https://imgchest.com/i/img2' }] } })
    );

    const formData = new FormData();
    formData.append('images[]', new File(['b'], 'b.png', { type: 'image/png' }));

    const result = await imgchestAddToPost('post123', formData, 'test-token', { fetch: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.imgchest.com/v1/post/post123/add');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { id: 'post123', images: [{ link: 'https://imgchest.com/i/img2' }] } });
  });
});

describe('imgchestPatchPost', () => {
  test('updates post privacy and nsfw settings', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { id: 'post123', privacy: 'secret', nsfw: true } })
    );

    const result = await imgchestPatchPost('post123', { privacy: 'secret', nsfw: 'true' }, 'test-token', { fetch: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.imgchest.com/v1/post/post123');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ privacy: 'secret', nsfw: 'true' }));
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(result.status).toBe(200);
  });
});

describe('uploadToImgchest', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('creates post with single chunk of images', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { id: 'post123', images: [{ link: 'https://imgchest.com/i/img1' }] } }, {
        headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' },
      })
    );

    const store = new MemoryRateLimitStore();
    const result = await uploadToImgchest({
      images: [new File(['a'], 'a.png', { type: 'image/png' })],
      token: 'test-token',
    }, { fetch: fetchMock as unknown as typeof fetch, store });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.imgchest.com/v1/post');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { id: 'post123', images: [{ link: 'https://imgchest.com/i/img1' }] } });
  });

  test('chunks large uploads into multiple requests', async () => {
    let callCount = 0;
    const fetchMock = vi.fn(async () => {
      callCount++;
      return jsonResponse({ data: { id: 'post123', images: [] } }, {
        headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': String(60 - callCount) },
      });
    });

    const files: File[] = [];
    for (let i = 0; i < 45; i++) {
      files.push(new File([String(i)], `img${i}.png`, { type: 'image/png' }));
    }

    const store = new MemoryRateLimitStore();
    const result = await uploadToImgchest({
      images: files,
      token: 'test-token',
    }, { fetch: fetchMock as unknown as typeof fetch, store });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe(200);
  });
});

describe('retry-after-wait behavior', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('retries on 429 and succeeds', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    let now = Date.now();

    const fetchMock = vi.fn(async () => {
      callCount++;
      if (callCount <= 2) {
        return jsonResponse({ error: 'Rate limited' }, {
          status: 429,
          headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '0.1' },
        });
      }
      return jsonResponse({ data: { id: 'post123', images: [] } }, {
        headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' },
      });
    });

    const store = new MemoryRateLimitStore();
    const sleep = async (ms: number) => { now += ms; };

    const promise = uploadToImgchest({
      images: [new File(['a'], 'a.png', { type: 'image/png' })],
      token: 'test-token',
    }, { fetch: fetchMock as unknown as typeof fetch, store, sleep, now: () => now });

    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;

    expect(result.status).toBe(200);
    expect(callCount).toBe(3);
  });

  test('returns 429 when rate-limited pre-flight with maxRetries=0', async () => {
    vi.useFakeTimers();
    let now = Date.now();
    const startState = {
      imgchest: {
        default: {
          limit: 60,
          remaining: 0,
          resetAt: now + 60000,
          windowStart: now,
          lastUpdated: now,
        },
      },
      sxcu: { buckets: {}, global: null },
      catbox: { default: null },
    };

    const store = new MemoryRateLimitStore(startState);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: 'Should not be called' }, { status: 200 })
    );
    const sleep = async (ms: number) => { now += ms; };

    const result = await uploadToImgchest({
      images: [new File(['a'], 'a.png', { type: 'image/png' })],
      token: 'test-token',
    }, {
      fetch: fetchMock as unknown as typeof fetch,
      store,
      sleep,
      now: () => now,
      config: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 5, jitterMs: 0 },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: 'Rate limit exceeded' });
  });
});

describe('add to existing post', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('adds images to existing post and patches settings', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    let now = Date.now();
    const urls: string[] = [];

    const fetchMock = vi.fn(async (url: string) => {
      callCount++;
      urls.push(url);
      return jsonResponse(
        { data: { id: 'post123', images: [] } },
        { headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': String(60 - callCount) } }
      );
    });

    const store = new MemoryRateLimitStore();
    const sleep = async (ms: number) => { now += ms; };

    const files: File[] = [];
    for (let i = 0; i < 25; i++) {
      files.push(new File([String(i)], `img${i}.png`, { type: 'image/png' }));
    }

    const result = await uploadToImgchest({
      images: files,
      token: 'test-token',
      existingPostId: 'post123',
      privacy: 'secret',
      nsfw: true,
    }, { fetch: fetchMock as unknown as typeof fetch, store, sleep, now: () => now });

    expect(callCount).toBe(3);
    expect(urls[0]).toBe('https://api.imgchest.com/v1/post/post123/add');
    expect(urls[1]).toBe('https://api.imgchest.com/v1/post/post123/add');
    expect(urls[2]).toBe('https://api.imgchest.com/v1/post/post123');
    expect(result.status).toBe(200);
  });
});
