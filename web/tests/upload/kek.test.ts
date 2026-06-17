import { describe, expect, test, vi } from 'vitest';
import { uploadToKek } from '../../src/upload/kek';
import { KekUploadInput } from '../../src/upload/contracts';
import { RecordingUploadObserver } from './recording-observer';

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function baseInput(overrides: Partial<KekUploadInput> = {}): KekUploadInput {
  return {
    apiBaseUrl: 'https://proxy.test',
    files: [],
    urls: [],
    mature: false,
    ...overrides,
  };
}

describe('uploadToKek', () => {
  test('uploads files then URLs in order and streams incremental results', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ filename: 'cat.png' }))
      .mockResolvedValueOnce(jsonResponse({ filename: 'dog.png' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'photo.png', { type: 'image/png' })],
      urls: ['https://example.com/remote.png'],
    });

    uploadToKek(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    // file first, then url
    const [fileUrl, fileInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(fileUrl).toBe('https://proxy.test/upload/kek/posts');
    expect(fileInit.method).toBe('POST');

    const fileFormData = fileInit.body as FormData;
    expect(fileFormData.has('file')).toBe(true);
    expect(fileFormData.get('file')).toBeInstanceOf(File);
    expect(fileFormData.has('url')).toBe(false);

    const [, urlInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const urlFormData = urlInit.body as FormData;
    expect(urlFormData.get('url')).toBe('https://example.com/remote.png');
    expect(urlFormData.has('file')).toBe(false);

    // results streamed incrementally with correct indices
    expect(observer.results).toEqual([
      { result: { type: 'success', url: 'https://i.kek.sh/cat.png' }, index: 0 },
      { result: { type: 'success', url: 'https://i.kek.sh/dog.png' }, index: 1 },
    ]);

    // onDone fires with the full canonical array
    expect(observer.doneWith[0]).toEqual([
      { type: 'success', url: 'https://i.kek.sh/cat.png' },
      { type: 'success', url: 'https://i.kek.sh/dog.png' },
    ]);
    expect(observer.progress.at(-1)).toEqual({ percent: 100, label: 'Done!' });
  });

  test('appends mature flag to form data when true', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ filename: 'cat.png' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
      mature: true,
    });

    uploadToKek(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    const formData = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(formData.get('mature')).toBe('true');
  });

  test('appends mature flag as false when mature is false', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ filename: 'cat.png' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
      mature: false,
    });

    uploadToKek(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    const formData = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(formData.get('mature')).toBe('false');
  });

  test('sets X-Kek-Auth header when apiKey is provided', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ filename: 'cat.png' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
      apiKey: 'my-secret-key',
    });

    uploadToKek(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Kek-Auth']).toBe('my-secret-key');
  });

  test('omits X-Kek-Auth header when apiKey is not provided', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ filename: 'cat.png' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
    });

    uploadToKek(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Kek-Auth']).toBeUndefined();
  });

  test('shapes result URL as https://i.kek.sh/<filename>', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ filename: 'my-photo.png' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'photo.png', { type: 'image/png' })],
    });

    uploadToKek(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(observer.doneWith[0][0]).toEqual({
      type: 'success',
      url: 'https://i.kek.sh/my-photo.png',
    });
  });

  test('surfaces data.error into the result message', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'File type not allowed' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'bad.png', { type: 'image/png' })],
    });

    uploadToKek(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(observer.doneWith[0][0]).toEqual({
      type: 'error',
      message: 'Failed to upload bad.png: File type not allowed',
    });
  });

  test('handles missing filename in response as error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
    });

    uploadToKek(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(observer.doneWith[0][0].type).toBe('error');
  });

  test('continues on per-item error and completes remaining items', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'first failed' }))
      .mockResolvedValueOnce(jsonResponse({ filename: 'second.png' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [
        new File(['x'], 'first.png', { type: 'image/png' }),
        new File(['x'], 'second.png', { type: 'image/png' }),
      ],
    });

    uploadToKek(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(observer.doneWith[0]).toEqual([
      { type: 'error', message: 'Failed to upload first.png: first failed' },
      { type: 'success', url: 'https://i.kek.sh/second.png' },
    ]);
  });

  test('forwards auth headers on every request', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ filename: 'a.png' }))
      .mockResolvedValueOnce(jsonResponse({ filename: 'b.png' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'a.png', { type: 'image/png' })],
      urls: ['https://example.com/b.png'],
      authHeaders: { Authorization: 'Bearer test-token' },
    });

    uploadToKek(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    }
  });

  test('handles unexpected non-JSON response as error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
    });

    uploadToKek(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(observer.doneWith[0][0].type).toBe('error');
    expect((observer.doneWith[0][0] as { message?: string }).message).toContain('cat.png');
  });
});
