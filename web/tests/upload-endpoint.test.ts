import { test, expect, describe, vi, afterEach } from 'vitest';
import { handleUploadRequest, type UploadEndpointDeps } from '../src/upload-endpoint';

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
