import { describe, expect, test, vi } from 'vitest';
import { SxcuUploadInput, uploadToSxcu } from '../../src/providers/sxcu';

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? { 'Content-Type': 'application/json' }),
  });
}

describe('uploadToSxcu', () => {
  test('uploads a file to /api/files/create and returns provider result', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ url: 'https://sxcu.net/abc' }));

    const input: SxcuUploadInput = {
      type: 'file',
      formData: new FormData(),
    };

    const result = await uploadToSxcu(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sxcu.net/api/files/create');
    expect(init.method).toBe('POST');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ url: 'https://sxcu.net/abc' });
  });

  test('creates a collection via /api/collections/create', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ collection_id: 'coll123', url: 'https://sxcu.net/c/coll123' }));

    const input: SxcuUploadInput = {
      type: 'collection',
      formData: new FormData(),
    };

    const result = await uploadToSxcu(input, { fetch: fetchMock as unknown as typeof fetch });

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://sxcu.net/api/collections/create');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ collection_id: 'coll123', url: 'https://sxcu.net/c/coll123' });
  });

  test('parses JSON error response', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'Invalid request', code: 400 }, { status: 400 }));

    const input: SxcuUploadInput = {
      type: 'file',
      formData: new FormData(),
    };

    const result = await uploadToSxcu(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid request', code: 400 });
  });

  test('falls back to raw text when response body is not JSON', async () => {
    const fetchMock = vi.fn(async () => new Response('Internal server error', { status: 500 }));

    const input: SxcuUploadInput = {
      type: 'file',
      formData: new FormData(),
    };

    const result = await uploadToSxcu(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(result.status).toBe(500);
    expect(result.body).toBe('Internal server error');
  });

  test('forwards rate-limit headers from API response', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ url: 'https://sxcu.net/abc' }, {
        headers: {
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '58',
          'X-RateLimit-Reset': '1700000000',
          'X-RateLimit-Bucket': 'files',
        },
      })
    );

    const input: SxcuUploadInput = {
      type: 'file',
      formData: new FormData(),
    };

    const result = await uploadToSxcu(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(result.rateLimitHeaders).toEqual({
      limit: 60,
      remaining: 58,
      reset: 1700000000,
      bucket: 'files',
    });
  });

  test('detects global rate-limit from X-RateLimit-Global header', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Global rate limit exceeded', code: 2 }), {
        status: 429,
        headers: new Headers({
          'Content-Type': 'application/json',
          'X-RateLimit-Global': 'true',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset-After': '30',
        }),
      })
    );

    const input: SxcuUploadInput = {
      type: 'file',
      formData: new FormData(),
    };

    const result = await uploadToSxcu(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(result.rateLimitHeaders?.isGlobal).toBe(true);
    expect(result.status).toBe(429);
  });

  test('detects global rate-limit from body code === 2 when header absent', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Rate limit exceeded', code: 2 }), {
        status: 429,
        headers: new Headers({
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset-After': '30',
        }),
      })
    );

    const input: SxcuUploadInput = {
      type: 'file',
      formData: new FormData(),
    };

    const result = await uploadToSxcu(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(result.rateLimitHeaders?.isGlobal).toBe(true);
    expect(result.status).toBe(429);
  });
});
