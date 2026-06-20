import { FetchLike } from '../provider-protocol';
import { FAIL_FAST_RATE_LIMIT_POLICY, RateLimitStore, executeRateLimited } from '../rate-limit/engine';
import { uploadToCatbox } from '../providers/catbox';
import { uploadToKek } from '../providers/kek';
import { uploadToSxcu } from '../providers/sxcu';
import { readCatboxRequest, readKekRequest, readSxcuRequest } from './request-shaping';
import { shapeSuccessResponse, shapeJsonSuccessResponse, shapeJsonProviderResponse, shapeErrorResponse } from './response-shaping';

export interface UploadEndpointDeps {
  corsHeaders: Record<string, string>;
  fetch?: FetchLike;
  store?: RateLimitStore;
  secrets?: Record<string, string | undefined>;
}

export async function handleUploadRequest(
  request: Request,
  deps: UploadEndpointDeps,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === 'POST' && url.pathname === '/upload/catbox') {
    return handleCatbox(request, deps);
  }

  if (request.method === 'POST' && url.pathname === '/upload/kek/posts') {
    return handleKek(request, deps);
  }

  if (request.method === 'POST' && url.pathname === '/upload/sxcu/files') {
    return handleSxcu(request, deps, 'file');
  }

  if (request.method === 'POST' && url.pathname === '/upload/sxcu/collections') {
    return handleSxcu(request, deps, 'collection');
  }

  return null;
}

async function handleCatbox(request: Request, deps: UploadEndpointDeps): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return shapeErrorResponse(400, message, deps.corsHeaders);
  }

  const shaped = await readCatboxRequest(formData);
  if (!shaped.ok) {
    return shapeErrorResponse(400, shaped.error, deps.corsHeaders);
  }

  try {
    const result = await uploadToCatbox(shaped.input, { fetch: deps?.fetch });
    if (result.status >= 200 && result.status < 300) {
      return shapeSuccessResponse(result, deps.corsHeaders);
    }
    return shapeErrorResponse(result.status, String(result.body), deps.corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return shapeErrorResponse(500, message, deps.corsHeaders);
  }
}

async function handleSxcu(
  request: Request,
  deps: UploadEndpointDeps,
  type: 'file' | 'collection',
): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return shapeErrorResponse(400, message, deps.corsHeaders);
  }

  const shaped = await readSxcuRequest(formData, type);
  if (!shaped.ok) {
    return shapeErrorResponse(400, shaped.error, deps.corsHeaders);
  }

  try {
    if (type === 'collection') {
      const result = await uploadToSxcu(shaped.input, { fetch: deps?.fetch });
      return shapeJsonProviderResponse(result, deps.corsHeaders);
    }

    if (!deps.store) {
      return shapeErrorResponse(500, 'Rate-limit store not configured', deps.corsHeaders);
    }

    const result = await executeRateLimited({
      provider: 'sxcu',
      policy: FAIL_FAST_RATE_LIMIT_POLICY,
      store: deps.store,
      operation: () => uploadToSxcu(shaped.input, { fetch: deps?.fetch }),
    });

    if (result.type === 'error') {
      return shapeErrorResponse(500, result.error, deps.corsHeaders);
    }

    return shapeJsonProviderResponse(result.providerResult, deps.corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return shapeErrorResponse(500, message, deps.corsHeaders);
  }
}

async function handleKek(request: Request, deps: UploadEndpointDeps): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return shapeErrorResponse(400, message, deps.corsHeaders);
  }

  const headerApiKey = request.headers.get('X-Kek-Auth')?.trim() || undefined;
  const shaped = await readKekRequest(formData, {
    envApiKey: deps.secrets?.kekApiKey,
    headerApiKey,
  });
  if (!shaped.ok) {
    return shapeErrorResponse(400, shaped.error, deps.corsHeaders);
  }

  try {
    const result = await uploadToKek(shaped.input, { fetch: deps?.fetch });
    if (result.status >= 200 && result.status < 300) {
      return shapeJsonSuccessResponse(result, deps.corsHeaders);
    }
    const message = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
    return shapeErrorResponse(result.status, message, deps.corsHeaders);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return shapeErrorResponse(500, message, deps.corsHeaders);
  }
}
