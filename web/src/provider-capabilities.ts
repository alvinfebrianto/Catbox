import type { FileValidationResult, Provider } from './types';
import { MAX_FILE_COUNT, MAX_TOTAL_SIZE } from './types';

const MB = 1024 * 1024;

export type { Provider };

export interface ProviderCapabilities {
  extensions: string[];
  maxFileSize: number;
  hasTotalSizeLimit: boolean;
  hasFileCountLimit: boolean;
  anonymousLimit?: number;
  hintText: string;
  uiControls: {
    show: string[];
    hide: string[];
  };
}

interface ValidationOverrides {
  maxFiles?: number;
  maxTotal?: number;
  maxEach?: number;
}

export const PROVIDER_CAPABILITIES: Record<Provider, ProviderCapabilities> = {
  catbox: {
    extensions: ['.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp', '.tiff', '.tif', '.webm', '.webp'],
    maxFileSize: 200 * MB,
    hasTotalSizeLimit: true,
    hasFileCountLimit: true,
    hintText: 'Blocked: EXE, SCR, CPL, DOC*, JAR',
    uiControls: {
      show: ['urlGroup', 'titleGroup', 'descriptionGroup', 'createAlbumGroup'],
      hide: [
        'createCollectionGroup',
        'sxcuOptions',
        'anonymousGroup',
        'postIdGroup',
        'imgchestApiKeyGroup',
        'imgchestOptions',
        'kekApiKeyGroup',
        'kekMatureGroup',
      ],
    },
  },
  sxcu: {
    extensions: ['.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp', '.tiff', '.tif', '.webm', '.webp'],
    maxFileSize: 95 * MB,
    hasTotalSizeLimit: true,
    hasFileCountLimit: false,
    hintText: 'Allowed: PNG, GIF, JPEG, ICO, BMP, TIFF, WEBM, WEBP',
    uiControls: {
      show: ['createCollectionGroup', 'sxcuOptions', 'titleGroup', 'descriptionGroup'],
      hide: [
        'urlGroup',
        'anonymousGroup',
        'postIdGroup',
        'imgchestApiKeyGroup',
        'imgchestOptions',
        'kekApiKeyGroup',
        'kekMatureGroup',
        'createAlbumGroup',
      ],
    },
  },
  imgchest: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4'],
    maxFileSize: 30 * MB,
    hasTotalSizeLimit: false,
    hasFileCountLimit: false,
    anonymousLimit: 20,
    hintText: 'Allowed: JPG, JPEG, PNG, GIF, WEBP, MP4 (max 30MB)',
    uiControls: {
      show: ['anonymousGroup', 'postIdGroup', 'imgchestApiKeyGroup', 'imgchestOptions', 'titleGroup'],
      hide: [
        'urlGroup',
        'createCollectionGroup',
        'sxcuOptions',
        'descriptionGroup',
        'kekApiKeyGroup',
        'kekMatureGroup',
        'createAlbumGroup',
      ],
    },
  },
  kek: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    maxFileSize: 50 * MB,
    hasTotalSizeLimit: false,
    hasFileCountLimit: false,
    hintText: 'Allowed: JPG, JPEG, PNG, GIF, WEBP (max 50MB)',
    uiControls: {
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
    },
  },
};

export function getCapabilities(provider: Provider): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[provider];
}

export function getAllowedExtensions(provider: Provider): string[] {
  return getCapabilities(provider).extensions;
}

export function getMaxFileSize(provider: Provider): number {
  return getCapabilities(provider).maxFileSize;
}

export function getAnonymousLimit(provider: Provider): number | undefined {
  return getCapabilities(provider).anonymousLimit;
}

export function getHintText(provider: Provider): string {
  return getCapabilities(provider).hintText;
}

export function getUIElementIds(provider: Provider): { show: string[]; hide: string[] } {
  return getCapabilities(provider).uiControls;
}

export function validateProviderFiles(
  files: File[],
  provider: Provider,
  overrides: ValidationOverrides = {},
): FileValidationResult {
  const capabilities = getCapabilities(provider);
  const maxFiles = overrides.maxFiles ?? MAX_FILE_COUNT;
  const maxTotal = overrides.maxTotal ?? MAX_TOTAL_SIZE;
  const maxEach = overrides.maxEach ?? capabilities.maxFileSize;

  if (files.length === 0) {
    return { ok: false, error: 'No files provided' };
  }

  if (capabilities.hasFileCountLimit && files.length > maxFiles) {
    return { ok: false, error: `Too many files (max ${maxFiles})` };
  }

  let total = 0;
  for (const f of files) {
    total += f.size;

    if (f.size <= 0) {
      return { ok: false, error: 'Empty file' };
    }

    if (f.size > maxEach) {
      return { ok: false, error: `File too large: ${f.name} (max ${bytesToMb(maxEach)}MB for ${providerLabel(provider)})` };
    }

    if (capabilities.hasTotalSizeLimit && total > maxTotal) {
      return { ok: false, error: 'Request too large' };
    }

    const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    if (!capabilities.extensions.includes(ext)) {
      return { ok: false, error: unsupportedTypeMessage(provider, f.name) };
    }
  }

  return { ok: true };
}

function bytesToMb(bytes: number): number {
  return bytes / MB;
}

function providerLabel(provider: Provider): string {
  if (provider === 'catbox') return 'Catbox';
  if (provider === 'imgchest') return 'Imgchest';
  return provider;
}

function unsupportedTypeMessage(provider: Provider, fileName: string): string {
  const allowed = extensionListText(getAllowedExtensions(provider));
  if (provider === 'catbox' || provider === 'sxcu') {
    return `Disallowed file type: ${fileName}`;
  }

  return `Unsupported file type for ${providerLabel(provider)}: ${fileName}. Only ${allowed} are allowed.`;
}

function extensionListText(extensions: string[]): string {
  const names = extensions.map((ext) => ext.slice(1));
  if (names.length === 1) return names[0];

  return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1];
}
