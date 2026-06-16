import { FetchLike, getDefaultFetch, ProviderResult } from '../provider-protocol';
import { withRetry, Sleep } from '../retry';
import { DEFAULT_RETRY_CONFIG, parseRateLimitHeaders, RetryConfig } from '../types';

export interface CatboxProviderOptions {
  fetch?: FetchLike;
  retryConfig?: RetryConfig;
  sleep?: Sleep;
}

export async function uploadToCatbox(
  formData: FormData,
  options: CatboxProviderOptions = {}
): Promise<ProviderResult> {
  const fetchImpl = options.fetch ?? getDefaultFetch();
  const config = options.retryConfig ?? DEFAULT_RETRY_CONFIG;

  return withRetry(
    async () => {
      const response = await fetchImpl('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: formData,
        headers: {
          'User-Agent': 'CatboxUploader/2.0',
        },
      });

      return {
        status: response.status,
        body: await response.text(),
        rateLimitHeaders: parseRateLimitHeaders(response.headers),
      };
    },
    {
      config,
      shouldRetry: result => result.status === 429,
      sleep: options.sleep,
    }
  );
}
