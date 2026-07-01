import { describe, expect, test } from 'vitest';
import {
  getCapabilities,
  getAllowedExtensions,
  getAnonymousLimit,
  getHintText,
  getMaxFileSize,
  getUIElementIds,
  validateProviderFiles,
} from '../src/provider-capabilities';

const mb = 1024 * 1024;

function file(name: string, size: number): File {
  return { name, size } as File;
}

describe('provider capabilities', () => {
  test('exposes per-provider extension, size, hint, anonymous, and UI capabilities', () => {
    expect(getCapabilities('catbox')).toMatchObject({
      hasTotalSizeLimit: true,
      hasFileCountLimit: true,
    });

    expect(getAllowedExtensions('sxcu')).toEqual([
      '.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp', '.tiff', '.tif', '.webm', '.webp',
    ]);
    expect(getMaxFileSize('sxcu')).toBe(95 * mb);

    expect(getAllowedExtensions('imgchest')).toEqual(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4']);
    expect(getMaxFileSize('imgchest')).toBe(30 * mb);
    expect(getAnonymousLimit('imgchest')).toBe(20);
    expect(getAnonymousLimit('catbox')).toBeUndefined();

    expect(getHintText('catbox')).toBe('Blocked: EXE, SCR, CPL, DOC*, JAR');
    expect(getUIElementIds('kek')).toEqual({
      show: ['urlGroup', 'descriptionGroup', 'kekApiKeyGroup', 'kekMatureGroup'],
      hide: [
        'createCollectionGroup',
        'sxcuOptions',
        'anonymousGroup',
        'postIdGroup',
        'imgchestApiKeyGroup',
        'imgchestOptions',
        'titleGroup',
        'createAlbumGroup',
      ],
    });
  });

  test('validates empty files, zero-byte files, and disallowed provider extensions', () => {
    expect(validateProviderFiles([], 'catbox')).toEqual({ ok: false, error: 'No files provided' });
    expect(validateProviderFiles([file('empty.png', 0)], 'sxcu')).toEqual({ ok: false, error: 'Empty file' });
    expect(validateProviderFiles([file('bad.bmp', 1)], 'kek')).toEqual({
      ok: false,
      error: 'Unsupported file type for kek: bad.bmp. Only jpg, jpeg, png, gif, and webp are allowed.',
    });
    expect(validateProviderFiles([file('bad.bmp', 1)], 'imgchest')).toEqual({
      ok: false,
      error: 'Unsupported file type for Imgchest: bad.bmp. Only jpg, jpeg, png, gif, webp, and mp4 are allowed.',
    });
  });

  test('validates oversized files with provider-specific limits', () => {
    expect(validateProviderFiles([file('large.png', 201 * mb)], 'catbox')).toEqual({
      ok: false,
      error: 'File too large: large.png (max 200MB for Catbox)',
    });
    expect(validateProviderFiles([file('large.png', 96 * mb)], 'sxcu')).toEqual({
      ok: false,
      error: 'File too large: large.png (max 95MB for sxcu)',
    });
    expect(validateProviderFiles([file('large.mp4', 31 * mb)], 'imgchest')).toEqual({
      ok: false,
      error: 'File too large: large.mp4 (max 30MB for Imgchest)',
    });
    expect(validateProviderFiles([file('large.jpg', 51 * mb)], 'kek')).toEqual({
      ok: false,
      error: 'File too large: large.jpg (max 50MB for kek)',
    });
  });

  test('validates total-size and file-count limits only for providers that opt in', () => {
    expect(validateProviderFiles([file('a.png', 60 * mb), file('b.png', 50 * mb)], 'catbox')).toEqual({
      ok: false,
      error: 'Request too large',
    });
    expect(validateProviderFiles([file('a.png', 60 * mb), file('b.png', 50 * mb)], 'sxcu')).toEqual({
      ok: false,
      error: 'Request too large',
    });
    expect(validateProviderFiles(Array.from({ length: 51 }, (_, i) => file(`${i}.png`, 1)), 'catbox')).toEqual({
      ok: false,
      error: 'Too many files (max 50)',
    });

    expect(validateProviderFiles(Array.from({ length: 51 }, (_, i) => file(`${i}.png`, 1)), 'sxcu')).toEqual({ ok: true });
    expect(validateProviderFiles([file('ok.png', 1)], 'catbox')).toEqual({ ok: true });
    expect(validateProviderFiles([file('a.mp4', 20 * mb), file('b.mp4', 20 * mb)], 'imgchest')).toEqual({ ok: true });
    expect(validateProviderFiles([file('a.jpg', 40 * mb), file('b.jpg', 40 * mb)], 'kek')).toEqual({ ok: true });
  });
});
