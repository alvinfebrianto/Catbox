import { test, expect, describe, vi, afterEach } from 'vitest';
import { handleUploadRequest, type UploadEndpointDeps } from '../src/upload-endpoint';
import { MemoryRateLimitStore } from '../src/rate-limit/engine';

function makeDeps(overrides: Partial<UploadEndpointDeps> = {}): UploadEndpointDeps {
  return {
    corsHeaders: { 'Access-Control-Allow-Origin': 'http://localhost:3000' },
    ...overrides,
  };
}

describe('route matching', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('handles /upload/catbox and returns null for unrecognized routes', async () => {
    const catboxReq = new Request('http://localhost:3000/upload/catbox', { method: 'POST' });
    const catboxRes = await handleUploadRequest(catboxReq, makeDeps());
    expect(catboxRes).not.toBeNull();

    const unknownReq = new Request('http://localhost:3000/upload/unknown', { method: 'POST' });
    const unknownRes = await handleUploadRequest(unknownReq, makeDeps());
    expect(unknownRes).toBeNull();
  });
});

describe('Catbox request shaping and validation', () => {
  test('successful file upload returns raw text with 200 status', async () => {
    const fetch = vi.fn(async () => new Response('https://files.catbox.moe/abc.png', { status: 200 }));
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', new File(['content'], 'test.png', { type: 'image/png' }));

    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps({ fetch }));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(await response!.text()).toBe('https://files.catbox.moe/abc.png');
  });

  test('handles URL upload', async () => {
    const fetch = vi.fn(async () => new Response('https://files.catbox.moe/url123.png', { status: 200 }));
    const formData = new FormData();
    formData.append('reqtype', 'urlupload');
    formData.append('url', 'https://example.com/image.png');

    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps({ fetch }));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(await response!.text()).toBe('https://files.catbox.moe/url123.png');
  });

  test('rejects file too large', async () => {
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    const bigFile = new File(['x'.repeat(51 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
    formData.append('fileToUpload', bigFile);

    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps());

    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
    expect(response!.headers.get('Content-Type')).toBe('application/json');
    const body = await response!.json() as { error: string };
    expect(body.error).toContain('File too large');
  });

  test('rejects disallowed file extension', async () => {
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', new File(['content'], 'evil.exe', { type: 'application/x-msdownload' }));

    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps());

    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
    const body = await response!.json() as { error: string };
    expect(body.error).toContain('Disallowed file type');
  });

  test('rejects too many files', async () => {
    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    for (let i = 0; i < 51; i++) {
      formData.append('fileToUpload', new File([String(i)], `img${i}.png`, { type: 'image/png' }));
    }

    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps());

    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
    const body = await response!.json() as { error: string };
    expect(body.error).toContain('Too many files');
  });

  test('rejects unknown reqtype', async () => {
    const formData = new FormData();
    formData.append('reqtype', 'invalid');

    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps());

    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
    const body = await response!.json() as { error: string };
    expect(body.error).toContain('Unknown request type');
  });

  test('collapses 2xx status to 200', async () => {
    const fetch = vi.fn(async () => new Response('https://files.catbox.moe/abc.png', { status: 201 }));

    const formData = new FormData();
    formData.append('reqtype', 'urlupload');
    formData.append('url', 'https://example.com/image.png');

    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps({ fetch }));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
  });

  test('passes non-2xx status through unchanged', async () => {
    const fetch = vi.fn(async () => new Response('Server Error', { status: 500 }));

    const formData = new FormData();
    formData.append('reqtype', 'urlupload');
    formData.append('url', 'https://example.com/image.png');

    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps({ fetch }));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(500);
    const body = await response!.json() as { error: string };
    expect(body.error).toBe('Server Error');
  });

  test('all error paths return JSON error envelope', async () => {
    const fetch = vi.fn(async () => { throw new Error('Network failure'); });

    const formData = new FormData();
    formData.append('reqtype', 'urlupload');
    formData.append('url', 'https://example.com/image.png');

    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps({ fetch }));

    expect(response).not.toBeNull();
    expect(response!.headers.get('Content-Type')).toBe('application/json');
    const body = await response!.json() as { error: string };
    expect(body.error).toBe('Network failure');
  }, 60000);

  test('applies CORS headers on error responses', async () => {
    const formData = new FormData();
    formData.append('reqtype', 'invalid');

    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps({ corsHeaders: { 'Access-Control-Allow-Origin': 'https://example.com' } }));

    expect(response).not.toBeNull();
    expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
  });
});

