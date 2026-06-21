// @vitest-environment jsdom
import { test, expect, describe, beforeEach, afterEach, vi } from 'vitest';
import { ImageUploader } from '../src/app';
import type { Provider, UploadResult } from '../src/types';

function setupHtml(): string {
  return `
    <form id="uploadForm">
      <select id="provider">
        <option value="catbox">catbox</option>
        <option value="sxcu">sxcu</option>
        <option value="imgchest" selected>imgchest</option>
        <option value="kek">kek</option>
      </select>

      <input type="file" id="files" name="files" multiple>

      <div id="dropZone">
        <div class="upload-prompt">
          <p>Drag and drop files here or click to browse</p>
          <p class="hint" id="fileTypesHint"></p>
        </div>
      </div>

      <div id="fileList" class="file-list"></div>

      <div id="urlGroup">
        <input type="text" id="urls" name="urls">
      </div>

      <div id="titleGroup">
        <input type="text" id="title" name="title">
      </div>

      <div id="descriptionGroup">
        <input type="text" id="description" name="description">
      </div>

      <div id="createCollectionGroup">
        <label>
          <input type="checkbox" id="createCollection" name="createCollection" checked>
          Create Collection
        </label>
      </div>

      <div id="sxcuOptions" class="hidden">
        <div>
          <label>
            <input type="checkbox" id="sxcuPrivate" name="sxcuPrivate" checked>
            Private Collection
          </label>
        </div>
      </div>

      <div id="anonymousGroup">
        <label>
          <input type="checkbox" id="anonymous" name="anonymous" checked>
          Anonymous
        </label>
      </div>

      <div id="imgchestOptions" class="hidden">
        <select id="imgchestPrivacy" name="imgchestPrivacy">
          <option value="public">Public</option>
          <option value="hidden" selected>Hidden</option>
          <option value="secret">Secret</option>
        </select>
        <label>
          <input type="checkbox" id="imgchestNsfw" name="imgchestNsfw" checked>
          NSFW
        </label>
      </div>

      <div id="imgchestApiKeyGroup" class="hidden">
        <input type="password" id="imgchestApiKey" name="imgchestApiKey">
        <button type="button" id="toggleApiKeyVisibility" title="Toggle visibility">👁</button>
      </div>

      <div id="kekApiKeyGroup" class="hidden">
        <input type="password" id="kekApiKey" name="kekApiKey">
        <button type="button" id="toggleKekApiKeyVisibility" title="Toggle visibility">👁</button>
      </div>

      <div id="kekMatureGroup" class="hidden">
        <label>
          <input type="checkbox" id="kekMature" name="kekMature" checked>
          Mature (NSFW)
        </label>
      </div>

      <div id="createAlbumGroup" class="hidden">
        <label>
          <input type="checkbox" id="createAlbum" name="createAlbum" checked>
          Create Album
        </label>
      </div>

      <div id="postIdGroup">
        <input type="text" id="postId" name="postId" placeholder="e.g., xxxxxxxx">
      </div>

      <button type="submit" id="uploadBtn" class="btn btn-primary">
        <span class="btn-text">Upload</span>
        <span class="btn-loading" style="display: none;">Uploading...</span>
      </button>
    </form>

    <div id="results" class="results" style="display: none;">
      <h2>Results</h2>
      <div id="resultsContent"></div>
    </div>

    <div id="progress" class="progress" style="display: none;">
      <div class="progress-bar">
        <div id="progressFill"></div>
      </div>
      <p id="progressText">Uploading...</p>
    </div>
  `;
}

function createFileList(files: File[]): FileList {
  const list = {
    length: files.length,
    item(index: number): File | null {
      return files[index] ?? null;
    },
  } as unknown as FileList;
  for (let i = 0; i < files.length; i++) {
    (list as any)[i] = files[i];
  }
  return list;
}

