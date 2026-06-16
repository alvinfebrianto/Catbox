import { FetchLike, getDefaultFetch, JsonValue, ProviderResult } from '../provider-protocol';
import { parseRateLimitHeaders } from '../types';

export type SxcuUploadType = 'file' | 'collection';

export interface SxcuUploadInput {
  type: SxcuUploadType;
  formData: FormData;
}

export interface SxcuProviderOptions {
  fetch?: FetchLike;
}

export async function uploadToSxcu(
  input: SxcuUploadInput,
  options: SxcuProviderOptions = {}
): Promise<ProviderResult> {
  const fetchImpl = options.fetch ?? getDefaultFetch();
  const path = input.type === 'file' ? '/api/files/create' : '/api/collections/create';

  const response = await fetchImpl(`https://sxcu.net${path}`, {
    method: 'POST',
    body: input.formData,
    headers: {
      'User-Agent': 'CatboxUploader/2.0',
    },
  });

  const text = await response.text();
  let body: JsonValue;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  const rateLimitHeaders = parseRateLimitHeaders(response.headers);

  if (!rateLimitHeaders.isGlobal && response.status === 429 && body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, JsonValue>;
    if (obj.code === 2) {
      rateLimitHeaders.isGlobal = true;
    }
  }

  return {
    status: response.status,
    body,
    rateLimitHeaders,
  };
}