describe('kek request shaping and validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function kekDeps(overrides: Partial<UploadEndpointDeps> = {}): UploadEndpointDeps {
    return makeDeps({ secrets: { kekApiKey: 'env-key' }, ...overrides });
  }

  test('matches /upload/kek/posts route', async () => {
    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST' });
    const response = await handleUploadRequest(req, kekDeps());
    expect(response).not.toBeNull();
  });

  test('successful file upload returns JSON body with 2xx collapsed to 200', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'abc', filename: 'x.png' }), { status: 201 }));
    const formData = new FormData();
    formData.append('file', new File(['content'], 'test.png', { type: 'image/png' }));

    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, kekDeps({ fetch }));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    expect(response!.headers.get('Content-Type')).toBe('application/json');
    expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    const body = await response!.json() as { id: string };
    expect(body.id).toBe('abc');
  });

  test('resolves API key from deps.secrets.kekApiKey', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'abc' }), { status: 200 }));
    const formData = new FormData();
    formData.append('file', new File(['content'], 'test.png', { type: 'image/png' }));

    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST', body: formData });
    await handleUploadRequest(req, kekDeps({ fetch }));

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-kek-auth']).toBe('env-key');
  });

  test('X-Kek-Auth header takes precedence over deps.secrets', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'abc' }), { status: 200 }));
    const formData = new FormData();
    formData.append('file', new File(['content'], 'test.png', { type: 'image/png' }));

    const req = new Request('http://localhost:3000/upload/kek/posts', {
      method: 'POST',
      body: formData,
      headers: { 'X-Kek-Auth': 'header-key' },
    });
    await handleUploadRequest(req, kekDeps({ fetch }));

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-kek-auth']).toBe('header-key');
  });

  test('returns error envelope when no API key configured', async () => {
    const formData = new FormData();
    formData.append('file', new File(['content'], 'test.png', { type: 'image/png' }));

    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps());

    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
    expect(response!.headers.get('Content-Type')).toBe('application/json');
    const body = await response!.json() as { error: string };
    expect(body.error).toContain('kek API key not configured');
  });

  test('enforces kek-specific file size cap', async () => {
    const formData = new FormData();
    const bigFile = new File(['x'.repeat(51 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
    formData.append('file', bigFile);

    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, kekDeps());

    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
    const body = await response!.json() as { error: string };
    expect(body.error).toContain('max 50MB for kek');
  });

  test('rejects disallowed kek file type', async () => {
    const formData = new FormData();
    formData.append('file', new File(['content'], 'clip.mp4', { type: 'video/mp4' }));

    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, kekDeps());

    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
    const body = await response!.json() as { error: string };
    expect(body.error).toContain('Unsupported file type for kek');
  });

  test('passes non-2xx status through with JSON error envelope', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ message: 'rejected' }), { status: 422 }));
    const formData = new FormData();
    formData.append('file', new File(['content'], 'test.png', { type: 'image/png' }));

    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, kekDeps({ fetch }));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(422);
    expect(response!.headers.get('Content-Type')).toBe('application/json');
    const body = await response!.json() as { error: string };
    expect(body.error).toContain('rejected');
  });

  test('network failure returns JSON error envelope with CORS', async () => {
    const fetch = vi.fn(async () => { throw new Error('Network failure'); });
    const formData = new FormData();
    formData.append('file', new File(['content'], 'test.png', { type: 'image/png' }));

    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, kekDeps({ fetch, corsHeaders: { 'Access-Control-Allow-Origin': 'https://example.com' } }));

    expect(response).not.toBeNull();
    expect(response!.headers.get('Content-Type')).toBe('application/json');
    expect(response!.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    const body = await response!.json() as { error: string };
    expect(body.error).toBe('Network failure');
  }, 60000);
});

