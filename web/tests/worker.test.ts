import { test, expect, describe, mock, afterEach } from 'bun:test';
import workerDefault from '../src/worker';
import { getCorsHeaders } from '../src/types';

const originalFetch = globalThis.fetch;
const TEST_PROXY_TOKEN = 'test-proxy-auth-token';
const TEST_ORIGIN = 'http://localhost:3000';

function setMockFetch(fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as typeof fetch;
}

function createRequest(url: string, options: RequestInit = {}): Request {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Origin')) {
    headers.set('Origin', TEST_ORIGIN);
  }
  if (!headers.has('X-Proxy-Auth') && options.method === 'POST') {
    headers.set('X-Proxy-Auth', TEST_PROXY_TOKEN);
  }
  return new Request(`https://worker.test${url}`, { ...options, headers });
}

function createRequestWithoutAuth(url: string, options: RequestInit = {}): Request {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Origin')) {
    headers.set('Origin', TEST_ORIGIN);
  }
  return new Request(`https://worker.test${url}`, { ...options, headers });
}

function createFormData(entries: Record<string, string | Blob>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.append(key, value);
  }
  return formData;
}

function createMockResponse(body: string | object, options: { status?: number; headers?: Record<string, string> } = {}): Response {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(bodyStr, {
    status: options.status || 200,
    headers: new Headers(options.headers || {}),
  });
}

