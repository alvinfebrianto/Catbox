import { RateLimiter } from './rate-limiter';
import {
  DEFAULT_RETRY_CONFIG,
  calculateExponentialBackoff,
  getCorsHeaders,
  validateFiles,
  validateKekFiles,
  MAX_TOTAL_SIZE,
} from './types';
import { CatboxProviderInputError, CatboxUploadInput, readCatboxUploadInput, uploadToCatbox } from './providers/catbox';

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
  const apiKey = req.headers.get('X-Kek-Auth')?.trim() || env.KEK_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'kek API key not configured' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 401,
    });
  }

  const formData = await req.formData();
  const files = formData.getAll('file') as File[];
  const url = formData.get('url') as string | null;
  const mature = formData.get('mature') as string | null;

  if (files.length > 0 && url) {
    return new Response(JSON.stringify({ error: 'Cannot upload both files and URLs in the same request' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }

  const isUrlUpload = !!url;

  if (isUrlUpload) {
    try {
      new URL(url);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
  } else {
    const validation = validateKekFiles(files);
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }
  }

  const kekFormData = new FormData();
  if (isUrlUpload) {
    kekFormData.append('url', url!);
  } else {
    for (const file of files) {
      kekFormData.append('file', file);
    }
  }

  const shouldSetMature = mature !== 'false';

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch('https://kek.sh/api/v1/posts', {
        method: 'POST',
        body: kekFormData,
        headers: {
          'x-kek-auth': apiKey,
          'User-Agent': 'CatboxUploader/2.0',
        },
      });

      const text = await response.text();

      if (response.ok) {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text);
        } catch {
          return new Response(text, {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const postId = data.id;
        if (postId != null && shouldSetMature) {
          try {
            const matureResp = await fetch(`https://kek.sh/api/v1/posts/${postId}/mature`, {
              method: 'PUT',
              headers: {
                'x-kek-auth': apiKey,
                'Content-Type': 'application/json',
                'User-Agent': 'CatboxUploader/2.0',
              },
              body: JSON.stringify({ value: true }),
            });

            if (!matureResp.ok && DEBUG) {
              console.warn(`[kek] Failed to set mature for post ${postId}: ${matureResp.status}`);
            }
          } catch (matureError) {
            if (DEBUG) {
              console.warn(`[kek] Error setting mature for post ${postId}:`, matureError);
            }
          }
        }

        return new Response(text, {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (response.status === 429 && attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
        if (DEBUG) {
          console.log(`[kek] Rate limited, attempt ${attempt + 1}`);
        }
        const waitMs = calculateExponentialBackoff(attempt);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }

      return new Response(text, {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (DEBUG) {
        console.error(`[kek] Error on attempt ${attempt + 1}:`, lastError.message);
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