describe('ImageUploader', () => {
  let uploader: ImageUploader;

  beforeEach(() => {
    document.body.innerHTML = setupHtml();
    vi.stubGlobal('API_BASE_URL', 'http://localhost:3000');
    Element.prototype.scrollIntoView = vi.fn();
    sessionStorage.clear();
    localStorage.clear();
    uploader = new ImageUploader();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  describe('File validation', () => {
    test('accepts valid image extensions', () => {
      const validFiles = createFileList([
        new File([''], 'photo.png', { type: 'image/png' }),
        new File([''], 'image.jpg', { type: 'image/jpeg' }),
        new File([''], 'animation.gif', { type: 'image/gif' }),
        new File([''], 'picture.webp', { type: 'image/webp' }),
      ]);

      (uploader as any).addFiles(validFiles);

      expect((uploader as any).files.length).toBe(4);
    });

    test('rejects non-image files', () => {
      const invalidFiles = createFileList([
        new File([''], 'document.pdf', { type: 'application/pdf' }),
        new File([''], 'script.js', { type: 'application/javascript' }),
        new File([''], 'data.json', { type: 'application/json' }),
        new File([''], 'malware.exe', { type: 'application/x-msdownload' }),
      ]);

      (uploader as any).addFiles(invalidFiles);

      expect((uploader as any).files.length).toBe(0);
    });

    test('prevents duplicate files by name and size', () => {
      const file1 = new File(['content'], 'photo.png', { type: 'image/png' });
      const file2 = new File(['content'], 'photo.png', { type: 'image/png' });

      (uploader as any).addFiles(createFileList([file1]));
      (uploader as any).addFiles(createFileList([file2]));
      (uploader as any).addFiles(createFileList([new File(['content'], 'photo.png', { type: 'image/png' })]));

      expect((uploader as any).files.length).toBe(1);
    });

    test('allows same filename with different size', () => {
      (uploader as any).addFiles(createFileList([new File(['a'], 'photo.png', { type: 'image/png' })]));
      (uploader as any).addFiles(createFileList([new File(['ab'], 'photo.png', { type: 'image/png' })]));

      expect((uploader as any).files.length).toBe(2);
    });

    test('removes file at specified index', () => {
      (uploader as any).addFiles(createFileList([
        new File([''], 'a.png', { type: 'image/png' }),
        new File([''], 'b.png', { type: 'image/png' }),
        new File([''], 'c.png', { type: 'image/png' }),
      ]));

      (uploader as any).removeFile(1);

      expect((uploader as any).files.length).toBe(2);
      expect((uploader as any).files[0].name).toBe('a.png');
      expect((uploader as any).files[1].name).toBe('c.png');
    });
  });

  describe('Auto-title generation', () => {
    test('uses filename without extension when no folder path', () => {
      (uploader as any).addFiles(createFileList([
        new File([''], 'vacation-photo.png', { type: 'image/png' }),
      ]));

      expect((document.getElementById('title') as HTMLInputElement).value).toBe('vacation-photo');
    });

    test('uses folder name when file has relative path', () => {
      const file = new File([''], 'photo.png', { type: 'image/png' });
      (file as any).webkitRelativePath = 'MyAlbum/subfolder/photo.png';

      (uploader as any).addFiles(createFileList([file]));

      expect((document.getElementById('title') as HTMLInputElement).value).toBe('subfolder');
    });

    test('does not overwrite existing title', () => {
      const titleInput = document.getElementById('title') as HTMLInputElement;
      titleInput.value = 'My Custom Title';
      (uploader as any).addFiles(createFileList([
        new File([''], 'photo.png', { type: 'image/png' }),
      ]));

      expect(titleInput.value).toBe('My Custom Title');
    });
  });

  describe('Form submission', () => {
    test('shows error when no files or URLs provided', () => {
      (uploader as any).handleSubmit({ preventDefault: () => {} });

      const resultsContent = document.getElementById('resultsContent')!;
      expect(resultsContent.textContent).toContain('Please select at least one file or enter URLs');
    });

    test('allows submission with URLs only', async () => {
      const urlsInput = document.getElementById('urls') as HTMLInputElement;
      urlsInput.value = 'http://example.com/image.png';

      let providerCalled = false;
      (uploader as any).uploadToCatbox = () => { providerCalled = true; return Promise.resolve([]); };
      (uploader as any).provider = 'catbox';

      await (uploader as any).handleSubmit({ preventDefault: () => {} });

      expect(providerCalled).toBe(true);
    });

    test('routes to correct provider handler', async () => {
      const calls = { catbox: false, sxcu: false, imgchest: false };

      (uploader as any).uploadToCatbox = () => { calls.catbox = true; return Promise.resolve([]); };
      (uploader as any).uploadToSxcu = () => { calls.sxcu = true; return Promise.resolve([]); };
      (uploader as any).uploadToImgchest = () => { calls.imgchest = true; return Promise.resolve([]); };

      const file = new File([''], 'test.png', { type: 'image/png' });
      (uploader as any).addFiles(createFileList([file]));

      (uploader as any).provider = 'catbox';
      await (uploader as any).handleSubmit({ preventDefault: () => {} });
      expect(calls.catbox).toBe(true);

      calls.catbox = false;
      (uploader as any).provider = 'sxcu';
      await (uploader as any).handleSubmit({ preventDefault: () => {} });
      expect(calls.sxcu).toBe(true);

      calls.sxcu = false;
      (uploader as any).provider = 'imgchest';
      await (uploader as any).handleSubmit({ preventDefault: () => {} });
      expect(calls.imgchest).toBe(true);
    });

    test('disables upload button during submission', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      (uploader as any).addFiles(createFileList([file]));
      const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement;

      (uploader as any).uploadToImgchest = () => {
        expect(uploadBtn.disabled).toBe(true);
        return Promise.resolve([]);
      };

      await (uploader as any).handleSubmit({ preventDefault: () => {} });
    });

    test('button stays disabled and progress visible while sequencer promise is pending, clears on resolution', async () => {
      let resolvePromise!: (value: UploadResult[]) => void;
      (uploader as any).uploadToImgchest = () => new Promise<UploadResult[]>(resolve => { resolvePromise = resolve; });

      const file = new File([''], 'test.png', { type: 'image/png' });
      (uploader as any).addFiles(createFileList([file]));

      const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement;
      const progressDiv = document.getElementById('progress') as HTMLElement;

      const submitPromise = (uploader as any).handleSubmit({ preventDefault: () => {} });

      expect(uploadBtn.disabled).toBe(true);
      expect(progressDiv.style.display).toBe('block');

      resolvePromise([]);
      await submitPromise;

      expect(uploadBtn.disabled).toBe(false);
      expect(progressDiv.style.display).toBe('none');
    });
  });

  describe('Provider-specific UI', () => {
    test('catbox shows URL input and album options, hides imgchest options', () => {
      (uploader as any).provider = 'catbox';
      (uploader as any).updateUI();

      const urlGroup = document.getElementById('urlGroup')!;
      const anonymousGroup = document.getElementById('anonymousGroup')!;
      const postIdGroup = document.getElementById('postIdGroup')!;
      const createAlbumGroup = document.getElementById('createAlbumGroup')!;

      expect(urlGroup.classList.contains('hidden')).toBe(false);
      expect(anonymousGroup.classList.contains('hidden')).toBe(true);
      expect(postIdGroup.classList.contains('hidden')).toBe(true);
      expect(createAlbumGroup.classList.contains('hidden')).toBe(false);
    });

    test('imgchest shows anonymous and postId options', () => {
      (document.getElementById('anonymous') as HTMLInputElement).checked = false;
      (uploader as any).provider = 'imgchest';
      (uploader as any).updateUI();

      const anonymousGroup = document.getElementById('anonymousGroup')!;
      const postIdGroup = document.getElementById('postIdGroup')!;
      const urlGroup = document.getElementById('urlGroup')!;

      expect(anonymousGroup.classList.contains('hidden')).toBe(false);
      expect(postIdGroup.classList.contains('hidden')).toBe(false);
      expect(urlGroup.classList.contains('hidden')).toBe(true);
    });

    test('sxcu shows collection options, hides URL input', () => {
      (uploader as any).provider = 'sxcu';
      (uploader as any).updateUI();

      const createCollectionGroup = document.getElementById('createCollectionGroup')!;
      const urlGroup = document.getElementById('urlGroup')!;

      expect(createCollectionGroup.classList.contains('hidden')).toBe(false);
      expect(urlGroup.classList.contains('hidden')).toBe(true);
    });
  });

  describe('Upload completion tracking', () => {
    test('marks upload complete when images successfully uploaded', () => {
      const results: UploadResult[] = [
        { type: 'success', url: 'http://example.com/a.png' },
        { type: 'success', url: 'http://example.com/b.png' },
      ];

      (uploader as any).displayResults(results);

      expect((uploader as any).uploadCompleted).toBe(true);
    });

    test('does not mark complete for album/collection/post only results', () => {
      const results: UploadResult[] = [
        { type: 'success', url: 'http://example.com/album', isAlbum: true },
        { type: 'success', url: 'http://example.com/post', isPost: true },
      ];

      (uploader as any).displayResults(results);

      expect((uploader as any).uploadCompleted).toBe(false);
    });

    test('does not mark complete when all uploads failed', () => {
      const results: UploadResult[] = [
        { type: 'error', message: 'Failed' },
        { type: 'error', message: 'Also failed' },
      ];

      (uploader as any).displayResults(results);

      expect((uploader as any).uploadCompleted).toBe(false);
    });
  });

  describe('Rate-limit notice', () => {
    test('creates #rate-limit-notice element on first wait', () => {
      (uploader as any).updateRateLimitNotice(5);

      const notice = document.getElementById('rate-limit-notice');
      expect(notice).not.toBeNull();
      expect(notice!.textContent).toContain('5s');
    });

    test('updates text on subsequent waits', () => {
      (uploader as any).updateRateLimitNotice(5);
      (uploader as any).updateRateLimitNotice(3);

      const notice = document.getElementById('rate-limit-notice');
      expect(notice!.textContent).toContain('3s');
    });

    test('removes element on resume (secondsRemaining = 0)', () => {
      (uploader as any).updateRateLimitNotice(5);
      (uploader as any).updateRateLimitNotice(0);

      const notice = document.getElementById('rate-limit-notice');
      expect(notice).toBeNull();
    });

    test('scrolls into view on first creation', () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      (uploader as any).updateRateLimitNotice(5);

      expect(scrollIntoView).toHaveBeenCalled();
    });
  });
});
