import { RateLimiter } from './rate-limiter';
import {
  getCorsHeaders,
  validateFiles,
  validateKekFiles,
  MAX_TOTAL_SIZE,
} from './types';
import { CatboxProviderInputError, CatboxUploadInput, readCatboxUploadInput, uploadToCatbox } from './providers/catbox';
import { KekProviderInputError, readKekUploadInput, uploadToKek } from './providers/kek';

interface Env {
  IMGCHEST_API_TOKEN?: string;
  KEK_API_KEY?: string;
  RATE_LIMITER?: DurableObjectNamespace;
}

const DEBUG = false;
const MAX_REQUEST_BYTES = MAX_TOTAL_SIZE;

async function handleCatboxUpload(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
  let input: CatboxUploadInput;
  try {
    input = readCatboxUploadInput(await req.formData());
  } catch (error) {
    if (error instanceof CatboxProviderInputError) {
      return new Response(JSON.stringify({ error: error.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }

  const files = getCatboxFiles(input);
  if (files.length > 0) {
    const validation = validateFiles(files);
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
  }

  try {
    const result = await uploadToCatbox(input);

    return new Response(String(result.body), {
      status: result.status >= 200 && result.status < 300 ? 200 : result.status,
      headers: corsHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

function getCatboxFiles(input: CatboxUploadInput): File[] {
  if (input.reqtype !== 'fileupload') return [];

  const entries = Array.isArray(input.fileToUpload) ? input.fileToUpload : [input.fileToUpload];
  return entries.filter((entry): entry is File => entry instanceof File);
}

async function handleKekUpload(req: Request, corsHeaders: Record<string, string>, env: Env): Promise<Response> {
  const headerApiKey = req.headers.get('X-Kek-Auth')?.trim() || undefined;

  let input;
  try {
    input = readKekUploadInput(await req.formData(), env.KEK_API_KEY, headerApiKey);
  } catch (error) {
    const status = error instanceof KekProviderInputError ? 400 : 500;
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status,
    });
  }

  if (input.files && input.files.length > 0) {
    const files = input.files.filter((f): f is File => f instanceof File);
    const validation = validateKekFiles(files);
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
  }

  try {
    const result = await uploadToKek(input);

    return new Response(
      typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: result.status >= 200 && result.status < 300 ? 200 : result.status,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
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
    }

    if (method === 'POST' && path === '/upload/catbox') {
      return handleCatboxUpload(request, corsHeaders);
    }

    if (method === 'POST' && path === '/upload/kek/posts') {
      return handleKekUpload(request, corsHeaders, env);
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
