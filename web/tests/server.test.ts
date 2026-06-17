import { test, expect, describe, vi, afterEach } from 'vitest';
import {
  getImgchestToken,
  handleCatboxUpload,
  handleSxcuCollections,
  handleSxcuFiles,
  handleImgchestPost,
  handleImgchestAdd,
  handleKekPost,
  MAX_IMGCHEST_IMAGES_PER_REQUEST,
  HostDeps,
} from '../src/server';
import { MemoryRateLimitStore } from '../src/rate-limit/engine';

const originalEnv = { ...process.env };

function makeFormData(entries: Record<string, string | Blob | Array<string | Blob>>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        form.append(key, item);
      }
    } else {
      form.append(key, value);
    }
  }
  return form;
}

function makeImgFiles(count: number): File[] {
  const files: File[] = [];
  for (let i = 0; i < count; i++) {
    files.push(new File([String(i)], `img${i}.png`, { type: 'image/png' }));
  }
  return files;
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: new Headers({ 'Content-Type': 'application/json', ...init.headers }),
  });
}

describe('Token management', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('prioritizes environment variable', () => {
    process.env.IMGCHEST_API_TOKEN = 'env-token-123';
    expect(getImgchestToken()).toBe('env-token-123');
  });

  test('returns null when no token available', () => {
    delete process.env.IMGCHEST_API_TOKEN;
    expect(getImgchestToken()).toBeNull();
  });
});

describe('Catbox upload handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('proxies file upload to catbox API', async () => {
    const fetch = vi.fn(async () => new Response('https://files.catbox.moe/abc.png', { status: 200 }));

    const formData = makeFormData({
      reqtype: 'fileupload',
      fileToUpload: new File(['content'], 'test.png', { type: 'image/png' }),
    });
    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleCatboxUpload(req, { fetch });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('https://files.catbox.moe/abc.png');
    expect(fetch).toHaveBeenCalledWith('https://catbox.moe/user/api.php', expect.anything());
  });

  test('handles URL upload requests', async () => {
    const fetch = vi.fn(async () => new Response('https://files.catbox.moe/abc.png', { status: 200 }));

    const formData = makeFormData({
      reqtype: 'urlupload',
      url: 'https://example.com/image.png',
    });
    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });
    const response = await handleCatboxUpload(req, { fetch });

    expect(response.status).toBe(200);
  });

  test('rejects unknown request types', async () => {
    const formData = makeFormData({ reqtype: 'unknown' });
    const req = new Request('http://localhost:3000/upload/catbox', { method: 'POST', body: formData });

    const response = await handleCatboxUpload(req);
    expect(response.status).toBe(400);
  });
});

describe('SXCU upload handlers', () => {
  test('creates collection and returns result', async () => {
    const fetch = vi.fn(async () => jsonResponse({ id: 'coll123' }));
    const store = new MemoryRateLimitStore();

    const formData = makeFormData({ title: 'My Collection' });
    const req = new Request('http://localhost:3000/upload/sxcu/collections', { method: 'POST', body: formData });

    const response = await handleSxcuCollections(req, { fetch, store });
    const body = await response.json() as { id: string };

    expect(response.status).toBe(200);
    expect(body.id).toBe('coll123');
  });

  test('uploads file and returns result', async () => {
    const fetch = vi.fn(async () => jsonResponse(
      { url: 'https://sxcu.net/abc' },
      { headers: { 'X-RateLimit-Remaining': '58', 'X-RateLimit-Limit': '60' } }
    ));
    const store = new MemoryRateLimitStore();

    const formData = makeFormData({ file: new File(['content'], 'test.png', { type: 'image/png' }) });
    const req = new Request('http://localhost:3000/upload/sxcu/files', { method: 'POST', body: formData });

    const response = await handleSxcuFiles(req, { fetch, store });
    expect(response.status).toBe(200);
  });
});

