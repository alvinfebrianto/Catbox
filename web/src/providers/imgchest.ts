import { FetchLike, getDefaultFetch, JsonValue, ProviderResult } from '../provider-protocol';
import { MAX_IMGCHEST_IMAGES_PER_REQUEST, parseRateLimitHeaders, RetryConfig } from '../types';
import { executeRateLimited, RateLimitStore, RateLimitEngineResult, RETRY_AFTER_WAIT_RATE_LIMIT_POLICY } from '../rate-limit/engine';
import { Sleep } from '../retry';

export interface ImgchestCreatePostOptions {
  fetch?: FetchLike;
}

export interface ImgchestUploadInput {
  images: File[];
  token: string;
  title?: string;
  privacy?: string;
  nsfw?: boolean;
  existingPostId?: string;
}

export interface ImgchestProviderOptions {
  fetch?: FetchLike;
  store: RateLimitStore;
  sleep?: Sleep;
  config?: RetryConfig;
  now?: () => number;
}

async function imgchestFetch(
  url: string,
  method: string,
  body: BodyInit | undefined,
  token: string,
  contentType?: string,
  fetchImpl?: FetchLike
): Promise<ProviderResult> {
  const doFetch = fetchImpl ?? getDefaultFetch();
  const headers: Record<string, string> = { 'Authorization': 'Bearer ' + token };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  const response = await doFetch(url, { method, body, headers });
  return await parseImgchestResponse(response);
}

export async function createImgchestPost(
  formData: FormData,
  token: string,
  options: ImgchestCreatePostOptions = {}
): Promise<ProviderResult> {
  return imgchestFetch('https://api.imgchest.com/v1/post', 'POST', formData, token, undefined, options.fetch);
}

export async function imgchestAddToPost(
  postId: string,
  formData: FormData,
  token: string,
  options: ImgchestCreatePostOptions = {}
): Promise<ProviderResult> {
  return imgchestFetch(`https://api.imgchest.com/v1/post/${postId}/add`, 'POST', formData, token, undefined, options.fetch);
}

export async function imgchestPatchPost(
  postId: string,
  body: Record<string, string>,
  token: string,
  options: ImgchestCreatePostOptions = {}
): Promise<ProviderResult> {
  return imgchestFetch(`https://api.imgchest.com/v1/post/${postId}`, 'PATCH', JSON.stringify(body), token, 'application/json', options.fetch);
}

function getPostId(result: RateLimitEngineResult): string | null {
  if (result.type === 'ok' && result.providerResult.body && typeof result.providerResult.body === 'object' && !Array.isArray(result.providerResult.body)) {
    const data = (result.providerResult.body as Record<string, JsonValue>).data;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return (data as Record<string, JsonValue>).id as string ?? null;
    }
  }
  return null;
}

export async function uploadToImgchest(
  input: ImgchestUploadInput,
  options: ImgchestProviderOptions
): Promise<ProviderResult> {
  const fetchImpl = options.fetch;
  const config = options.config;
  const sleep = options.sleep;
  const now = options.now;
  const CHUNK_SIZE = MAX_IMGCHEST_IMAGES_PER_REQUEST;

  const chunks: File[][] = [];
  for (let i = 0; i < input.images.length; i += CHUNK_SIZE) {
    chunks.push(input.images.slice(i, i + CHUNK_SIZE));
  }

  let postId: string | null = input.existingPostId ?? null;
  let finalResult: ProviderResult | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isFirstChunk = i === 0;
    const isNewPost = isFirstChunk && !input.existingPostId;

    const engineResult = await executeRateLimited({
      provider: 'imgchest',
      policy: RETRY_AFTER_WAIT_RATE_LIMIT_POLICY,
      store: options.store,
      config,
      sleep,
      now,
      operation: async () => {
        const chunkFormData = new FormData();
        if (isNewPost) {
          if (input.title) chunkFormData.append('title', input.title);
          chunkFormData.append('privacy', input.privacy ?? 'hidden');
          chunkFormData.append('nsfw', input.nsfw !== undefined ? (input.nsfw ? 'true' : 'false') : 'true');
        }
        for (const image of chunk) {
          chunkFormData.append('images[]', image);
        }

        if (isNewPost) {
          return createImgchestPost(chunkFormData, input.token, { fetch: fetchImpl });
        }
        return imgchestAddToPost(postId!, chunkFormData, input.token, { fetch: fetchImpl });
      },
    });

    if (engineResult.type === 'error') {
      return { status: 500, body: { error: engineResult.error } };
    }

    if (engineResult.providerResult.status !== 200) {
      return engineResult.providerResult;
    }

    finalResult = engineResult.providerResult;

    if (!postId) {
      const id = getPostId(engineResult);
      if (id) postId = id;
    }
  }

  if (input.existingPostId && chunks.length > 0 && (input.privacy !== undefined || input.nsfw !== undefined)) {
    const patchPayload: Record<string, string> = {};
    if (input.privacy) patchPayload.privacy = input.privacy;
    if (input.nsfw !== undefined) patchPayload.nsfw = input.nsfw ? 'true' : 'false';

    if (Object.keys(patchPayload).length > 0) {
      const engineResult = await executeRateLimited({
        provider: 'imgchest',
        policy: RETRY_AFTER_WAIT_RATE_LIMIT_POLICY,
        store: options.store,
        config,
        sleep,
        now,
        operation: async () => imgchestPatchPost(postId!, patchPayload, input.token, { fetch: fetchImpl }),
      });

      if (engineResult.type === 'error') {
        return { status: 500, body: { error: `Images added but failed to update settings: ${engineResult.error}`, imagesAdded: true } };
      }

      if (engineResult.type === 'ok') {
        finalResult = engineResult.providerResult;
      }
    }
  }

  return finalResult ?? { status: 500, body: { error: 'No chunks processed' } };
}

async function parseImgchestResponse(response: Response): Promise<ProviderResult> {
  const text = await response.text();

  if (text.trim().startsWith('<')) {
    return {
      status: response.status,
      body: { error: 'Unauthorized or API error - received HTML response' },
      rateLimitHeaders: parseRateLimitHeaders(response.headers),
    };
  }

  let body: JsonValue;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return {
    status: response.status,
    body,
    rateLimitHeaders: parseRateLimitHeaders(response.headers),
  };
}
