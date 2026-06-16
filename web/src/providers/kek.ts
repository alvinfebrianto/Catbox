import { FetchLike, getDefaultFetch, JsonValue, ProviderResult } from '../provider-protocol';
import { withRetry, Sleep } from '../retry';
import { DEFAULT_RETRY_CONFIG, parseRateLimitHeaders, RetryConfig } from '../types';

export interface KekUploadInput {
  apiKey: string;
  files?: FormDataEntryValue[];
  url?: string;
  mature?: boolean;
}

export interface KekProviderOptions {
  fetch?: FetchLike;
  retryConfig?: RetryConfig;
  sleep?: Sleep;
}

export class KekProviderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KekProviderInputError';
  }
}

export interface ReadKekUploadInputOptions {
  /** Caller-supplied key from the X-Kek-Auth header, if any. */
  headerApiKey?: string;
  /** API key the host understands is its env-level fallback. */
  envApiKey?: string;
}

export function readKekUploadInput(
  formData: FormData,
  envApiKey?: string,
  headerApiKey?: string
): KekUploadInput {
  return readKekUploadInputWithOptions(formData, { envApiKey, headerApiKey });
}

export function readKekUploadInputWithOptions(
  formData: FormData,
  options: ReadKekUploadInputOptions
): KekUploadInput {
  const apiKey = options.headerApiKey?.trim() || options.envApiKey;
  if (!apiKey) {
    throw new KekProviderInputError('kek API key not configured');
  }

  const files = formData.getAll('file');
  const urlEntry = formData.get('url');
  const url = typeof urlEntry === 'string' && urlEntry.length > 0 ? urlEntry : null;

  if (files.length > 0 && url) {
    throw new KekProviderInputError('Cannot upload both files and URLs in the same request');
  }

  const isUrlUpload = url !== null;

  if (!isUrlUpload && files.length === 0) {
    throw new KekProviderInputError('No files or URL provided');
  }

  if (isUrlUpload) {
    try {
      new URL(url);
    } catch {
      throw new KekProviderInputError('Invalid URL');
    }
  }

  const matureRaw = formData.get('mature');
  const mature = typeof matureRaw === 'string' ? matureRaw !== 'false' : undefined;

  const input: KekUploadInput = { apiKey, mature };
  if (isUrlUpload) {
    input.url = url;
  } else {
    input.files = files;
  }

  return input;
}

function createKekFormData(input: KekUploadInput): FormData {
  const formData = new FormData();
  if (input.url !== undefined) {
    formData.append('url', input.url);
  }
  if (input.files) {
    for (const file of input.files) {
      formData.append('file', file);
    }
  }
  return formData;
}

function parseJsonBody(text: string): JsonValue {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}

export async function uploadToKek(
  input: KekUploadInput,
  options: KekProviderOptions = {}
): Promise<ProviderResult> {
  const fetchImpl = options.fetch ?? getDefaultFetch();
  const config = options.retryConfig ?? DEFAULT_RETRY_CONFIG;
  const formData = createKekFormData(input);

  const result = await withRetry(
    async () => {
      const response = await fetchImpl('https://kek.sh/api/v1/posts', {
        method: 'POST',
        body: formData,
        headers: {
          'x-kek-auth': input.apiKey,
        },
      });

      return {
        status: response.status,
        body: parseJsonBody(await response.text()),
        rateLimitHeaders: parseRateLimitHeaders(response.headers),
      };
    },
    {
      config,
      shouldRetry: result => result.status === 429,
      sleep: options.sleep,
    }
  );

  if (result.status >= 200 && result.status < 300 && input.mature !== false) {
    const postId = extractPostId(result.body);
    if (postId !== undefined) {
      try {
        await fetchImpl(`https://kek.sh/api/v1/posts/${postId}/mature`, {
          method: 'PUT',
          headers: {
            'x-kek-auth': input.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ value: true }),
        });
      } catch {
        // Mature PUT is best-effort; never block the upload response.
      }
    }
  }

  return result;
}

function extractPostId(body: JsonValue): string | number | undefined {
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const id = (body as Record<string, JsonValue>).id;
    if (typeof id === 'string' || typeof id === 'number') return id;
  }
  return undefined;
}
