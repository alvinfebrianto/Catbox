import { RateLimiter } from './rate-limiter';
import { getCorsHeaders, MAX_TOTAL_SIZE } from './types';
import { handleUploadRequest, type UploadEndpointDeps } from './upload-endpoint';

interface Env {
  IMGCHEST_API_TOKEN?: string;
  KEK_API_KEY?: string;
  RATE_LIMITER?: DurableObjectNamespace;
}

const DEBUG = false;
const MAX_REQUEST_BYTES = MAX_TOTAL_SIZE;

export { RateLimiter };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;
    const origin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    if (method === 'POST') {
      const contentLength = request.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_BYTES) {
        return new Response(JSON.stringify({ error: 'Request too large' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 413,
        });
      }
    }

    if (method === 'POST' && (path === '/upload/catbox' || path === '/upload/kek/posts')) {
      const deps: UploadEndpointDeps = {
        corsHeaders,
        secrets: { kekApiKey: env.KEK_API_KEY },
      };
      const result = await handleUploadRequest(request, deps);
      if (result) return result;
    }

    if (!env.RATE_LIMITER) {
      return new Response(JSON.stringify({ error: 'Rate limiter not configured' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimiterId = env.RATE_LIMITER.idFromName(`client-${clientIP}`);
    const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

    const headers = new Headers(request.headers);
    if (env.IMGCHEST_API_TOKEN && !headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer ' + env.IMGCHEST_API_TOKEN);
    }
    headers.set('X-Origin', origin || '');

    const rateLimiterRequest = new Request(request.url, {
      method: request.method,
      headers: headers,
      body: request.body,
      ...(request.body ? { duplex: 'half' } : {}),
    } as RequestInit);

    return rateLimiter.fetch(rateLimiterRequest);
  }
} satisfies ExportedHandler<Env>;
