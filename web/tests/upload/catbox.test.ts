import { describe, expect, test, vi } from 'vitest';
import { uploadToCatbox } from '../../src/upload/catbox';
import { CatboxUploadInput } from '../../src/upload/contracts';
import { RecordingUploadObserver } from './recording-observer';

function textResponse(body: string, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(body, { status: init.status ?? 200, statusText: init.statusText });
}

function baseInput(overrides: Partial<CatboxUploadInput> = {}): CatboxUploadInput {
  return {
    apiBaseUrl: 'https://proxy.test',
    files: [],
    urls: [],
    title: 'My Album',
    description: 'A description',
    createAlbum: false,
    ...overrides,
  };
}

describe('uploadToCatbox', () => {
  test('uploads files then URLs in order and streams incremental results', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(textResponse('https://files.catbox.moe/a.png'))
      .mockResolvedValueOnce(textResponse('https://files.catbox.moe/b.png'));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
      urls: ['https://example.com/remote.png'],
    });

    uploadToCatbox(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    // file first, then url
    const [fileUrl, fileInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(fileUrl).toBe('https://proxy.test/upload/catbox');
    expect(fileInit.method).toBe('POST');
    expect((fileInit.body as FormData).get('reqtype')).toBe('fileupload');
    expect((fileInit.body as FormData).get('fileToUpload')).toBeInstanceOf(File);

    const [, urlInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect((urlInit.body as FormData).get('reqtype')).toBe('urlupload');
    expect((urlInit.body as FormData).get('url')).toBe('https://example.com/remote.png');

    // results streamed incrementally with correct indices
    expect(observer.results).toEqual([
      { result: { type: 'success', url: 'https://files.catbox.moe/a.png' }, index: 0 },
      { result: { type: 'success', url: 'https://files.catbox.moe/b.png' }, index: 1 },
    ]);

    // onDone fires with the full canonical array
    expect(observer.doneWith[0]).toEqual([
      { type: 'success', url: 'https://files.catbox.moe/a.png' },
      { type: 'success', url: 'https://files.catbox.moe/b.png' },
    ]);
    // progress bar reaches 100 / Done!
    expect(observer.progress.at(-1)).toEqual({ percent: 100, label: 'Done!' });
  });

  test('creates an album gated on createAlbum, marking the result isAlbum', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(textResponse('https://files.catbox.moe/a.png'))
      .mockResolvedValueOnce(textResponse('abc123'));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
      createAlbum: true,
    });

    uploadToCatbox(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    const [, albumInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const albumBody = albumInit.body as FormData;
    expect(albumBody.get('reqtype')).toBe('createalbum');
    expect(albumBody.get('title')).toBe('My Album');
    expect(albumBody.get('desc')).toBe('A description');
    expect(albumBody.get('files')).toBe('a.png');

    const albumResult = observer.doneWith[0].at(-1);
    expect(albumResult).toEqual({ type: 'success', url: 'https://catbox.moe/album/abc123', isAlbum: true });
  });

  test('uses the album code verbatim when it already starts with http', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(textResponse('https://files.catbox.moe/a.png'))
      .mockResolvedValueOnce(textResponse('https://catbox.moe/album/xyz'));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
      createAlbum: true,
    });

    uploadToCatbox(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(observer.doneWith[0].at(-1)).toEqual({
      type: 'success',
      url: 'https://catbox.moe/album/xyz',
      isAlbum: true,
    });
  });

  test('skips album creation when no uploads succeeded', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(textResponse('nope', { status: 500, statusText: 'Server Error' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
      createAlbum: true,
    });

    uploadToCatbox(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    // only the file-upload call happened; no createalbum request
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const done = observer.doneWith[0];
    expect(done).toHaveLength(1);
    expect(done[0].type).toBe('error');
    expect(done.some(r => r.isAlbum)).toBe(false);
  });

  test('records a failed upload as an error result and still completes', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(textResponse('bad', { status: 500, statusText: 'Server Error' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({ files: [new File(['x'], 'cat.png', { type: 'image/png' })] });

    uploadToCatbox(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(observer.doneWith[0]).toEqual([
      { type: 'error', message: 'Failed to upload cat.png: Upload failed: Server Error' },
    ]);
  });

  test('forwards auth headers on every request', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(textResponse('https://files.catbox.moe/a.png'))
      .mockResolvedValueOnce(textResponse('abc123'));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
      createAlbum: true,
      authHeaders: { Authorization: 'Bearer t' },
    });

    uploadToCatbox(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    }
  });
});
