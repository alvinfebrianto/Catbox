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
