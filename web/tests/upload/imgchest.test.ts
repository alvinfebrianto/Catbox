import { describe, expect, test, vi } from 'vitest';
import { uploadToImgchest } from '../../src/upload/imgchest';
import { ImgchestUploadInput } from '../../src/upload/contracts';
import { RecordingUploadObserver } from './recording-observer';

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

function baseInput(overrides: Partial<ImgchestUploadInput> = {}): ImgchestUploadInput {
  return {
    apiBaseUrl: 'https://proxy.test',
    files: [],
    urls: [],
    title: '',
    postId: '',
    anonymous: false,
    privacy: 'hidden',
    nsfw: true,
    ...overrides,
  };
}

describe('uploadToImgchest', () => {
  test('anonymous batch upload posts all files in a single request and streams results', async () => {
    const postResponse = {
      data: {
        id: 'abc123',
        image_count: 2,
        images: [
          { link: 'https://imgchest.com/i/img1.png' },
          { link: 'https://imgchest.com/i/img2.png' },
        ],
      },
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(postResponse));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [
        new File(['x'], 'cat.png', { type: 'image/png' }),
        new File(['y'], 'dog.png', { type: 'image/png' }),
      ],
      anonymous: true,
    });

    uploadToImgchest(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [reqUrl, reqInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(reqUrl).toBe('https://proxy.test/upload/imgchest/post');
    expect(reqInit.method).toBe('POST');
    const formData = reqInit.body as FormData;
    expect(formData.get('anonymous')).toBe('1');
    expect(formData.get('privacy')).toBe('hidden');
    expect(formData.get('nsfw')).toBe('true');
    const images = formData.getAll('images[]');
    expect(images).toHaveLength(2);

    expect(observer.results).toEqual([
      { result: { type: 'success', url: 'https://imgchest.com/p/abc123', isPost: true }, index: 0 },
      { result: { type: 'success', url: 'https://imgchest.com/i/img1.png' }, index: 1 },
      { result: { type: 'success', url: 'https://imgchest.com/i/img2.png' }, index: 2 },
    ]);

    expect(observer.doneWith[0]).toHaveLength(3);
    expect(observer.progress.at(-1)).toEqual({ percent: 100, label: 'Done!' });
  });

  test('progressive flow: first file creates post, subsequent files add to post', async () => {
    const createResponse = {
      data: { id: 'post1', image_count: 1, images: [{ link: 'https://imgchest.com/i/a.png' }] },
    };
    const addResponse = {
      data: { id: 'post1', image_count: 2, images: [{ link: 'https://imgchest.com/i/a.png' }, { link: 'https://imgchest.com/i/b.png' }] },
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createResponse))
      .mockResolvedValueOnce(jsonResponse(addResponse));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [
        new File(['x'], 'a.png', { type: 'image/png' }),
        new File(['y'], 'b.png', { type: 'image/png' }),
      ],
    });

    uploadToImgchest(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    // First call creates a post
    const [createUrl, createInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(createUrl).toBe('https://proxy.test/upload/imgchest/post');
    expect((createInit.body as FormData).has('title')).toBe(false);
    expect((createInit.body as FormData).get('privacy')).toBe('hidden');
    expect((createInit.body as FormData).get('nsfw')).toBe('true');

    // Second call adds to the post
    const [addUrl] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(addUrl).toBe('https://proxy.test/upload/imgchest/post/post1/add');

    expect(observer.results).toEqual([
      { result: { type: 'success', url: 'https://imgchest.com/p/post1', isPost: true }, index: 0 },
      { result: { type: 'success', url: 'https://imgchest.com/i/a.png' }, index: 1 },
      { result: { type: 'success', url: 'https://imgchest.com/i/b.png' }, index: 2 },
    ]);
  });

  test('progressive flow: first-file failure stops and finalizes immediately', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'Server error' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [
        new File(['x'], 'a.png', { type: 'image/png' }),
        new File(['y'], 'b.png', { type: 'image/png' }),
      ],
    });

    uploadToImgchest(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(observer.doneWith[0]).toHaveLength(1);
    expect(observer.doneWith[0][0].type).toBe('error');
    expect(observer.doneWith[0][0].message).toContain('a.png');
  });

  test('progressive flow: later-file failure continues to next file', async () => {
    const createResponse = {
      data: { id: 'post1', image_count: 1, images: [{ link: 'https://imgchest.com/i/a.png' }] },
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createResponse))
      .mockResolvedValueOnce(jsonResponse({ error: 'Second file failed' }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 'post1', image_count: 3, images: [{ link: 'https://imgchest.com/i/a.png' }, { link: 'https://imgchest.com/i/b.png' }, { link: 'https://imgchest.com/i/c.png' }] },
      }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [
        new File(['x'], 'a.png', { type: 'image/png' }),
        new File(['y'], 'b.png', { type: 'image/png' }),
        new File(['z'], 'c.png', { type: 'image/png' }),
      ],
    });

    uploadToImgchest(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Results: isPost(post1), a.png(success), b.png(error), c.png(success)
    expect(observer.doneWith[0]).toHaveLength(4);
    expect(observer.doneWith[0][0]).toEqual({ type: 'success', url: 'https://imgchest.com/p/post1', isPost: true });
    expect(observer.doneWith[0][1].type).toBe('success');
    expect(observer.doneWith[0][2].type).toBe('error');
    expect(observer.doneWith[0][3].type).toBe('success');
  });

  test('progressive-add-to-post always continues on error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'first failed' }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 'post1', image_count: 2, images: [{ link: 'https://imgchest.com/i/a.png' }, { link: 'https://imgchest.com/i/second.png' }] },
      }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [
        new File(['x'], 'first.png', { type: 'image/png' }),
        new File(['y'], 'second.png', { type: 'image/png' }),
      ],
      postId: 'existing-post',
    });

    uploadToImgchest(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    // Results: first.png(error), isPost(post1), second.png(success)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(observer.doneWith[0]).toHaveLength(3);
    expect(observer.doneWith[0][0].type).toBe('error');
    expect(observer.doneWith[0][1]).toEqual({ type: 'success', url: 'https://imgchest.com/p/post1', isPost: true });
    expect(observer.doneWith[0][2].type).toBe('success');
  });

  test('progressive-add-to-post: adds files one by one, emits isPost once, uses existingCount slice', async () => {
    const addResponse1 = {
      data: { id: 'post1', image_count: 2, images: [{ link: 'https://imgchest.com/i/existing.png' }, { link: 'https://imgchest.com/i/new1.png' }] },
    };
    const addResponse2 = {
      data: { id: 'post1', image_count: 3, images: [{ link: 'https://imgchest.com/i/existing.png' }, { link: 'https://imgchest.com/i/new1.png' }, { link: 'https://imgchest.com/i/new2.png' }] },
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(addResponse1))
      .mockResolvedValueOnce(jsonResponse(addResponse2));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [
        new File(['x'], 'new1.png', { type: 'image/png' }),
        new File(['y'], 'new2.png', { type: 'image/png' }),
      ],
      postId: 'existing-post',
    });

    uploadToImgchest(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    // Verify proxy URLs and form fields
    const [url1, init1] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url1).toBe('https://proxy.test/upload/imgchest/post/existing-post/add');
    expect((init1.body as FormData).get('privacy')).toBeNull();

    const [url2, init2] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url2).toBe('https://proxy.test/upload/imgchest/post/existing-post/add');
    expect((init2.body as FormData).get('privacy')).toBe('hidden');
    expect((init2.body as FormData).get('nsfw')).toBe('true');

    // Only one isPost result for the entire flow
    expect(observer.results.filter(r => r.result.isPost)).toHaveLength(1);
    expect(observer.doneWith[0]).toHaveLength(3);
    expect(observer.doneWith[0][0]).toEqual({ type: 'success', url: 'https://imgchest.com/p/post1', isPost: true });
  });

  test('batch fails wholesale when server returns an error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'Upload limit exceeded' }));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'a.png', { type: 'image/png' })],
      anonymous: true,
    });

    uploadToImgchest(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(observer.doneWith[0]).toHaveLength(1);
    expect(observer.doneWith[0][0].type).toBe('error');
    expect(observer.doneWith[0][0].message).toContain('Upload limit exceeded');
  });

  test('validation failure emits error immediately without fetching', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'bad.exe', { type: 'application/x-msdownload' })],
    });

    uploadToImgchest(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(observer.doneWith[0][0].type).toBe('error');
  });

  test('anonymous caps files at 20', async () => {
    const files: File[] = [];
    for (let i = 0; i < 25; i++) {
      files.push(new File([String(i)], i + '.png', { type: 'image/png' }));
    }

    const createResponse = {
      data: { id: 'abc', image_count: 20, images: Array.from({ length: 20 }, (_, i) => ({ link: 'https://imgchest.com/i/' + i + '.png' })) },
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createResponse));

    const observer = new RecordingUploadObserver();
    const input = baseInput({ files, anonymous: true });

    uploadToImgchest(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    const formData = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(formData.getAll('images[]')).toHaveLength(20);
  });

  test('progressive: first file title/privacy/nsfw sent on create, not on subsequent', async () => {
    const createResponse = {
      data: { id: 'post1', image_count: 1, images: [{ link: 'https://imgchest.com/i/a.png' }] },
    };
    const addResponse = {
      data: { id: 'post1', image_count: 2, images: [{ link: 'https://imgchest.com/i/a.png' }, { link: 'https://imgchest.com/i/b.png' }] },
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(createResponse))
      .mockResolvedValueOnce(jsonResponse(addResponse));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [
        new File(['x'], 'a.png', { type: 'image/png' }),
        new File(['y'], 'b.png', { type: 'image/png' }),
      ],
      title: 'My Post',
      privacy: 'public',
      nsfw: false,
    });

    uploadToImgchest(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    const createForm = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(createForm.get('title')).toBe('My Post');
    expect(createForm.get('privacy')).toBe('public');
    expect(createForm.get('nsfw')).toBe('false');

    const addForm = (fetchMock.mock.calls[1][1] as RequestInit).body as FormData;
    expect(addForm.get('title')).toBeNull();
    expect(addForm.get('privacy')).toBeNull();
    expect(addForm.get('nsfw')).toBeNull();
  });

  test('forwards apiToken as Authorization header', async () => {
    const postResponse = {
      data: { id: 'abc', image_count: 1, images: [{ link: 'https://imgchest.com/i/img.png' }] },
    };

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(postResponse));

    const observer = new RecordingUploadObserver();
    const input = baseInput({
      files: [new File(['x'], 'cat.png', { type: 'image/png' })],
      anonymous: true,
      apiToken: 'my-token',
    });

    uploadToImgchest(input, observer, fetchMock as unknown as typeof fetch);
    await vi.waitFor(() => expect(observer.doneWith).toHaveLength(1));

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-token');
  });
});
