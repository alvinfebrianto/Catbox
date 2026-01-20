export type Provider = 'catbox' | 'sxcu' | 'imgchest';

export interface UploadResult {
  type: 'success' | 'error' | 'warning';
  url?: string;
  message?: string;
  isAlbum?: boolean;
  isCollection?: boolean;
  isPost?: boolean;
}

export interface RateLimitEntry {
  limit: number;
  remaining: number;
  resetAt: number;
  windowStart: number;
  lastUpdated: number;
}

export interface RateLimitData {
  remaining: number;
  limit: number;
  reset?: number;
  windowStart: number;
}

export interface SxcuRateLimitState {
  buckets: Record<string, RateLimitEntry>;
  global: RateLimitEntry | null;
}

export interface ImgchestRateLimitState {
  default: RateLimitEntry | null;
}

export interface CatboxRateLimitState {
  default: RateLimitEntry | null;
}

export interface AllRateLimits {
  imgchest: ImgchestRateLimitState;
  sxcu: SxcuRateLimitState;
  catbox: CatboxRateLimitState;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  waitMs: number;
  reason?: 'bucket' | 'global' | 'unknown';
  bucket?: string;
  resetAt?: number;
}

export interface RateLimitHeaders {
  limit?: number;
  remaining?: number;
  reset?: number;
  resetAfter?: number;
  bucket?: string;
  isGlobal?: boolean;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 120000,
  jitterMs: 500,
};

export const IMGCHEST_RATE_LIMIT = {
  requestsPerMinute: 60,
  windowMs: 60000,
};

export const SXCU_RATE_LIMIT = {
  globalRequestsPerMinute: 240,
  globalWindowMs: 60000,
};

export interface ImgchestPostResponse {
  data: {
    id: string;
    images: Array<{ link: string }>;
  };
  error?: string;
}

export interface SxcuResponse {
  url?: string;
  id?: string;
  error?: string;
  code?: number;
  rateLimitExceeded?: boolean;
  rateLimitReset?: number;
  rateLimitResetAfter?: number;
}

export interface SxcuCollectionResponse {
  collection_id?: string;
  collection_token?: string;
  url?: string;
  error?: string;
  code?: number;
}

export interface WorkerEnv {
  IMGCHEST_API_TOKEN?: string;
  RATE_LIMITER?: DurableObjectNamespace;
}

const ALLOWED_ORIGINS = new Set([
  'https://image-uploader.alvinpelajar.workers.dev',
  'http://localhost:3000',
]);

export function getCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Auth',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Proxy-Auth',
  'Access-Control-Max-Age': '86400',
};

export const ALLOWED_EXTENSIONS = [
  '.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp',
  '.tiff', '.tif', '.webm', '.webp'
];

export const MAX_IMGCHEST_IMAGES_PER_REQUEST = 20;

export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 100 * 1024 * 1024;
export const MAX_FILE_COUNT = 50;

export const IMGCHEST_MAX_FILE_SIZE = 30 * 1024 * 1024;
export const IMGCHEST_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4'];

export interface FileValidationResult {
  ok: boolean;
  error?: string;
}

export function validateFiles(
  files: File[],
  maxFiles: number = MAX_FILE_COUNT,
  maxTotal: number = MAX_TOTAL_SIZE,
  maxEach: number = MAX_FILE_SIZE
): FileValidationResult {
  if (files.length === 0) {
    return { ok: false, error: 'No files provided' };
  }

  if (files.length > maxFiles) {
    return { ok: false, error: `Too many files (max ${maxFiles})` };
  }

  let total = 0;
  for (const f of files) {
    total += f.size;

    if (f.size <= 0) {
      return { ok: false, error: 'Empty file' };
    }

    if (f.size > maxEach) {
      return { ok: false, error: `File too large: ${f.name}` };
    }

    if (total > maxTotal) {
      return { ok: false, error: 'Request too large' };
    }

    const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return { ok: false, error: `Disallowed file type: ${f.name}` };
    }
  }

  return { ok: true };
}

export function validateImgchestFiles(files: File[]): FileValidationResult {
  if (files.length === 0) {
    return { ok: false, error: 'No files provided' };
  }

  if (files.length > MAX_FILE_COUNT) {
    return { ok: false, error: `Too many files (max ${MAX_FILE_COUNT})` };
  }

  for (const f of files) {
    if (f.size <= 0) {
      return { ok: false, error: 'Empty file' };
    }

    if (f.size > IMGCHEST_MAX_FILE_SIZE) {
      return { ok: false, error: `File too large: ${f.name} (max 30MB for Imgchest)` };
    }

    const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    if (!IMGCHEST_ALLOWED_EXTENSIONS.includes(ext)) {
      return { ok: false, error: `Unsupported file type for Imgchest: ${f.name}. Only jpg, jpeg, png, gif, webp, and mp4 are allowed.` };
    }
  }

  return { ok: true };
}

export function parseRateLimitHeaders(headers: Headers): RateLimitHeaders {
  const result: RateLimitHeaders = {};

  const limit = headers.get('X-RateLimit-Limit');
  if (limit) result.limit = parseInt(limit, 10);

  const remaining = headers.get('X-RateLimit-Remaining');
  if (remaining !== null) result.remaining = parseInt(remaining, 10);

  const reset = headers.get('X-RateLimit-Reset');
  if (reset) result.reset = parseInt(reset, 10);

  const resetAfter = headers.get('X-RateLimit-Reset-After');
  if (resetAfter) result.resetAfter = parseFloat(resetAfter);

  const bucket = headers.get('X-RateLimit-Bucket');
  if (bucket) result.bucket = bucket;

  const isGlobal = headers.get('X-RateLimit-Global');
  if (isGlobal) result.isGlobal = true;

  return result;
}

export function calculateExponentialBackoff(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = Math.random() * config.jitterMs;
  return Math.floor(cappedDelay + jitter);
}

export function calculateWaitTimeFromHeaders(headers: RateLimitHeaders, nowMs: number = Date.now()): number {
  if (headers.resetAfter !== undefined && headers.resetAfter > 0) {
    return Math.ceil(headers.resetAfter * 1000) + 100;
  }

  if (headers.reset !== undefined) {
    const resetMs = headers.reset * 1000;
    if (resetMs > nowMs) {
      return resetMs - nowMs + 100;
    }
  }

  return 60000 + 100;
}

export function isRateLimitExpired(entry: RateLimitEntry, nowMs: number = Date.now()): boolean {
  return nowMs >= entry.resetAt;
}

export function createRateLimitEntry(
  headers: RateLimitHeaders,
  nowMs: number = Date.now()
): RateLimitEntry {
  let resetAt: number;

  if (headers.resetAfter !== undefined) {
    resetAt = nowMs + Math.ceil(headers.resetAfter * 1000);
  } else if (headers.reset !== undefined) {
    resetAt = headers.reset * 1000;
  } else {
    resetAt = nowMs + 60000;
  }

  return {
    limit: headers.limit ?? 60,
    remaining: headers.remaining ?? 59,
    resetAt,
    windowStart: nowMs,
    lastUpdated: nowMs,
  };
}
