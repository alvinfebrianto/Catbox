import { test, expect, describe, vi, afterEach } from 'vitest';
import workerDefault from '../src/worker';
import { getCorsHeaders } from '../src/types';

const originalFetch = globalThis.fetch;
const TEST_ORIGIN = 'http://localhost:3000';

function createRequest(url: string, options: RequestInit = {}): Request {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Origin')) {
    headers.set('Origin', TEST_ORIGIN);
  }
  return new Request(`https://worker.test${url}`, { ...options, headers });
}

interface MockDurableObject {
  namespace: DurableObjectNamespace;
  fetchMock: ReturnType<typeof vi.fn>;
}

function createMockDurableObject(): MockDurableObject {
  const fetchMock = vi.fn(async (_request: Request): Promise<Response> => {
    return new Response('Not Found', { status: 404 });
  });

  const stub = { fetch: fetchMock };
  const namespace = {
    idFromName: ((name: string) => {
      return { toString: () => name } as unknown as DurableObjectId;
    }) as (name: string) => DurableObjectId,
    get: ((_id: DurableObjectId) => stub) as (id: DurableObjectId) => DurableObjectStub,
  };

  return { namespace: namespace as unknown as DurableObjectNamespace, fetchMock };
}

function createTestEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { namespace } = createMockDurableObject();
  return {
    RATE_LIMITER: namespace,
    ...overrides,
  };
}

describe('CORS and routing', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('OPTIONS returns CORS preflight response', async () => {
    const request = createRequest('/any-path', { method: 'OPTIONS' });
    const response = await workerDefault.fetch(request, createTestEnv());

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(TEST_ORIGIN);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
  });

  test('unknown routes return 404', async () => {
    const response = await workerDefault.fetch(
      createRequest('/unknown', { method: 'POST' }),
      createTestEnv()
    );
    expect(response.status).toBe(404);
  });

  test('GET requests return 404', async () => {
    const response = await workerDefault.fetch(
      createRequest('/upload/catbox', { method: 'GET' }),
      createTestEnv()
    );
    expect(response.status).toBe(404);
  });
});

describe('Catbox proxy', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('successful file upload exercises real uploadToCatbox', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('https://files.catbox.moe/abc123.png', { status: 200 })
    );

    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', new File(['test content'], 'test.png', { type: 'image/png' }));

    const response = await workerDefault.fetch(
      createRequest('/upload/catbox', { method: 'POST', body: formData }),
      createTestEnv()
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('https://files.catbox.moe/abc123.png');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(TEST_ORIGIN);
  });

  test('supports urlupload reqtype', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('https://files.catbox.moe/url123.png', { status: 200 })
    );

    const formData = new FormData();
    formData.append('reqtype', 'urlupload');
    formData.append('url', 'https://example.com/image.png');

    const response = await workerDefault.fetch(
      createRequest('/upload/catbox', { method: 'POST', body: formData }),
      createTestEnv()
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('https://files.catbox.moe/url123.png');
  });

  test('supports createalbum reqtype', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('album123', { status: 200 })
    );

    const formData = new FormData();
    formData.append('reqtype', 'createalbum');
    formData.append('files', 'abc.png def.png');

    const response = await workerDefault.fetch(
      createRequest('/upload/catbox', { method: 'POST', body: formData }),
      createTestEnv()
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('album123');
  });

  test('rejects invalid reqtype', async () => {
    const formData = new FormData();
    formData.append('reqtype', 'invalid');

    const response = await workerDefault.fetch(
      createRequest('/upload/catbox', { method: 'POST', body: formData }),
      createTestEnv()
    );
    expect(response.status).toBe(400);
  });
});

describe('Kek proxy', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('proxies url upload to kek /posts', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'kek-1', url: 'https://kek.sh/i/kek-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response('', { status: 200 })
      );

    const formData = new FormData();
    formData.append('url', 'https://example.com/cat.png');

    const response = await workerDefault.fetch(
      createRequest('/upload/kek/posts', { method: 'POST', body: formData }),
      createTestEnv({ KEK_API_KEY: 'env-key' })
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { id: string };
    expect(body.id).toBe('kek-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [firstUrl] = fetchMock.mock.calls[0] as [string];
    expect(firstUrl).toBe('https://kek.sh/api/v1/posts');
  });

  test('returns 400 when no API key configured', async () => {
    const formData = new FormData();
    formData.append('url', 'https://example.com/cat.png');

    const response = await workerDefault.fetch(
      createRequest('/upload/kek/posts', { method: 'POST', body: formData }),
      createTestEnv()
    );

    expect(response.status).toBe(400);
  });
});

