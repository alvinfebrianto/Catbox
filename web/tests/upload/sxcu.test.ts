import { afterEach, describe, expect, test, vi } from 'vitest';
import { uploadToSxcu } from '../../src/upload/sxcu';
import { SxcuUploadInput } from '../../src/upload/contracts';
import { RecordingUploadObserver } from './recording-observer';

function jsonResponse(body: unknown, init: { status?: number; statusText?: string; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function baseInput(overrides: Partial<SxcuUploadInput> = {}): SxcuUploadInput {
  return {
    apiBaseUrl: 'https://proxy.test',
    files: [],
    urls: [],
    title: 'My Collection',
    description: 'A description',
    createCollection: false,
    private: false,
    ...overrides,
  };
}

async function flushPromises(turns = 50): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

describe('uploadToSxcu', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('uploads at most four files per burst and waits 200ms between bursts', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const file = (init?.body as FormData).get('file') as File;
      return jsonResponse(
        { url: 'https://sxcu.net/' + file.name },
        { headers: { 'X-RateLimit-Limit': '5', 'X-RateLimit-Remaining': '5' } },
      );
    });

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [
        new File(['x'], '1.png', { type: 'image/png' }),
        new File(['x'], '2.png', { type: 'image/png' }),
        new File(['x'], '3.png', { type: 'image/png' }),
        new File(['x'], '4.png', { type: 'image/png' }),
        new File(['x'], '5.png', { type: 'image/png' }),
      ],
    });

    const promise = uploadToSxcu(input, observer, fetchMock as unknown as typeof fetch);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(1);
    const results = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(results).toHaveLength(5);
    expect(observer.progress.at(-1)).toEqual({ percent: 100, label: 'Done!' });
  });

  test('pre-creates a collection and sends collection fields on file uploads', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ collection_id: 'coll123', collection_token: 'token456' }))
      .mockResolvedValueOnce(jsonResponse({ url: 'https://sxcu.net/file.png' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'file.png', { type: 'image/png' })],
      createCollection: true,
      private: true,
    });

    const results = await uploadToSxcu(input, observer, fetchMock as unknown as typeof fetch);

    const [collectionUrl, collectionInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(collectionUrl).toBe('https://proxy.test/upload/sxcu/collections');
    const collectionBody = collectionInit.body as FormData;
    expect(collectionBody.get('title')).toBe('My Collection');
    expect(collectionBody.get('desc')).toBe('A description');
    expect(collectionBody.get('private')).toBe('true');
    expect(collectionBody.get('unlisted')).toBe('false');

    const [fileUrl, fileInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(fileUrl).toBe('https://proxy.test/upload/sxcu/files');
    const fileBody = fileInit.body as FormData;
    expect(fileBody.get('file')).toBeInstanceOf(File);
    expect(fileBody.get('noembed')).toBe('true');
    expect(fileBody.get('collection')).toBe('coll123');
    expect(fileBody.get('collection_token')).toBe('token456');
    expect((fileInit.headers as Record<string, string>)['User-Agent']).toBe('sxcuUploader/1.0');

    expect(observer.results[0]).toEqual({
      result: { type: 'success', url: 'https://sxcu.net/c/coll123', isCollection: true },
      index: 0,
    });
  });

  test('clamps the next burst to the current remaining rate-limit count', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const file = (init?.body as FormData).get('file') as File;
      return jsonResponse(
        { url: 'https://sxcu.net/' + file.name },
        { headers: { 'X-RateLimit-Limit': '5', 'X-RateLimit-Remaining': file.name === '4.png' ? '2' : '5' } },
      );
    });

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: Array.from({ length: 7 }, (_, i) => new File(['x'], `${i + 1}.png`, { type: 'image/png' })),
    });

    const promise = uploadToSxcu(input, observer, fetchMock as unknown as typeof fetch);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(6);

    await vi.advanceTimersByTimeAsync(200);
    const results = await promise;
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  test('waits on a mid-burst 429, emits countdown ticks, resumes, and uploads remaining files', async () => {
    vi.useFakeTimers();

    let retriedTwo = false;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const file = (init?.body as FormData).get('file') as File;
      if (file.name === '2.png' && !retriedTwo) {
        retriedTwo = true;
        return jsonResponse(
          { error: 'Too Many Requests', rateLimitResetAfter: '1' },
          { status: 429, headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '1' } },
        );
      }

      return jsonResponse(
        { url: 'https://sxcu.net/' + file.name },
        { headers: { 'X-RateLimit-Limit': '5', 'X-RateLimit-Remaining': '5' } },
      );
    });

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [
        new File(['x'], '1.png', { type: 'image/png' }),
        new File(['x'], '2.png', { type: 'image/png' }),
        new File(['x'], '3.png', { type: 'image/png' }),
      ],
    });

    const promise = uploadToSxcu(input, observer, fetchMock as unknown as typeof fetch);
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(observer.results).toEqual([
      { result: { type: 'success', url: 'https://sxcu.net/1.png' }, index: 0 },
    ]);
    expect(observer.rateLimitWaits).toEqual([2]);
    expect(observer.progress.at(-1)?.percent).toBeCloseTo(100 / 3);
    expect(observer.progress.at(-1)?.label).toBe('Rate limited. Waiting 2s...');

    await vi.advanceTimersByTimeAsync(1000);
    expect(observer.rateLimitWaits).toEqual([2, 1]);

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(observer.rateLimitWaits).toEqual([2, 1, 0]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(results).toEqual([
      { type: 'success', url: 'https://sxcu.net/1.png' },
      { type: 'success', url: 'https://sxcu.net/2.png' },
      { type: 'success', url: 'https://sxcu.net/3.png' },
    ]);
  });

  test('resolves the returned promise with the full results array', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ url: 'https://sxcu.net/1.png' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({ files: [new File(['x'], '1.png', { type: 'image/png' })] });

    const resolved = await uploadToSxcu(input, observer, fetchMock as unknown as typeof fetch);

    expect(resolved).toEqual([{ type: 'success', url: 'https://sxcu.net/1.png' }]);
  });

  test('rejects the returned promise on an unexpected throw', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const throwingObserver = new RecordingUploadObserver();
    throwingObserver.onProgress = () => {
      throw new Error('boom');
    };
    const input = baseInput({ files: [new File(['x'], '1.png', { type: 'image/png' })] });

    await expect(
      uploadToSxcu(input, throwingObserver, fetchMock as unknown as typeof fetch),
    ).rejects.toThrow('boom');
  });
});
