import { test, expect, describe, vi, afterEach } from 'vitest';
import {
  getImgchestToken,
  handleRequest,
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

describe('SXCU upload handlers', () => {
  test('delegates collection uploads through the upload endpoint module', async () => {
    const fetch = vi.fn(async () => jsonResponse({ id: 'coll123' }));

    const formData = makeFormData({ title: 'My Collection' });
    const req = new Request('http://localhost:3000/upload/sxcu/collections', { method: 'POST', body: formData });

    const response = await handleRequest(req, { fetch });
    const body = await response.json() as { id: string };

    expect(response.status).toBe(200);
    expect(body.id).toBe('coll123');
  });

  test('delegates file uploads through the upload endpoint module with rate-limit store', async () => {
    const fetch = vi.fn(async () => jsonResponse(
      { url: 'https://sxcu.net/abc' },
      { headers: { 'X-RateLimit-Remaining': '58', 'X-RateLimit-Limit': '60' } }
    ));
    const store = new MemoryRateLimitStore();

    const formData = makeFormData({ file: new File(['content'], 'test.png', { type: 'image/png' }) });
    const req = new Request('http://localhost:3000/upload/sxcu/files', { method: 'POST', body: formData });

    const response = await handleRequest(req, { fetch, store });
    expect(response.status).toBe(200);
  });
});

describe('Imgchest delegation to the upload endpoint module', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('handleRequest delegates /upload/imgchest/post to the upload endpoint module', async () => {
    process.env.IMGCHEST_API_TOKEN = 'env-token';
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'post123' } }), {
      status: 200,
      headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' },
    }));
    const store = new MemoryRateLimitStore();

    const formData = makeFormData({ 'images[]': new File(['a'], 'a.png', { type: 'image/png' }) });
    const req = new Request('http://localhost:3000/upload/imgchest/post', { method: 'POST', body: formData });

    const response = await handleRequest(req, { fetch, store });
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { id: string } };
    expect(body.data.id).toBe('post123');

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer env-token');
  });

  test('handleRequest delegates /upload/imgchest/post/:id/add to the upload endpoint module', async () => {
    process.env.IMGCHEST_API_TOKEN = 'env-token';
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'abc123', images: [] } }), {
      status: 200,
      headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' },
    }));
    const store = new MemoryRateLimitStore();

    const formData = makeFormData({ 'images[]': new File(['a'], 'new.png', { type: 'image/png' }) });
    const req = new Request('http://localhost:3000/upload/imgchest/post/abc123/add', { method: 'POST', body: formData });

    const response = await handleRequest(req, { fetch, store });
    expect(response.status).toBe(200);

    const [url] = fetch.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.imgchest.com/v1/post/abc123/add');
  });

  test('Authorization header takes precedence over env token for imgchest (pre-resolved by the host)', async () => {
    process.env.IMGCHEST_API_TOKEN = 'env-token';
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'post123' } }), {
      status: 200,
      headers: { 'X-RateLimit-Limit': '60', 'X-RateLimit-Remaining': '59' },
    }));
    const store = new MemoryRateLimitStore();

    const formData = makeFormData({ 'images[]': new File(['a'], 'a.png', { type: 'image/png' }) });
    const req = new Request('http://localhost:3000/upload/imgchest/post', {
      method: 'POST',
      body: formData,
      headers: { 'Authorization': 'Bearer custom-user-token' },
    });

    await handleRequest(req, { fetch, store });

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer custom-user-token');
  });

  test('handleRequest returns a 400 error envelope when imgchest token is not configured', async () => {
    delete process.env.IMGCHEST_API_TOKEN;
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'post123' } }), { status: 200 }));

    const formData = makeFormData({ 'images[]': new File(['a'], 'a.png', { type: 'image/png' }) });
    const req = new Request('http://localhost:3000/upload/imgchest/post', { method: 'POST', body: formData });

    const response = await handleRequest(req, { fetch });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('Imgchest API token not configured');
    expect(fetch).not.toHaveBeenCalled();
  });
});
