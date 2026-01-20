import { RateLimiter } from './rate-limiter';
import {
  CORS_HEADERS,
  DEFAULT_RETRY_CONFIG,
  calculateExponentialBackoff,
  getCorsHeaders,
  validateFiles,
  MAX_TOTAL_SIZE,
} from './types';

interface Env {
  IMGCHEST_API_TOKEN?: string;
  RATE_LIMITER?: DurableObjectNamespace;
  PROXY_AUTH_TOKEN?: string;
}

const DEBUG = false;
const MAX_REQUEST_BYTES = MAX_TOTAL_SIZE;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function handleCatboxUpload(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  const formData = await req.formData();
  const reqtype = formData.get('reqtype') as string;

  const validReqTypes = ['fileupload'];
  if (!validReqTypes.includes(reqtype)) {
    return new Response(JSON.stringify({ error: 'Unknown request type' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }

  const files = formData.getAll('fileToUpload') as File[];
  if (files.length > 0) {
    const validation = validateFiles(files);
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: formData,
        headers: {
          'User-Agent': 'CatboxUploader/2.0',
        },
      });

      const text = await response.text();

      if (response.ok) {
        return new Response(text, {
          status: 200,
          headers: corsHeaders,
        });
      }

      if (response.status === 429) {
        if (DEBUG) {
          console.log(`[Catbox] Rate limited, attempt ${attempt + 1}`);
        }
        if (attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
          const waitMs = calculateExponentialBackoff(attempt);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
      }

      return new Response(text, {
        status: response.status,
        headers: corsHeaders,
      });

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (DEBUG) {
        console.error(`[Catbox] Error on attempt ${attempt + 1}:`, lastError.message);
      }

      if (attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
        const waitMs = calculateExponentialBackoff(attempt);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
    }
  }

  return new Response(JSON.stringify({ error: lastError?.message || 'Unknown error' }), {
    status: 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

      const token = env.PROXY_AUTH_TOKEN;
      if (!token) {
        return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        });
      }

      const presented = request.headers.get('X-Proxy-Auth') || '';
      if (!timingSafeEqual(presented, token)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        });
      }
    }

    if (method === 'POST' && path === '/upload/catbox') {
      return handleCatboxUpload(request, corsHeaders);
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
    });

    return rateLimiter.fetch(rateLimiterRequest);
  }
} satisfies ExportedHandler<Env>;
