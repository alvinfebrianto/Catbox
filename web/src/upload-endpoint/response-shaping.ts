import { ProviderResult } from '../provider-protocol';

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