describe('Durable Object forwarding boundary', () => {
  test('forwards imgchest post to DO and returns the response', async () => {
    const { namespace, fetchMock } = createMockDurableObject();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const formData = new FormData();
    formData.append('images[]', new File(['a'], 'a.png', { type: 'image/png' }));

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      { RATE_LIMITER: namespace, IMGCHEST_API_TOKEN: 'env-token' }
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const forwardedReq = fetchMock.mock.calls[0][0] as Request;
    expect(new URL(forwardedReq.url).pathname).toBe('/upload/imgchest/post');
    expect(forwardedReq.headers.get('Authorization')).toBe('Bearer env-token');
    expect(forwardedReq.headers.get('X-Origin')).toBe(TEST_ORIGIN);
  });

  test('forwards sxcu files to DO', async () => {
    const { namespace, fetchMock } = createMockDurableObject();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://sxcu.net/abc' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const formData = new FormData();
    formData.append('file', new File(['content'], 'test.png', { type: 'image/png' }));

    const response = await workerDefault.fetch(
      createRequest('/upload/sxcu/files', { method: 'POST', body: formData }),
      { RATE_LIMITER: namespace }
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const forwardedReq = fetchMock.mock.calls[0][0] as Request;
    expect(new URL(forwardedReq.url).pathname).toBe('/upload/sxcu/files');
  });

  test('forwards sxcu collections to DO', async () => {
    const { namespace, fetchMock } = createMockDurableObject();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'coll123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const formData = new FormData();
    formData.append('title', 'My Collection');

    const response = await workerDefault.fetch(
      createRequest('/upload/sxcu/collections', { method: 'POST', body: formData }),
      { RATE_LIMITER: namespace }
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const forwardedReq = fetchMock.mock.calls[0][0] as Request;
    expect(new URL(forwardedReq.url).pathname).toBe('/upload/sxcu/collections');
  });

  test('forwards imgchest add to existing post to DO', async () => {
    const { namespace, fetchMock } = createMockDurableObject();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const formData = new FormData();
    formData.append('images[]', new File(['a'], 'a.png', { type: 'image/png' }));

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post/myPostId/add', { method: 'POST', body: formData }),
      { RATE_LIMITER: namespace }
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const forwardedReq = fetchMock.mock.calls[0][0] as Request;
    expect(new URL(forwardedReq.url).pathname).toBe('/upload/imgchest/post/myPostId/add');
  });

  test('does not override existing Authorization header with env token', async () => {
    const { namespace, fetchMock } = createMockDurableObject();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const formData = new FormData();
    formData.append('images[]', new File(['a'], 'a.png', { type: 'image/png' }));

    const headers = new Headers();
    headers.set('Origin', TEST_ORIGIN);
    headers.set('Authorization', 'Bearer custom-token');

    const request = new Request('https://worker.test/upload/imgchest/post', {
      method: 'POST',
      body: formData,
      headers,
    });

    await workerDefault.fetch(
      request,
      { RATE_LIMITER: namespace, IMGCHEST_API_TOKEN: 'env-token' }
    );

    const forwardedReq = fetchMock.mock.calls[0][0] as Request;
    expect(forwardedReq.headers.get('Authorization')).toBe('Bearer custom-token');
  });

  test('does not inject env token when no IMGCHEST_API_TOKEN', async () => {
    const { namespace, fetchMock } = createMockDurableObject();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const formData = new FormData();
    formData.append('images[]', new File(['a'], 'a.png', { type: 'image/png' }));

    await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      { RATE_LIMITER: namespace }
    );

    const forwardedReq = fetchMock.mock.calls[0][0] as Request;
    expect(forwardedReq.headers.get('Authorization')).toBeNull();
  });

  test('returns response from DO, including error status', async () => {
    const { namespace, fetchMock } = createMockDurableObject();
    fetchMock.mockResolvedValue(
      new Response('Not Found', { status: 404 })
    );

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/unknown', { method: 'POST' }),
      { RATE_LIMITER: namespace }
    );

    expect(response.status).toBe(404);
  });
});

describe('Rate limiter not configured', () => {
  test('returns 500 when RATE_LIMITER binding is missing', async () => {
    const formData = new FormData();
    formData.append('images[]', new File(['test'], 'test.png', { type: 'image/png' }));

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      {}
    );

    expect(response.status).toBe(500);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('Rate limiter not configured');
  });
});
