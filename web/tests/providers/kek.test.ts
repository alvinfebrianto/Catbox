import { describe, expect, test, vi } from 'vitest';
import { uploadToKek, readKekUploadInput, KekUploadInput, KekProviderInputError } from '../../src/providers/kek';
function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? { 'Content-Type': 'application/json' }),
  });
}

describe('uploadToKek', () => {
  test('uploads a file to /posts with x-kek-auth header', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'p1', url: 'https://kek.sh/i/p1' }));

    const input: KekUploadInput = {
      apiKey: 'kek-test-key',
      files: [new File(['hello'], 'cat.png', { type: 'image/png' })],
      mature: false,
    };    await uploadToKek(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://kek.sh/api/v1/posts');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-kek-auth']).toBe('kek-test-key');
  });

  test('uploads a url to /posts instead of a file', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'p2', url: 'https://kek.sh/i/p2' }));

    const input: KekUploadInput = {
      apiKey: 'kek-test-key',
      url: 'https://example.com/cat.png',
      mature: false,
    };

    await uploadToKek(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const formData = init.body as FormData;
    expect(formData.get('url')).toBe('https://example.com/cat.png');
    expect(formData.getAll('file')).toEqual([]);
  });

  test('retries on 429 until success', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p3', url: 'https://kek.sh/i/p3' }));

    const input: KekUploadInput = {
      apiKey: 'kek-test-key',
      url: 'https://example.com/cat.png',
      mature: false,
    };

    const result = await uploadToKek(input, {
      fetch: fetchMock as unknown as typeof fetch,
      retryConfig: { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 5, jitterMs: 0 },
      sleep: async () => {},
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe(200);
  });

  test('returns parsed JSON body and follows up with mature PUT when mature is unset', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'p9', url: 'https://kek.sh/i/p9' }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const input: KekUploadInput = {
      apiKey: 'kek-test-key',
      url: 'https://example.com/cat.png',
    };

    const result = await uploadToKek(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: 'p9', url: 'https://kek.sh/i/p9' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [matureUrl, matureInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(matureUrl).toBe('https://kek.sh/api/v1/posts/p9/mature');
    expect(matureInit.method).toBe('PUT');
    expect((matureInit.headers as Record<string, string>)['x-kek-auth']).toBe('kek-test-key');
    expect(JSON.parse(matureInit.body as string)).toEqual({ value: true });
  });

  test('skips mature PUT when mature is false', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'p10', url: 'https://kek.sh/i/p10' }));

    const input: KekUploadInput = {
      apiKey: 'kek-test-key',
      url: 'https://example.com/safe.png',
      mature: false,
    };

    await uploadToKek(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('mature PUT failure does not break upload response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'p11', url: 'https://kek.sh/i/p11' }))
      .mockRejectedValueOnce(new Error('mature endpoint down'));

    const input: KekUploadInput = {
      apiKey: 'kek-test-key',
      url: 'https://example.com/cat.png',
    };

    const result = await uploadToKek(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: 'p11', url: 'https://kek.sh/i/p11' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('mature PUT 500 does not break upload response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'p12', url: 'https://kek.sh/i/p12' }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));

    const input: KekUploadInput = {
      apiKey: 'kek-test-key',
      url: 'https://example.com/cat.png',
    };

    const result = await uploadToKek(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(result.status).toBe(200);
  });

  test('does not call mature PUT when upload response is not 2xx', async () => {
    const fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }));

    const input: KekUploadInput = {
      apiKey: 'kek-test-key',
      url: 'https://example.com/cat.png',
    };

    await uploadToKek(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('does not call mature PUT when response body has no id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, note: 'no id here' }));

    const input: KekUploadInput = {
      apiKey: 'kek-test-key',
      url: 'https://example.com/cat.png',
    };

    await uploadToKek(input, { fetch: fetchMock as unknown as typeof fetch });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('readKekUploadInput', () => {
  function makeForm(entries: Record<string, string>): FormData {
    const form = new FormData();
    for (const [key, value] of Object.entries(entries)) {
      form.append(key, value);
    }
    return form;
  }

  test('throws when neither file nor url is provided', () => {
    const form = makeForm({ mature: 'true' });

    expect(() => readKekUploadInput(form, 'kek-key')).toThrow(KekProviderInputError);
  });

  test('throws when both file and url are provided', () => {
    const form = new FormData();
    form.append('file', new File(['x'], 'cat.png'));
    form.append('url', 'https://example.com/cat.png');

    expect(() => readKekUploadInput(form, 'kek-key')).toThrow(/Cannot upload both/);
  });

  test('throws on invalid url', () => {
    const form = makeForm({ url: 'not-a-url' });

    expect(() => readKekUploadInput(form, 'kek-key')).toThrow(/Invalid URL/);
  });

  test('uses header API key when present, ignoring env fallback', () => {
    const form = new FormData();
    form.append('url', 'https://example.com/cat.png');

    const input = readKekUploadInput(form, 'env-key', 'header-key');

    expect(input.apiKey).toBe('header-key');
  });

  test('falls back to env key when header absent', () => {
    const form = new FormData();
    form.append('url', 'https://example.com/cat.png');

    const input = readKekUploadInput(form, 'env-key');

    expect(input.apiKey).toBe('env-key');
  });

  test('throws when no API key is available', () => {
    const form = new FormData();
    form.append('url', 'https://example.com/cat.png');

    expect(() => readKekUploadInput(form)).toThrow(KekProviderInputError);
  });

  test('treats mature != "false" as true', () => {
    const form = new FormData();
    form.append('url', 'https://example.com/cat.png');
    form.append('mature', 'true');

    const input = readKekUploadInput(form, 'kek-key');
    expect(input.mature).toBe(true);
  });

  test('treats mature === "false" exactly as false', () => {
    const form = new FormData();
    form.append('url', 'https://example.com/cat.png');
    form.append('mature', 'false');

    const input = readKekUploadInput(form, 'kek-key');
    expect(input.mature).toBe(false);
  });
});
