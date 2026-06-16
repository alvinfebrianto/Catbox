import { ProviderResult } from '../provider-protocol';
import { withRetry, Sleep } from '../retry';
import {
  AllRateLimits,
  DEFAULT_RETRY_CONFIG,
  IMGCHEST_RATE_LIMIT,
  RateLimitCheckResult,
  RateLimitHeaders,
  RetryConfig,
  SXCU_RATE_LIMIT,
  calculateExponentialBackoff,
  calculateWaitTimeFromHeaders,
  createRateLimitEntry,
  isRateLimitExpired,
} from '../types';

const SXCU_GLOBAL_BUCKET = '__sxcu_global__';

export type RateLimitedProvider = 'imgchest' | 'sxcu';
export type RateLimitPolicyAction = 'retry' | 'return';

export interface RateLimitRetryPolicy {
  onPreFlightBlocked: RateLimitPolicyAction;
  onResponse429: RateLimitPolicyAction;
}

export const FAIL_FAST_RATE_LIMIT_POLICY: RateLimitRetryPolicy = {
  onPreFlightBlocked: 'return',
  onResponse429: 'return',
};

export const RETRY_AFTER_WAIT_RATE_LIMIT_POLICY: RateLimitRetryPolicy = {
  onPreFlightBlocked: 'retry',
  onResponse429: 'retry',
};

export interface RateLimitStore {
  load(): Promise<AllRateLimits>;
  save(state: AllRateLimits): Promise<void>;
}

export interface ExecuteRateLimitedOptions {
  provider: RateLimitedProvider;
  bucketId?: string | null;
  policy: RateLimitRetryPolicy;
  store: RateLimitStore;
  operation: () => Promise<ProviderResult>;
  config?: RetryConfig;
  sleep?: Sleep;
  now?: () => number;
}

export type RateLimitEngineResult =
  | { type: 'ok'; providerResult: ProviderResult; attempts: number }
  | { type: 'rate-limited'; providerResult: ProviderResult; retryAfterMs: number; attempts: number }
  | { type: 'error'; error: string; attempts: number };

type RetryableEngineResult = RateLimitEngineResult & { retryable: boolean };

export class MemoryRateLimitStore implements RateLimitStore {
  private state: AllRateLimits;

  constructor(initialState: AllRateLimits = createEmptyRateLimitState()) {
    this.state = cloneState(initialState);
  }

  async load(): Promise<AllRateLimits> {
    return cloneState(this.state);
  }

  async save(state: AllRateLimits): Promise<void> {
    this.state = cloneState(state);
  }
}

export class DurableObjectRateLimitStore implements RateLimitStore {
  constructor(
    private readonly storage: Pick<DurableObjectStorage, 'get' | 'put'>,
    private readonly key = 'rateLimits'
  ) {}

  async load(): Promise<AllRateLimits> {
    return (await this.storage.get<AllRateLimits>(this.key)) ?? createEmptyRateLimitState();
  }

  async save(state: AllRateLimits): Promise<void> {
    await this.storage.put(this.key, state);
  }
}

