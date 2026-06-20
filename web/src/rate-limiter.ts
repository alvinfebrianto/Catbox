import { getBearerToken, getCorsHeaders } from './types';
import { DurableObjectRateLimitStore } from './rate-limit/engine';
import { handleUploadRequest, type UploadEndpointDeps } from './upload-endpoint';

export class RateLimiter {
  state: DurableObjectState;
  storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('X-Origin') || request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    try {
      if (request.method === 'POST') {
        const token = getBearerToken(request);
        const deps: UploadEndpointDeps = {
          corsHeaders,
          store: new DurableObjectRateLimitStore(this.storage),
          secrets: { imgchestToken: token ?? undefined },
        };
        const result = await handleUploadRequest(request, deps);
        if (result) return result;
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
}
