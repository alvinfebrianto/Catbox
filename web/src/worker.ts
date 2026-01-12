import { RateLimiter } from './rate-limiter';
import { CORS_HEADERS } from './types';

interface Env {
  IMGCHEST_API_TOKEN?: string;
  RATE_LIMITER?: DurableObjectNamespace;
}

export { RateLimiter };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS, status: 204 });
    }

    if (!env.RATE_LIMITER) {
      return new Response(JSON.stringify({ error: 'Rate limiter not configured' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const rateLimiterId = env.RATE_LIMITER.idFromName('global');
    const rateLimiter = env.RATE_LIMITER.get(rateLimiterId);

    const headers = new Headers(request.headers);
    if (env.IMGCHEST_API_TOKEN && !headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer ' + env.IMGCHEST_API_TOKEN);
    }

    const rateLimiterRequest = new Request(request.url, {
      method: request.method,
      headers: headers,
      body: request.body,
    });

    return rateLimiter.fetch(rateLimiterRequest);
  }
} satisfies ExportedHandler<Env>;