describe('sxcu request shaping, rate limiting, and response shaping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('matches both sxcu routes and branches files versus collections', async () => {
    const seenUrls: string[] = [];
    const seenBodies: FormData[] = [];
    const fetch = vi.fn(async (url, init) => {
      seenUrls.push(String(url));
      seenBodies.push((init as RequestInit).body as FormData);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const store = new MemoryRateLimitStore();

    const fileData = new FormData();
    fileData.append('file', new File(['content'], 'test.png', { type: 'image/png' }));
    const filesReq = new Request('http://localhost:3000/upload/sxcu/files', { method: 'POST', body: fileData });

    const collectionData = new FormData();
    collectionData.append('title', 'My Collection');
    collectionData.append('desc', 'A description');
    collectionData.append('private', 'true');
    collectionData.append('unlisted', 'false');
    const collectionsReq = new Request('http://localhost:3000/upload/sxcu/collections', { method: 'POST', body: collectionData });

    const filesRes = await handleUploadRequest(filesReq, makeDeps({ fetch, store }));
    const collectionsRes = await handleUploadRequest(collectionsReq, makeDeps({ fetch }));

    expect(filesRes).not.toBeNull();
    expect(collectionsRes).not.toBeNull();
    expect(seenUrls).toEqual([
      'https://sxcu.net/api/files/create',
      'https://sxcu.net/api/collections/create',
    ]);
    expect(seenBodies[0].get('file')).toBeInstanceOf(File);
    expect(seenBodies[1].get('title')).toBe('My Collection');
    expect(seenBodies[1].get('desc')).toBe('A description');
    expect(seenBodies[1].get('private')).toBe('true');
    expect(seenBodies[1].get('unlisted')).toBe('false');
    expect(seenBodies[1].get('file')).toBeNull();
  });

  test('enforces sxcu file validation before the provider call', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const formData = new FormData();
    formData.append('file', new File(['content'], 'bad.exe', { type: 'application/x-msdownload' }));

    const req = new Request('http://localhost:3000/upload/sxcu/files', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps({ fetch, store: new MemoryRateLimitStore() }));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    const body = await response!.json() as { error: string };
    expect(body.error).toContain('Disallowed file type');
  });

  test('returns a defensive 500 when sxcu files have no rate-limit store', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const formData = new FormData();
    formData.append('file', new File(['content'], 'test.png', { type: 'image/png' }));

    const req = new Request('http://localhost:3000/upload/sxcu/files', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps({ fetch }));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(500);
    expect(fetch).not.toHaveBeenCalled();
    const body = await response!.json() as { error: string };
    expect(body.error).toContain('Rate-limit store not configured');
  });

  test('passes sxcu 2xx statuses through without collapsing to 200', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ collection_id: 'abc' }), { status: 201 }));
    const formData = new FormData();
    formData.append('title', 'My Collection');
    formData.append('private', 'false');
    formData.append('unlisted', 'true');

    const req = new Request('http://localhost:3000/upload/sxcu/collections', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps({ fetch }));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(201);
    expect(await response!.json()).toEqual({ collection_id: 'abc' });
  });

  test('projects sxcu rate-limit headers and preserves body-detected global 429', async () => {
    const fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Global rate limit exceeded', code: 2 }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': '240',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': '1700000000',
          'X-RateLimit-Reset-After': '30',
          'X-RateLimit-Bucket': 'global',
        },
      })
    );
    const formData = new FormData();
    formData.append('file', new File(['content'], 'test.png', { type: 'image/png' }));

    const req = new Request('http://localhost:3000/upload/sxcu/files', { method: 'POST', body: formData });
    const response = await handleUploadRequest(req, makeDeps({ fetch, store: new MemoryRateLimitStore() }));

    expect(response).not.toBeNull();
    expect(response!.status).toBe(429);
    expect(response!.headers.get('X-RateLimit-Limit')).toBe('240');
    expect(response!.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response!.headers.get('X-RateLimit-Reset')).toBe('1700000000');
    expect(response!.headers.get('X-RateLimit-Reset-After')).toBe('30');
    expect(response!.headers.get('X-RateLimit-Bucket')).toBe('global');
    expect(response!.headers.get('X-RateLimit-Global')).toBe('true');
    expect(await response!.json()).toEqual({ error: 'Global rate limit exceeded', code: 2 });
  });
});
