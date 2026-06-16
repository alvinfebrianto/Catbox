import {
  RateLimitEntry,
  AllRateLimits,
  RateLimitCheckResult,
  RateLimitHeaders,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  IMGCHEST_RATE_LIMIT,
  SXCU_RATE_LIMIT,
  parseRateLimitHeaders,
  calculateExponentialBackoff,
  calculateWaitTimeFromHeaders,
  isRateLimitExpired,
  createRateLimitEntry,
  getCorsHeaders,
  validateFiles,
  validateImgchestFiles,
} from './types';
import { FAIL_FAST_RATE_LIMIT_POLICY, DurableObjectRateLimitStore, executeRateLimited } from './rate-limit/engine';
import { SxcuUploadInput, uploadToSxcu } from './providers/sxcu';
import { uploadToImgchest } from './providers/imgchest';

const SXCU_GLOBAL_BUCKET = '__sxcu_global__';

export class RateLimiter {
  state: DurableObjectState;
  storage: DurableObjectStorage;
  rateLimits: AllRateLimits;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.storage = state.storage;
    this.rateLimits = {
      imgchest: { default: null },
      sxcu: { buckets: {}, global: null },
      catbox: { default: null },
    };

    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.storage.get<AllRateLimits>('rateLimits');
      if (stored) {
        this.rateLimits = stored;
        this.cleanupExpiredEntries();
      }
    });
  }

  private async persistRateLimits(): Promise<void> {
    await this.storage.put('rateLimits', this.rateLimits);
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();

    if (this.rateLimits.imgchest.default && isRateLimitExpired(this.rateLimits.imgchest.default, now)) {
      this.rateLimits.imgchest.default = null;
    }

    if (this.rateLimits.sxcu.global && isRateLimitExpired(this.rateLimits.sxcu.global, now)) {
      this.rateLimits.sxcu.global = null;
    }

    for (const bucket of Object.keys(this.rateLimits.sxcu.buckets)) {
      if (isRateLimitExpired(this.rateLimits.sxcu.buckets[bucket], now)) {
        delete this.rateLimits.sxcu.buckets[bucket];
      }
    }

    if (this.rateLimits.catbox.default && isRateLimitExpired(this.rateLimits.catbox.default, now)) {
      this.rateLimits.catbox.default = null;
    }
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

    this.cleanupExpiredEntries();

    try {
      if (method === 'POST' && path === '/upload/imgchest/post') {
        return await this.handleImgchestPost(request, corsHeaders);
      }

      if (method === 'POST' && path.startsWith('/upload/imgchest/post/') && path.endsWith('/add')) {
        return await this.handleImgchestAdd(request, corsHeaders);
      }

      if (method === 'POST' && path === '/upload/sxcu/collections') {
        return await this.handleSxcuCollections(request, corsHeaders);
      }

      if (method === 'POST' && path === '/upload/sxcu/files') {
        return await this.handleSxcuFiles(request, corsHeaders);
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

  private checkImgchestRateLimit(cost: number = 1): RateLimitCheckResult {
    const now = Date.now();
    const entry = this.rateLimits.imgchest.default;

    if (!entry || isRateLimitExpired(entry, now)) {
      return { allowed: true, waitMs: 0 };
    }

    if (entry.remaining < cost) {
      const waitMs = entry.resetAt - now + 100;
      return {
        allowed: false,
        waitMs: Math.max(waitMs, 100),
        reason: 'bucket',
        resetAt: entry.resetAt,
      };
    }

    return { allowed: true, waitMs: 0 };
  }

  private checkSxcuRateLimit(bucketId: string | null, cost: number = 1): RateLimitCheckResult {
    const now = Date.now();

    const globalEntry = this.rateLimits.sxcu.global;
    if (globalEntry && !isRateLimitExpired(globalEntry, now)) {
      if (globalEntry.remaining < cost) {
        const waitMs = globalEntry.resetAt - now + 100;
        return {
          allowed: false,
          waitMs: Math.max(waitMs, 100),
          reason: 'global',
          bucket: SXCU_GLOBAL_BUCKET,
          resetAt: globalEntry.resetAt,
        };
      }
    }

    if (bucketId) {
      const bucketEntry = this.rateLimits.sxcu.buckets[bucketId];
      if (bucketEntry && !isRateLimitExpired(bucketEntry, now)) {
        if (bucketEntry.remaining < cost) {
          const waitMs = bucketEntry.resetAt - now + 100;
          return {
            allowed: false,
            waitMs: Math.max(waitMs, 100),
            reason: 'bucket',
            bucket: bucketId,
            resetAt: bucketEntry.resetAt,
          };
        }
      }
    }

    return { allowed: true, waitMs: 0 };
  }

  private updateImgchestRateLimit(headers: RateLimitHeaders): void {
    const now = Date.now();

    if (headers.limit !== undefined && headers.remaining !== undefined) {
      this.rateLimits.imgchest.default = {
        limit: headers.limit,
        remaining: headers.remaining,
        resetAt: now + IMGCHEST_RATE_LIMIT.windowMs,
        windowStart: now,
        lastUpdated: now,
      };
    } else if (this.rateLimits.imgchest.default) {
      this.rateLimits.imgchest.default.remaining = Math.max(0, this.rateLimits.imgchest.default.remaining - 1);
      this.rateLimits.imgchest.default.lastUpdated = now;
    }

    this.persistRateLimits();
  }

  private updateSxcuRateLimit(headers: RateLimitHeaders, isGlobalError: boolean = false): void {
    const now = Date.now();

    if (isGlobalError || headers.isGlobal) {
      this.rateLimits.sxcu.global = createRateLimitEntry({
        limit: SXCU_RATE_LIMIT.globalRequestsPerMinute,
        remaining: 0,
        resetAfter: headers.resetAfter,
        reset: headers.reset,
      }, now);
    } else {
      if (this.rateLimits.sxcu.global) {
        this.rateLimits.sxcu.global.remaining = Math.max(0, this.rateLimits.sxcu.global.remaining - 1);
        this.rateLimits.sxcu.global.lastUpdated = now;
      } else {
        this.rateLimits.sxcu.global = {
          limit: SXCU_RATE_LIMIT.globalRequestsPerMinute,
          remaining: SXCU_RATE_LIMIT.globalRequestsPerMinute - 1,
          resetAt: now + SXCU_RATE_LIMIT.globalWindowMs,
          windowStart: now,
          lastUpdated: now,
        };
      }
    }

    if (headers.bucket && headers.limit !== undefined && headers.remaining !== undefined) {
      this.rateLimits.sxcu.buckets[headers.bucket] = createRateLimitEntry(headers, now);
    }

    this.persistRateLimits();
  }

  private async waitWithBackoff(
    waitMs: number,
    attempt: number,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<void> {
    const backoffMs = calculateExponentialBackoff(attempt, config);
    const actualWaitMs = Math.max(waitMs, backoffMs);
    const cappedWaitMs = Math.min(actualWaitMs, config.maxDelayMs);

    await new Promise(resolve => setTimeout(resolve, cappedWaitMs));
  }

  private async executeWithRateLimitRetry<T>(
    provider: 'imgchest' | 'sxcu',
    bucketId: string | null,
    operation: () => Promise<{ response: Response; result: T; isGlobalError?: boolean }>,
    config: RetryConfig = DEFAULT_RETRY_CONFIG
  ): Promise<{ response: Response; result: T | { error: string } }> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      const checkResult = provider === 'imgchest'
        ? this.checkImgchestRateLimit(1)
        : this.checkSxcuRateLimit(bucketId, 1);

      if (!checkResult.allowed) {
        if (provider === 'sxcu') {
          const headers = new Headers();
          headers.set('X-RateLimit-Remaining', '0');
          if (checkResult.resetAt) {
            headers.set('X-RateLimit-Reset', Math.ceil(checkResult.resetAt / 1000).toString());
          }
          headers.set('X-RateLimit-Limit', '5');
          if (checkResult.bucket) headers.set('X-RateLimit-Bucket', checkResult.bucket);
          if (checkResult.reason === 'global') headers.set('X-RateLimit-Global', 'true');

          return {
            response: new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
              status: 429,
              headers,
            }),
            result: { error: 'Rate limit exceeded' }
          };
        }

        if (attempt === config.maxRetries) {
          throw new Error(`Rate limit exceeded for ${provider}. Reset at: ${new Date(checkResult.resetAt || Date.now()).toISOString()}`);
        }
        await this.waitWithBackoff(checkResult.waitMs, attempt, config);
        this.cleanupExpiredEntries();
        continue;
      }

      try {
        const { response, result, isGlobalError: opIsGlobalError } = await operation();

        if (response.status === 429) {
          const headers = parseRateLimitHeaders(response.headers);
          
          if (provider === 'sxcu') {
            let isGlobalError = headers.isGlobal;
            if (opIsGlobalError !== undefined) {
              isGlobalError = isGlobalError || opIsGlobalError;
            } else if (!isGlobalError && !response.bodyUsed) {
              isGlobalError = await this.isSxcuGlobalError(response.clone());
            }
            this.updateSxcuRateLimit(headers, isGlobalError);
            return { response, result };
          } else {
            this.updateImgchestRateLimit(headers);
          }

          if (attempt === config.maxRetries) {
            throw new Error(`Rate limit exceeded for ${provider} after ${config.maxRetries} retries`);
          }

          const waitMs = calculateWaitTimeFromHeaders(headers);
          await this.waitWithBackoff(waitMs, attempt, config);
          continue;
        }

        return { response, result };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === config.maxRetries) {
          throw lastError;
        }

        await this.waitWithBackoff(1000, attempt, config);
      }
    }

    throw lastError || new Error('Unknown error during rate-limited operation');
  }

  private async isSxcuGlobalError(response: Response): Promise<boolean> {
    try {
      const json = await response.json() as { code?: number; error?: string };
      return json.code === 2 || (json.error?.includes('Global rate limit') ?? false);
    } catch {
      return false;
    }
  }

  private createResponseHeaders(apiHeaders: Headers, corsHeaders: Record<string, string>): Headers {
    const responseHeaders = new Headers(corsHeaders);
    responseHeaders.set('Content-Type', 'application/json');

    const rateLimitHeaderNames = [
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-RateLimit-Reset-After',
      'X-RateLimit-Bucket',
      'X-RateLimit-Global',
    ];

    for (const name of rateLimitHeaderNames) {
      const value = apiHeaders.get(name);
      if (value) responseHeaders.set(name, value);
    }

    return responseHeaders;
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

  private async handleSxcuCollections(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const formData = await request.formData();

    const input: SxcuUploadInput = { type: 'collection', formData };
    const store = new DurableObjectRateLimitStore(this.storage);

    const result = await executeRateLimited({
      provider: 'sxcu',
      policy: FAIL_FAST_RATE_LIMIT_POLICY,
      store,
      operation: () => uploadToSxcu(input),
    });

    if (result.type === 'error') {
      return new Response(JSON.stringify({ error: result.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    return new Response(JSON.stringify(result.providerResult.body), {
      headers: this.createResponseHeadersFromProvider(result.providerResult.rateLimitHeaders, corsHeaders),
      status: result.providerResult.status,
    });
  }

  private async handleSxcuFiles(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const formData = await request.formData();
    const files = formData.getAll('file') as File[];

    if (files.length > 0) {
      const validation = validateFiles(files);
      if (!validation.ok) {
        return new Response(JSON.stringify({ error: validation.error }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        });
      }
    }

    const input: SxcuUploadInput = { type: 'file', formData };
    const store = new DurableObjectRateLimitStore(this.storage);

    const result = await executeRateLimited({
      provider: 'sxcu',
      policy: FAIL_FAST_RATE_LIMIT_POLICY,
      store,
      operation: () => uploadToSxcu(input),
    });

    if (result.type === 'error') {
      return new Response(JSON.stringify({ error: result.error }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    return new Response(JSON.stringify(result.providerResult.body), {
      headers: this.createResponseHeadersFromProvider(result.providerResult.rateLimitHeaders, corsHeaders),
      status: result.providerResult.status,
    });
  }
}