describe('Imgchest upload handlers', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('rejects requests without API token', async () => {
    delete process.env.IMGCHEST_API_TOKEN;

    const formData = makeFormData({ 'images[]': new File(['a'], 'a.png', { type: 'image/png' }) });
    const req = new Request('http://localhost:3000/upload/imgchest/post', { method: 'POST', body: formData });

    const response = await handleImgchestPost(req);
    expect(response.status).toBe(401);
  });

  test('uses token from env when no Authorization header', async () => {
    process.env.IMGCHEST_API_TOKEN = 'env-token';
    const fetch = vi.fn(async () => jsonResponse(
      { data: { id: 'post123' } },
      { headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' } }
    ));
    const store = new MemoryRateLimitStore();

    const formData = makeFormData({ 'images[]': new File(['a'], 'a.png', { type: 'image/png' }) });
    const req = new Request('http://localhost:3000/upload/imgchest/post', { method: 'POST', body: formData });

    const response = await handleImgchestPost(req, { fetch, store });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { id: string } };
    expect(body.data.id).toBe('post123');
  });

  test('custom Authorization header takes precedence over env token', async () => {
    process.env.IMGCHEST_API_TOKEN = 'env-token';
    let capturedAuth = '';
    const fetch = vi.fn(async (_url, init) => {
      const headers = (init as RequestInit).headers as Record<string, string>;
      capturedAuth = headers?.Authorization || '';
      return jsonResponse(
        { data: { id: 'post456' } },
        { headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' } }
      );
    });
    const store = new MemoryRateLimitStore();

    const formData = makeFormData({ 'images[]': new File(['a'], 'a.png', { type: 'image/png' }) });
    const req = new Request('http://localhost:3000/upload/imgchest/post', {
      method: 'POST',
      body: formData,
      headers: { 'Authorization': 'Bearer custom-user-token' },
    });

    const response = await handleImgchestPost(req, { fetch, store });
    expect(response.status).toBe(200);
    expect(capturedAuth).toBe('Bearer custom-user-token');
  });

  test('creates post with images', async () => {
    const fetch = vi.fn(async () => jsonResponse(
      { data: { id: 'post123' } },
      { headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' } }
    ));
    const store = new MemoryRateLimitStore();
    process.env.IMGCHEST_API_TOKEN = 'test-token';

    const formData = makeFormData({
      'images[]': [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })],
      title: 'Test Post',
    });
    const req = new Request('http://localhost:3000/upload/imgchest/post', { method: 'POST', body: formData });

    const response = await handleImgchestPost(req, { fetch, store });
    const body = await response.json() as { data: { id: string } };

    expect(response.status).toBe(200);
    expect(body.data.id).toBe('post123');
  });

  test('chunks large uploads into batches of 20', async () => {
    let callCount = 0;
    const fetch = vi.fn(async () => {
      callCount++;
      return jsonResponse(
        { data: { id: 'post123' } },
        { headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': String(60 - callCount) } }
      );
    });
    const store = new MemoryRateLimitStore();
    process.env.IMGCHEST_API_TOKEN = 'test-token';

    const formData = new FormData();
    for (const file of makeImgFiles(45)) {
      formData.append('images[]', file);
    }
    const req = new Request('http://localhost:3000/upload/imgchest/post', { method: 'POST', body: formData });

    await handleImgchestPost(req, { fetch, store });
    expect(callCount).toBe(3);
  });

  test('adds images to existing post', async () => {
    let capturedUrl = '';
    const fetch = vi.fn(async (url) => {
      capturedUrl = url as string;
      return jsonResponse(
        { success: true },
        { headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '58' } }
      );
    });
    const store = new MemoryRateLimitStore();
    process.env.IMGCHEST_API_TOKEN = 'test-token';

    const formData = makeFormData({ 'images[]': new File(['a'], 'new.png', { type: 'image/png' }) });
    const req = new Request('http://localhost:3000/upload/imgchest/post/existingPost123/add', { method: 'POST', body: formData });

    const response = await handleImgchestAdd(req, { fetch, store });
    expect(response.status).toBe(200);
    expect(capturedUrl).toContain('existingPost123');
  });

  test('handles API errors gracefully', async () => {
    const fetch = vi.fn(async () => jsonResponse(
      { error: 'Invalid request' },
      { status: 400, headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' } }
    ));
    const store = new MemoryRateLimitStore();
    process.env.IMGCHEST_API_TOKEN = 'test-token';

    const formData = makeFormData({ 'images[]': new File(['a'], 'test.png', { type: 'image/png' }) });
    const req = new Request('http://localhost:3000/upload/imgchest/post', { method: 'POST', body: formData });

    const response = await handleImgchestPost(req, { fetch, store });
    expect(response.status).toBe(400);
  });
});

describe('Kek upload handler', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('proxies url upload to kek /posts and follows up with mature PUT', async () => {
    process.env.KEK_API_KEY = 'env-key';
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (typeof url === 'string' && url.endsWith('/mature')) {
        return new Response('', { status: 200 });
      }
      return jsonResponse({ id: 'kek-1', url: 'https://kek.sh/i/kek-1' });
    });

    const formData = makeFormData({ url: 'https://example.com/cat.png' });
    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST', body: formData });

    const response = await handleKekPost(req, { fetch });
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);

    const [firstUrl, firstInit] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstUrl).toBe('https://kek.sh/api/v1/posts');
    expect((firstInit.headers as Record<string, string>)['x-kek-auth']).toBe('env-key');
  });

  test('uses X-Kek-Auth header in preference to env key', async () => {
    process.env.KEK_API_KEY = 'env-key';
    const fetch = vi.fn(async () =>
      jsonResponse({ id: 'kek-2', url: 'https://kek.sh/i/kek-2' })
    );

    const formData = makeFormData({ url: 'https://example.com/cat.png' });
    const req = new Request('http://localhost:3000/upload/kek/posts', {
      method: 'POST',
      body: formData,
      headers: { 'X-Kek-Auth': 'header-key' },
    });

    await handleKekPost(req, { fetch });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-kek-auth']).toBe('header-key');
  });

  test('skips mature PUT when mature flag is false', async () => {
    process.env.KEK_API_KEY = 'env-key';
    const fetch = vi.fn(async () =>
      jsonResponse({ id: 'kek-3', url: 'https://kek.sh/i/kek-3' })
    );

    const formData = makeFormData({
      url: 'https://example.com/cat.png',
      mature: 'false',
    });
    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST', body: formData });

    await handleKekPost(req, { fetch });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('returns 400 when both file and url are provided', async () => {
    process.env.KEK_API_KEY = 'env-key';
    const fetch = vi.fn();

    const formData = new FormData();
    formData.append('url', 'https://example.com/cat.png');
    formData.append('file', new File(['cat'], 'cat.png', { type: 'image/png' }));
    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST', body: formData });

    const response = await handleKekPost(req, { fetch });
    expect(response.status).toBe(400);
  });

  test('returns 400 when no api key is configured', async () => {
    const fetch = vi.fn();

    const formData = makeFormData({ url: 'https://example.com/cat.png' });
    const req = new Request('http://localhost:3000/upload/kek/posts', { method: 'POST', body: formData });

    const response = await handleKekPost(req, { fetch });
    expect(response.status).toBe(400);
  });
});

describe('Constants', () => {
  test('MAX_IMGCHEST_IMAGES_PER_REQUEST is 20', () => {
    expect(MAX_IMGCHEST_IMAGES_PER_REQUEST).toBe(20);
  });
});
