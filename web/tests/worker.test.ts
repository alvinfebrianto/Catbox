import { test, expect, describe, mock, afterEach } from 'bun:test';
import workerDefault from '../src/worker';

const originalFetch = globalThis.fetch;

function setMockFetch(fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn as typeof fetch;
}

function createRequest(url: string, options: RequestInit = {}): Request {
  return new Request(`https://worker.test${url}`, options);
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

describe('CORS and routing', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('OPTIONS returns CORS preflight response', async () => {
    const request = createRequest('/any-path', { method: 'OPTIONS' });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
  });

  test('unknown routes return 404', async () => {
    const response = await workerDefault.fetch(
      createRequest('/unknown', { method: 'POST' }),
      {}
    );
    expect(response.status).toBe(404);
  });

  test('GET requests return 404', async () => {
    const response = await workerDefault.fetch(
      createRequest('/upload/catbox', { method: 'GET' }),
      {}
    );
    expect(response.status).toBe(404);
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

    const formData = createFormData({
      reqtype: 'fileupload',
      fileToUpload: new Blob(['test content']),
    });
    const response = await workerDefault.fetch(
      createRequest('/upload/catbox', { method: 'POST', body: formData }),
      {}
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('https://files.catbox.moe/abc123.png');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  test('validates required parameters', async () => {
    const testCases = [
      { formData: {}, expectedError: 'Missing reqtype' },
      { formData: { reqtype: 'fileupload' }, expectedError: 'Missing fileToUpload' },
      { formData: { reqtype: 'urlupload' }, expectedError: 'Missing url' },
      { formData: { reqtype: 'deletefiles' }, expectedError: 'Missing files' },
    ];

    for (const { formData, expectedError } of testCases) {
      const response = await workerDefault.fetch(
        createRequest('/upload/catbox', { method: 'POST', body: createFormData(formData as Record<string, string>) }),
        {}
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toContain(expectedError);
    }
  });

  test('album creation includes all parameters', async () => {
    let capturedBody: FormData | null = null;
    setMockFetch(mock((_url, options) => {
      capturedBody = options?.body as FormData;
      return Promise.resolve(createMockResponse('https://catbox.moe/c/abcdef'));
    }));

    const formData = createFormData({
      reqtype: 'createalbum',
      files: 'abc.png def.png',
      title: 'My Album',
      desc: 'Description',
      userhash: 'myhash',
    });
    await workerDefault.fetch(
      createRequest('/upload/catbox', { method: 'POST', body: formData }),
      {}
    );

    expect(capturedBody!.get('title')).toBe('My Album');
    expect(capturedBody!.get('desc')).toBe('Description');
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
      {}
    );

    expect(response.status).toBe(200);
  });

  test('file upload with rate limit headers', async () => {
    setMockFetch(mock(() =>
      Promise.resolve(
        createMockResponse(JSON.stringify({ url: 'https://sxcu.net/abc' }), {
          headers: { 'X-RateLimit-Remaining': '49', 'X-RateLimit-Limit': '50' },
        })
      )
    ));

    const response = await workerDefault.fetch(
      createRequest('/upload/sxcu/files', {
        method: 'POST',
        body: createFormData({ file: new Blob(['test']) }),
      }),
      {}
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
    formData.append('images[]', new Blob(['test']));

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      {}
    );

    expect(response.status).toBe(401);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('Imgchest API token not configured');
  });

  test('post creation with token', async () => {
    setMockFetch(mock(() =>
      Promise.resolve(
        createMockResponse(JSON.stringify({ data: { id: 'post123' } }))
      )
    ));

    const formData = new FormData();
    formData.append('images[]', new Blob(['test']));

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      { IMGCHEST_API_TOKEN: 'token123' }
    );

    expect(response.status).toBe(200);
  });

  test('sends authorization header', async () => {
    let capturedHeaders: Record<string, string> = {};
    setMockFetch(mock((_url, options) => {
      capturedHeaders = options?.headers as Record<string, string>;
      return Promise.resolve(
        createMockResponse(JSON.stringify({ data: { id: '123' } }))
      );
    }));

    const formData = new FormData();
    formData.append('images[]', new Blob(['test']));

    await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      { IMGCHEST_API_TOKEN: 'secret-token' }
    );

    expect(capturedHeaders['Authorization']).toBe('Bearer secret-token');
  });

  test('chunks large uploads across multiple requests', async () => {
    const calls: { url: string | URL | Request; body: FormData }[] = [];
    setMockFetch(mock((url, options) => {
      calls.push({ url, body: options?.body as FormData });
      return Promise.resolve(
        createMockResponse(JSON.stringify({ data: { id: 'post123' } }))
      );
    }));

    const formData = new FormData();
    for (let i = 0; i < 25; i++) {
      formData.append('images[]', new Blob([`image${i}`]));
    }

    await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      { IMGCHEST_API_TOKEN: 'token' }
    );

    expect(calls.length).toBe(2);
    expect(calls[0].url).toBe('https://api.imgchest.com/v1/post');
    expect(calls[1].url).toBe('https://api.imgchest.com/v1/post/post123/add');
  });

  test('add images to existing post', async () => {
    let capturedUrl = '';
    setMockFetch(mock((url) => {
      capturedUrl = url as string;
      return Promise.resolve(createMockResponse(JSON.stringify({ success: true })));
    }));

    const formData = new FormData();
    formData.append('images[]', new Blob(['test']));

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post/myPostId/add', { method: 'POST', body: formData }),
      { IMGCHEST_API_TOKEN: 'token' }
    );

    expect(response.status).toBe(200);
    expect(capturedUrl).toBe('https://api.imgchest.com/v1/post/myPostId/add');
  });

  test('handles JSON parse errors', async () => {
    setMockFetch(mock(() =>
      Promise.resolve(createMockResponse('Invalid JSON {'))
    ));

    const formData = new FormData();
    formData.append('images[]', new Blob(['test']));

    const response = await workerDefault.fetch(
      createRequest('/upload/imgchest/post', { method: 'POST', body: formData }),
      { IMGCHEST_API_TOKEN: 'token' }
    );

    expect(response.status).toBe(500);
    const json = await response.json() as { error: string };
    expect(json.error).toBe('Failed to parse JSON');
  });
});