export async function executeRateLimited(options: ExecuteRateLimitedOptions): Promise<RateLimitEngineResult> {
  const config = options.config ?? DEFAULT_RETRY_CONFIG;
  const now = options.now ?? Date.now;
  let attempts = 0;

  try {
    const result = await withRetry<RetryableEngineResult>(
      async attempt => {
        attempts = attempt + 1;
        const state = cleanupExpiredEntries(await options.store.load(), now());
        const check = checkRateLimit(state, options.provider, options.bucketId ?? null, 1, now());

        if (!check.allowed) {
          const retryAfterMs = Math.max(check.waitMs, 0);
          const providerResult = blockedProviderResult(check);
          return {
            type: 'rate-limited',
            providerResult,
            retryAfterMs,
            attempts,
            retryable: options.policy.onPreFlightBlocked === 'retry',
          };
        }

        const providerResult = await options.operation();

        if (providerResult.rateLimitHeaders) {
          updateRateLimitState(state, options.provider, providerResult.rateLimitHeaders, now());
          await options.store.save(state);
        }

        if (providerResult.status === 429) {
          const retryAfterMs = calculateWaitTimeFromHeaders(providerResult.rateLimitHeaders ?? {}, now());
          return {
            type: 'rate-limited',
            providerResult,
            retryAfterMs,
            attempts,
            retryable: options.policy.onResponse429 === 'retry',
          };
        }

        return { type: 'ok', providerResult, attempts, retryable: false };
      },
      {
        config,
        shouldRetry: result => result.retryable,
        delayMs: (attempt, result) => Math.max(
          result?.type === 'rate-limited' ? result.retryAfterMs : 0,
          calculateExponentialBackoff(attempt, config)
        ),
        sleep: options.sleep,
      }
    );

    return stripRetryable(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { type: 'error', error: message, attempts };
  }
}

export function createEmptyRateLimitState(): AllRateLimits {
  return {
    imgchest: { default: null },
    sxcu: { buckets: {}, global: null },
    catbox: { default: null },
  };
}

function cleanupExpiredEntries(state: AllRateLimits, now: number): AllRateLimits {
  if (state.imgchest.default && isRateLimitExpired(state.imgchest.default, now)) {
    state.imgchest.default = null;
  }

  if (state.sxcu.global && isRateLimitExpired(state.sxcu.global, now)) {
    state.sxcu.global = null;
  }

  for (const bucket of Object.keys(state.sxcu.buckets)) {
    if (isRateLimitExpired(state.sxcu.buckets[bucket], now)) {
      delete state.sxcu.buckets[bucket];
    }
  }

  if (state.catbox.default && isRateLimitExpired(state.catbox.default, now)) {
    state.catbox.default = null;
  }

  return state;
}

function checkRateLimit(
  state: AllRateLimits,
  provider: RateLimitedProvider,
  bucketId: string | null,
  cost: number,
  now: number
): RateLimitCheckResult {
  if (provider === 'imgchest') {
    const entry = state.imgchest.default;
    if (!entry || isRateLimitExpired(entry, now) || entry.remaining >= cost) {
      return { allowed: true, waitMs: 0 };
    }

    return {
      allowed: false,
      waitMs: Math.max(entry.resetAt - now + 100, 100),
      reason: 'bucket',
      resetAt: entry.resetAt,
    };
  }

  const globalEntry = state.sxcu.global;
  if (globalEntry && !isRateLimitExpired(globalEntry, now) && globalEntry.remaining < cost) {
    return {
      allowed: false,
      waitMs: Math.max(globalEntry.resetAt - now + 100, 100),
      reason: 'global',
      bucket: SXCU_GLOBAL_BUCKET,
      resetAt: globalEntry.resetAt,
    };
  }

  if (bucketId) {
    const bucketEntry = state.sxcu.buckets[bucketId];
    if (bucketEntry && !isRateLimitExpired(bucketEntry, now) && bucketEntry.remaining < cost) {
      return {
        allowed: false,
        waitMs: Math.max(bucketEntry.resetAt - now + 100, 100),
        reason: 'bucket',
        bucket: bucketId,
        resetAt: bucketEntry.resetAt,
      };
    }
  }

  return { allowed: true, waitMs: 0 };
}

function updateRateLimitState(
  state: AllRateLimits,
  provider: RateLimitedProvider,
  headers: RateLimitHeaders,
  now: number
): void {
  if (provider === 'imgchest') {
    if (headers.limit !== undefined || headers.remaining !== undefined) {
      state.imgchest.default = createRateLimitEntry(headers, now);
    }
    return;
  }

  if (headers.isGlobal) {
    state.sxcu.global = createRateLimitEntry({
      limit: SXCU_RATE_LIMIT.globalRequestsPerMinute,
      remaining: headers.remaining ?? 0,
      reset: headers.reset,
      resetAfter: headers.resetAfter,
    }, now);
  }

  if (headers.bucket) {
    state.sxcu.buckets[headers.bucket] = createRateLimitEntry(headers, now);
  }
}

function blockedProviderResult(check: RateLimitCheckResult): ProviderResult {
  return {
    status: 429,
    body: { error: 'Rate limit exceeded' },
    rateLimitHeaders: {
      limit: check.reason === 'global' ? SXCU_RATE_LIMIT.globalRequestsPerMinute : IMGCHEST_RATE_LIMIT.requestsPerMinute,
      remaining: 0,
      reset: check.resetAt ? Math.ceil(check.resetAt / 1000) : undefined,
      bucket: check.bucket,
      isGlobal: check.reason === 'global' ? true : undefined,
    },
  };
}

function stripRetryable(result: RetryableEngineResult): RateLimitEngineResult {
  if (result.type === 'ok') {
    return { type: 'ok', providerResult: result.providerResult, attempts: result.attempts };
  }

  if (result.type === 'rate-limited') {
    return {
      type: 'rate-limited',
      providerResult: result.providerResult,
      retryAfterMs: result.retryAfterMs,
      attempts: result.attempts,
    };
  }

  return { type: 'error', error: result.error, attempts: result.attempts };
}

function cloneState(state: AllRateLimits): AllRateLimits {
  return JSON.parse(JSON.stringify(state)) as AllRateLimits;
}
