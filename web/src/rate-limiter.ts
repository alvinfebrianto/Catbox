import {
  RateLimitHeaders,
  getCorsHeaders,
  validateImgchestFiles,
} from './types';
import { DurableObjectRateLimitStore } from './rate-limit/engine';
import { uploadToImgchest } from './providers/imgchest';
import { handleUploadRequest } from './upload-endpoint';

export class RateLimiter {
  state: DurableObjectState;
  storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('X-Origin') || request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    try {
      if (method === 'POST' && path === '/upload/imgchest/post') {
        return await this.handleImgchestPost(request, corsHeaders);
      }

      if (method === 'POST' && path.startsWith('/upload/imgchest/post/') && path.endsWith('/add')) {
        return await this.handleImgchestAdd(request, corsHeaders);
      }

      if (method === 'POST' && path === '/upload/sxcu/collections') {
        const response = await handleUploadRequest(request, {
          corsHeaders,
          store: new DurableObjectRateLimitStore(this.storage),
        });
        if (response) return response;
      }

      if (method === 'POST' && path === '/upload/sxcu/files') {
        const response = await handleUploadRequest(request, {
          corsHeaders,
          store: new DurableObjectRateLimitStore(this.storage),
        });
        if (response) return response;
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  private createResponseHeadersFromProvider(rlh: RateLimitHeaders | undefined, corsHeaders: Record<string, string>): Headers {
    const responseHeaders = new Headers(corsHeaders);
    responseHeaders.set('Content-Type', 'application/json');

    if (rlh?.limit !== undefined) responseHeaders.set('X-RateLimit-Limit', String(rlh.limit));
    if (rlh?.remaining !== undefined) responseHeaders.set('X-RateLimit-Remaining', String(rlh.remaining));
    if (rlh?.reset !== undefined) responseHeaders.set('X-RateLimit-Reset', String(rlh.reset));
    if (rlh?.resetAfter !== undefined) responseHeaders.set('X-RateLimit-Reset-After', String(rlh.resetAfter));
    if (rlh?.bucket !== undefined) responseHeaders.set('X-RateLimit-Bucket', rlh.bucket);
    if (rlh?.isGlobal) responseHeaders.set('X-RateLimit-Global', 'true');

    return responseHeaders;
  }

  private async handleImgchestPost(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '') ||
                  (request as unknown as { env?: { IMGCHEST_API_TOKEN?: string } }).env?.IMGCHEST_API_TOKEN;

    if (!token) {
      return new Response(JSON.stringify({
        error: 'Imgchest API token not configured',
        debug: {
          hasAuthHeader: !!authHeader,
          authHeaderValue: authHeader ? authHeader.substring(0, 20) + '...' : null,
        }
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const formData = await request.formData();
    const images = formData.getAll('images[]') as File[];

    const validation = validateImgchestFiles(images);
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const privacy = (formData.get('privacy') || 'hidden').toString();
    if (!['public', 'hidden', 'secret'].includes(privacy)) {
      return new Response(JSON.stringify({ error: 'Invalid privacy value. Must be public, hidden, or secret.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const nsfwRaw = (formData.get('nsfw') ?? 'true').toString().toLowerCase();
    const nsfw = nsfwRaw === 'true' || nsfwRaw === '1';

    const title = formData.get('title') as string | null;

    const store = new DurableObjectRateLimitStore(this.storage);
    const result = await uploadToImgchest({
      images,
      token,
      title: title ?? undefined,
      privacy,
      nsfw,
    }, { store });

    return new Response(JSON.stringify(result.body), {
      headers: this.createResponseHeadersFromProvider(result.rateLimitHeaders, corsHeaders),
      status: result.status,
    });
  }

  private async handleImgchestAdd(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const postId = pathParts[4];

    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '') ||
                  (request as unknown as { env?: { IMGCHEST_API_TOKEN?: string } }).env?.IMGCHEST_API_TOKEN;

    if (!token) {
      return new Response(JSON.stringify({ error: 'Imgchest API token not configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const formData = await request.formData();
    const images = formData.getAll('images[]') as File[];
    const privacyRaw = formData.get('privacy') as string | null;
    const nsfwRaw = formData.get('nsfw') as string | null;
    const privacy = privacyRaw && privacyRaw.trim() !== '' ? privacyRaw.trim() : null;
    const nsfw = nsfwRaw && nsfwRaw.trim() !== '' ? nsfwRaw.trim() : null;

    if (privacy !== null && !['public', 'hidden', 'secret'].includes(privacy)) {
      return new Response(JSON.stringify({ error: 'Invalid privacy value. Must be public, hidden, or secret.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const validation = validateImgchestFiles(images);
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const store = new DurableObjectRateLimitStore(this.storage);
    const result = await uploadToImgchest({
      images,
      token,
      existingPostId: postId,
      privacy: privacy ?? undefined,
      nsfw: nsfw !== null ? nsfw === 'true' || nsfw === '1' : undefined,
    }, { store });

    return new Response(JSON.stringify(result.body), {
      headers: this.createResponseHeadersFromProvider(result.rateLimitHeaders, corsHeaders),
      status: result.status,
    });
  }

}
