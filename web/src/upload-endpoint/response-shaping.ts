import { ProviderResult } from '../provider-protocol';
import { RateLimitHeaders } from '../types';

export function shapeSuccessResponse(
  result: ProviderResult,
  corsHeaders: Record<string, string>,
): Response {
  const status = result.status >= 200 && result.status < 300 ? 200 : result.status;
  return new Response(String(result.body), {
    status,
    headers: corsHeaders,
  });
}

export function shapeJsonSuccessResponse(
  result: ProviderResult,
  corsHeaders: Record<string, string>,
): Response {
  const status = result.status >= 200 && result.status < 300 ? 200 : result.status;
  const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
  return new Response(body, {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function shapeJsonProviderResponse(
  result: ProviderResult,
  corsHeaders: Record<string, string>,
): Response {
  const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
  return new Response(body, {
    status: result.status,
    headers: { ...corsHeaders, ...rateLimitHeaders(result.rateLimitHeaders), 'Content-Type': 'application/json' },
  });
}

export function shapeErrorResponse(
  status: number,
  message: string,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function rateLimitHeaders(rlh: RateLimitHeaders | undefined): Record<string, string> {
  const headers: Record<string, string> = {};

  if (rlh?.limit !== undefined) headers['X-RateLimit-Limit'] = String(rlh.limit);
  if (rlh?.remaining !== undefined) headers['X-RateLimit-Remaining'] = String(rlh.remaining);
  if (rlh?.reset !== undefined) headers['X-RateLimit-Reset'] = String(rlh.reset);
  if (rlh?.resetAfter !== undefined) headers['X-RateLimit-Reset-After'] = String(rlh.resetAfter);
  if (rlh?.bucket !== undefined) headers['X-RateLimit-Bucket'] = rlh.bucket;
  if (rlh?.isGlobal) headers['X-RateLimit-Global'] = 'true';

  return headers;
}