function createMockDurableObjectNamespace(): DurableObjectNamespace {
  const mockCORSHeaders = getCorsHeaders(TEST_ORIGIN);

  const mockStub = {
    fetch: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      if (method === 'OPTIONS') {
        return new Response(null, { headers: mockCORSHeaders, status: 204 });
      }

      if (method === 'POST' && path === '/upload/catbox') {
        const formData = await request.formData();
        const reqtype = formData.get('reqtype') as string;

        if (!reqtype) {
          return new Response(JSON.stringify({ error: 'Missing reqtype parameter' }), {
            status: 400,
            headers: { ...mockCORSHeaders, 'Content-Type': 'application/json' },
          });
        }

        if (reqtype === 'fileupload') {
          const file = formData.get('fileToUpload');
          if (!file) {
            return new Response('Missing fileToUpload parameter', { status: 400, headers: mockCORSHeaders });
          }
          return new Response('https://files.catbox.moe/abc123.png', { headers: mockCORSHeaders });
        }
        return new Response(JSON.stringify({ error: 'Unknown request type' }), {
          status: 400,
          headers: { ...mockCORSHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST' && path === '/upload/sxcu/collections') {
        return new Response(JSON.stringify({ id: '123' }), {
          headers: { ...mockCORSHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST' && path === '/upload/sxcu/files') {
        return new Response(JSON.stringify({ url: 'https://sxcu.net/abc' }), {
          headers: {
            ...mockCORSHeaders,
            'Content-Type': 'application/json',
            'X-RateLimit-Remaining': '49',
            'X-RateLimit-Limit': '50',
          },
        });
      }

      if (method === 'POST' && path === '/upload/imgchest/post') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          return new Response(JSON.stringify({ error: 'Imgchest API token not configured' }), {
            headers: { ...mockCORSHeaders, 'Content-Type': 'application/json' },
            status: 401,
          });
        }
        return new Response(JSON.stringify({ data: { id: 'post123' } }), {
          headers: { ...mockCORSHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (method === 'POST' && path.startsWith('/upload/imgchest/post/') && path.endsWith('/add')) {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader?.startsWith('Bearer ')) {
          return new Response(JSON.stringify({ error: 'Imgchest API token not configured' }), {
            headers: { ...mockCORSHeaders, 'Content-Type': 'application/json' },
            status: 401,
          });
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...mockCORSHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response('Not Found', { status: 404, headers: mockCORSHeaders });
    },
  };

  const namespace = {
    idFromName: ((name: string) => {
      return {
        toString: () => name,
      } as unknown as DurableObjectId;
    }) as (name: string) => DurableObjectId,
    get: ((_id: DurableObjectId) => {
      return mockStub;
    }) as (id: DurableObjectId) => DurableObjectStub,
  };

  return namespace as unknown as DurableObjectNamespace;
}

function createTestEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    PROXY_AUTH_TOKEN: TEST_PROXY_TOKEN,
    RATE_LIMITER: createMockDurableObjectNamespace(),
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

  test('POST without X-Proxy-Auth returns 401', async () => {
    const response = await workerDefault.fetch(
      createRequestWithoutAuth('/upload/catbox', { method: 'POST', body: createFormData({ reqtype: 'fileupload' }) }),
      createTestEnv()
    );
    expect(response.status).toBe(401);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('Unauthorized');
  });
});

describe('Catbox proxy', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('successful file upload', async () => {
    setMockFetch(mock(() =>
      Promise.resolve(createMockResponse('https://files.catbox.moe/abc123.png'))
    ));

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

  test('rejects urlupload reqtype (SSRF prevention)', async () => {
    const formData = createFormData({
      reqtype: 'urlupload',
      url: 'https://example.com/image.png',
    });
    const response = await workerDefault.fetch(
      createRequest('/upload/catbox', { method: 'POST', body: formData }),
      createTestEnv()
    );
    expect(response.status).toBe(400);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('Unknown request type');
  });

  test('rejects createalbum reqtype (SSRF prevention)', async () => {
    const formData = createFormData({
      reqtype: 'createalbum',
      files: 'abc.png def.png',
    });
    const response = await workerDefault.fetch(
      createRequest('/upload/catbox', { method: 'POST', body: formData }),
      createTestEnv()
    );
    expect(response.status).toBe(400);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('Unknown request type');
  });
});

describe('SXCU proxy', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('collection creation', async () => {
    setMockFetch(mock(() =>
      Promise.resolve(createMockResponse(JSON.stringify({ id: '123' })))
    ));

    const response = await workerDefault.fetch(
      createRequest('/upload/sxcu/collections', {
        method: 'POST',
        body: createFormData({ title: 'test' }),
      }),
      createTestEnv()
    );

    expect(response.status).toBe(200);
  });

  test('file upload with rate limit headers', async () => {
    const formData = new FormData();
    formData.append('file', new File(['test content'], 'test.png', { type: 'image/png' }));

    const response = await workerDefault.fetch(
      createRequest('/upload/sxcu/files', {
        method: 'POST',
        body: formData,
      }),
      createTestEnv()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('49');
  });
});

describe('Imgchest proxy', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('requires API token', async () => {
    const formData = new FormData();
    formData.append('images[]', new File(['test'], 'test.png', { type: 'image/png' }));

    const testEnv = { PROXY_AUTH_TOKEN: TEST_PROXY_TOKEN, RATE_LIMITER: createMockDurableObjectNamespace() };

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      testEnv
    );

    expect(response.status).toBe(401);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('Imgchest API token not configured');
  });

  test('post creation with token from env', async () => {
    const formData = new FormData();
    formData.append('images[]', new File(['test'], 'test.png', { type: 'image/png' }));

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      createTestEnv({ IMGCHEST_API_TOKEN: 'token123' })
    );

    expect(response.status).toBe(200);
  });

  test('post creation with custom authorization header', async () => {
    const formData = new FormData();
    formData.append('images[]', new File(['test'], 'test.png', { type: 'image/png' }));

    const headers = new Headers();
    headers.set('Origin', TEST_ORIGIN);
    headers.set('X-Proxy-Auth', TEST_PROXY_TOKEN);
    headers.set('Authorization', 'Bearer custom-token');

    const request = new Request('https://worker.test/upload/imgchest/post', {
      method: 'POST',
      body: formData,
      headers,
    });

    const response = await workerDefault.fetch(request, createTestEnv());

    expect(response.status).toBe(200);
  });

  test('sends authorization header from env', async () => {
    const formData = new FormData();
    formData.append('images[]', new File(['test'], 'test.png', { type: 'image/png' }));

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      createTestEnv({ IMGCHEST_API_TOKEN: 'secret-token' })
    );

    expect(response.status).toBe(200);
    const json = await response.json() as { data: { id: string } };
    expect(json.data.id).toBe('post123');
  });

  test('add images to existing post', async () => {
    const formData = new FormData();
    formData.append('images[]', new File(['test'], 'test.png', { type: 'image/png' }));

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post/myPostId/add', { method: 'POST', body: formData }),
      createTestEnv({ IMGCHEST_API_TOKEN: 'token' })
    );

    expect(response.status).toBe(200);
    const json = await response.json() as { success: boolean };
    expect(json.success).toBe(true);
  });
});

describe('Rate limiter not configured', () => {
  test('returns 500 when PROXY_AUTH_TOKEN is missing', async () => {
    const formData = new FormData();
    formData.append('images[]', new File(['test'], 'test.png', { type: 'image/png' }));

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      {}
    );

    expect(response.status).toBe(500);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('Server misconfigured');
  });
});
