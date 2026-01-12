import { CORS_HEADERS } from './types';

export interface RateLimitEntry {
  limit: number;
  remaining: number;
  resetAt: number;
  windowStart: number;
}

export interface ProviderRateLimits {
  [bucketKey: string]: RateLimitEntry;
}

export interface AllRateLimits {
  imgchest: ProviderRateLimits;
  sxcu: ProviderRateLimits;
  catbox: ProviderRateLimits;
}

export class RateLimiter {
  state: DurableObjectState;
  storage: DurableObjectStorage;
  rateLimits: AllRateLimits;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.storage = state.storage;
    this.rateLimits = {
      imgchest: {},
      sxcu: {},
      catbox: {}
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS, status: 204 });
    }

    if (method === 'POST' && path === '/upload/imgchest/post') {
      return this.handleImgchestPost(request);
    }

    if (method === 'POST' && path.startsWith('/upload/imgchest/post/') && path.endsWith('/add')) {
      return this.handleImgchestAdd(request);
    }

    if (method === 'POST' && path === '/upload/sxcu/collections') {
      return this.handleSxcuCollections(request);
    }

    if (method === 'POST' && path === '/upload/sxcu/files') {
      return this.handleSxcuFiles(request);
    }

    if (method === 'POST' && path === '/upload/catbox') {
      return this.handleCatboxUpload(request);
    }

    return new Response('Not Found', { status: 404 });
  }

  private getBucketKey(provider: string, bucketId?: string | null): string {
    return bucketId || 'default';
  }

  private async checkRateLimit(
    provider: 'imgchest' | 'sxcu' | 'catbox',
    bucketId: string | null,
    cost: number = 1
  ): Promise<{ allowed: boolean; waitSeconds: number; entry?: RateLimitEntry }> {
    const bucketKey = this.getBucketKey(provider, bucketId);
    const now = Date.now();
    const currentWindow = Math.floor(now / 60000);

    let entry = this.rateLimits[provider][bucketKey];

    if (!entry || Math.floor(entry.windowStart / 60000) < currentWindow) {
      return { allowed: true, waitSeconds: 0 };
    }

    const windowElapsed = (now - entry.windowStart) / 1000;

    if (windowElapsed >= 60) {
      delete this.rateLimits[provider][bucketKey];
      return { allowed: true, waitSeconds: 0 };
    }

    if ((entry.remaining - cost) < 0) {
      const waitSeconds = Math.max(60 - windowElapsed + 0.1, 0.1);
      return { allowed: false, waitSeconds };
    }

    return { allowed: true, waitSeconds: 0, entry };
  }

  private async updateRateLimit(
    provider: 'imgchest' | 'sxcu' | 'catbox',
    bucketId: string | null,
    limit: number,
    remaining: number,
    reset?: number
  ): Promise<void> {
    const bucketKey = this.getBucketKey(provider, bucketId);
    const now = Date.now();

    this.rateLimits[provider][bucketKey] = {
      limit,
      remaining,
      resetAt: reset ? reset * 1000 : now + 60000,
      windowStart: now
    };
  }

  private async waitForRateLimit(
    provider: 'imgchest' | 'sxcu' | 'catbox',
    bucketId: string | null,
    cost: number = 1
  ): Promise<void> {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      const result = await this.checkRateLimit(provider, bucketId, cost);

      if (result.allowed) {
        return;
      }

      if (attempts === maxAttempts - 1) {
        throw new Error(`Rate limit exceeded for ${provider}`);
      }

      await new Promise(resolve => setTimeout(resolve, result.waitSeconds * 1000));
      attempts++;
    }
  }

  private getRetryAfterSeconds(bucketId: string | null, headers: Headers): number {
    const resetAfter = headers.get('X-RateLimit-Reset-After');
    if (resetAfter) {
      return parseFloat(resetAfter) + 1;
    }

    const reset = headers.get('X-RateLimit-Reset');
    if (reset) {
      const resetTime = parseInt(reset) * 1000;
      const now = Date.now();
      if (resetTime > now) {
        return (resetTime - now) / 1000 + 1;
      }
    }

    return 61;
  }

  private async handleImgchestPost(request: Request): Promise<Response> {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  (request as unknown as { env?: { IMGCHEST_API_TOKEN?: string } }).env?.IMGCHEST_API_TOKEN;

    if (!token) {
      return new Response(JSON.stringify({ error: 'Imgchest API token not configured' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const formData = await request.formData();
    const images = formData.getAll('images[]') as File[];

    if (images.length === 0) {
      return new Response(JSON.stringify({ error: 'No images provided' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const otherEntries: [string, FormDataEntryValue][] = [];
    for (const [key, value] of formData.entries()) {
      if (key !== 'images[]') {
        otherEntries.push([key, value]);
      }
    }

    const MAX_IMAGES_PER_REQUEST = 20;
    const chunks: File[][] = [];
    for (let i = 0; i < images.length; i += MAX_IMAGES_PER_REQUEST) {
      chunks.push(images.slice(i, i + MAX_IMAGES_PER_REQUEST));
    }

    let finalResult: Record<string, unknown> | null = null;
    let rateLimitHeaders: Headers | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isFirstChunk = i === 0;
      const url = isFirstChunk
        ? 'https://api.imgchest.com/v1/post'
        : `https://api.imgchest.com/v1/post/${(finalResult as { data: { id: string } })?.data?.id}/add`;

      await this.waitForRateLimit('imgchest', null, 1);

      const chunkFormData = new FormData();
      for (const [key, value] of otherEntries) {
        chunkFormData.append(key, value);
      }
      for (const image of chunk) {
        chunkFormData.append('images[]', image);
      }

      const response = await fetch(url, {
        method: 'POST',
        body: chunkFormData,
        headers: {
          'Authorization': 'Bearer ' + token,
        },
      });

      const text = await response.text();

      if (text.trim().startsWith('<')) {
        return new Response(JSON.stringify({ error: 'Imgchest API error', details: 'Unauthorized or API error', chunk: i + 1 }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 401,
        });
      }

      try {
        const json = JSON.parse(text);
        const limit = response.headers.get('X-RateLimit-Limit');
        const remaining = response.headers.get('X-RateLimit-Remaining');

        if (limit && remaining !== null) {
          this.updateRateLimit('imgchest', null, parseInt(limit), parseInt(remaining));
        }

        rateLimitHeaders = new Headers();
        const rateLimitHeaderNames = ['X-RateLimit-Limit', 'X-RateLimit-Remaining'];
        for (const h of rateLimitHeaderNames) {
          const value = response.headers.get(h);
          if (value) rateLimitHeaders.set(h, value);
        }

        if (!response.ok) {
          return new Response(JSON.stringify({ error: 'Imgchest API error', status: response.status, details: json, raw: text.substring(0, 500), chunk: i + 1 }), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            status: response.status,
          });
        }

        finalResult = json;
      } catch {
        return new Response(JSON.stringify({ error: 'Failed to parse JSON', raw: text.substring(0, 200), chunk: i + 1 }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 500,
        });
      }
    }

    const responseHeaders = new Headers({ ...CORS_HEADERS, 'Content-Type': 'application/json' });
    if (rateLimitHeaders) {
      for (const [key, value] of rateLimitHeaders) {
        responseHeaders.set(key, value);
      }
    }

    return new Response(JSON.stringify(finalResult), {
      headers: responseHeaders,
      status: 200,
    });
  }

  private async handleImgchestAdd(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const postId = pathParts[4];

    const token = request.headers.get('Authorization')?.replace('Bearer ', '') ||
                  (request as unknown as { env?: { IMGCHEST_API_TOKEN?: string } }).env?.IMGCHEST_API_TOKEN;

    if (!token) {
      return new Response(JSON.stringify({ error: 'Imgchest API token not configured' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const formData = await request.formData();
    const images = formData.getAll('images[]') as File[];

    if (images.length === 0) {
      return new Response(JSON.stringify({ error: 'No images provided' }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const MAX_IMAGES_PER_REQUEST = 20;
    const chunks: File[][] = [];
    for (let i = 0; i < images.length; i += MAX_IMAGES_PER_REQUEST) {
      chunks.push(images.slice(i, i + MAX_IMAGES_PER_REQUEST));
    }

    let finalResult: Record<string, unknown> | null = null;
    let rateLimitHeaders: Headers | null = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      await this.waitForRateLimit('imgchest', null, 1);

      const chunkFormData = new FormData();
      for (const image of chunk) {
        chunkFormData.append('images[]', image);
      }

      const response = await fetch(`https://api.imgchest.com/v1/post/${postId}/add`, {
        method: 'POST',
        body: chunkFormData,
        headers: {
          'Authorization': 'Bearer ' + token,
        },
      });

      const text = await response.text();

      if (text.trim().startsWith('<')) {
        return new Response(JSON.stringify({ error: 'Imgchest API error', details: 'Unauthorized or API error', chunk: i + 1 }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 401,
        });
      }

      try {
        const json = JSON.parse(text);
        const limit = response.headers.get('X-RateLimit-Limit');
        const remaining = response.headers.get('X-RateLimit-Remaining');

        if (limit && remaining !== null) {
          this.updateRateLimit('imgchest', null, parseInt(limit), parseInt(remaining));
        }

        rateLimitHeaders = new Headers();
        const rateLimitHeaderNames = ['X-RateLimit-Limit', 'X-RateLimit-Remaining'];
        for (const h of rateLimitHeaderNames) {
          const value = response.headers.get(h);
          if (value) rateLimitHeaders.set(h, value);
        }

        if (!response.ok) {
          return new Response(JSON.stringify({ error: 'Imgchest API error', status: response.status, details: json, raw: text.substring(0, 500), chunk: i + 1 }), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            status: response.status,
          });
        }

        finalResult = json;
      } catch {
        return new Response(JSON.stringify({ error: 'Failed to parse JSON', raw: text.substring(0, 200), chunk: i + 1 }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          status: 500,
        });
      }
    }

    const responseHeaders = new Headers({ ...CORS_HEADERS, 'Content-Type': 'application/json' });
    if (rateLimitHeaders) {
      for (const [key, value] of rateLimitHeaders) {
        responseHeaders.set(key, value);
      }
    }

    return new Response(JSON.stringify(finalResult), {
      headers: responseHeaders,
      status: 200,
    });
  }

  private async handleSxcuCollections(request: Request): Promise<Response> {
    const formData = await request.formData();
    const response = await fetch('https://sxcu.net/api/collections/create', {
      method: 'POST',
      body: formData,
      headers: { 'User-Agent': 'sxcuUploader/1.0' },
    });

    const json = await response.json();

    const bucketId = response.headers.get('X-RateLimit-Bucket');
    const limit = response.headers.get('X-RateLimit-Limit');
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = response.headers.get('X-RateLimit-Reset');

    if (limit && remaining !== null) {
      this.updateRateLimit('sxcu', bucketId, parseInt(limit), parseInt(remaining), reset ? parseInt(reset) : undefined);
    }

    if (response.status === 429) {
      const waitSeconds = this.getRetryAfterSeconds(bucketId, response.headers);
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

      const retryResponse = await fetch('https://sxcu.net/api/collections/create', {
        method: 'POST',
        body: formData,
        headers: { 'User-Agent': 'sxcuUploader/1.0' },
      });

      const retryJson = await retryResponse.json();

      const retryLimit = retryResponse.headers.get('X-RateLimit-Limit');
      const retryRemaining = retryResponse.headers.get('X-RateLimit-Remaining');
      const retryReset = retryResponse.headers.get('X-RateLimit-Reset');
      const retryBucket = retryResponse.headers.get('X-RateLimit-Bucket');

      if (retryLimit && retryRemaining !== null) {
        this.updateRateLimit('sxcu', retryBucket, parseInt(retryLimit), parseInt(retryRemaining), retryReset ? parseInt(retryReset) : undefined);
      }

      const responseHeaders = new Headers({ ...CORS_HEADERS, 'Content-Type': 'application/json' });
      const rateLimitHeaders = ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-RateLimit-Reset-After', 'X-RateLimit-Bucket'];
      for (const h of rateLimitHeaders) {
        const value = retryResponse.headers.get(h);
        if (value) responseHeaders.set(h, value);
      }

      return new Response(JSON.stringify(retryJson), {
        headers: responseHeaders,
        status: retryResponse.ok ? 200 : retryResponse.status,
      });
    }

    const responseHeaders = new Headers({ ...CORS_HEADERS, 'Content-Type': 'application/json' });
    const rateLimitHeaders = ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-RateLimit-Reset-After', 'X-RateLimit-Bucket'];
    for (const h of rateLimitHeaders) {
      const value = response.headers.get(h);
      if (value) responseHeaders.set(h, value);
    }

    return new Response(JSON.stringify(json), {
      headers: responseHeaders,
      status: response.ok ? 200 : response.status,
    });
  }

  private async handleSxcuFiles(request: Request): Promise<Response> {
    const formData = await request.formData();

    await this.waitForRateLimit('sxcu', 'files-create', 1);

    const response = await fetch('https://sxcu.net/api/files/create', {
      method: 'POST',
      body: formData,
      headers: { 'User-Agent': 'sxcuUploader/1.0' },
    });

    const text = await response.text();

    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: text };
    }

    const bucketId = response.headers.get('X-RateLimit-Bucket');
    const limit = response.headers.get('X-RateLimit-Limit');
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = response.headers.get('X-RateLimit-Reset');

    if (limit && remaining !== null) {
      this.updateRateLimit('sxcu', bucketId, parseInt(limit), parseInt(remaining), reset ? parseInt(reset) : undefined);
    }

    if (response.status === 429) {
      const waitSeconds = this.getRetryAfterSeconds(bucketId, response.headers);
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

      const retryResponse = await fetch('https://sxcu.net/api/files/create', {
        method: 'POST',
        body: formData,
        headers: { 'User-Agent': 'sxcuUploader/1.0' },
      });

      const retryText = await retryResponse.text();
      try {
        json = JSON.parse(retryText);
      } catch {
        json = { error: retryText };
      }

      const retryLimit = retryResponse.headers.get('X-RateLimit-Limit');
      const retryRemaining = retryResponse.headers.get('X-RateLimit-Remaining');
      const retryReset = retryResponse.headers.get('X-RateLimit-Reset');
      const retryBucket = retryResponse.headers.get('X-RateLimit-Bucket');

      if (retryLimit && retryRemaining !== null) {
        this.updateRateLimit('sxcu', retryBucket, parseInt(retryLimit), parseInt(retryRemaining), retryReset ? parseInt(retryReset) : undefined);
      }

      const responseHeaders = new Headers({ ...CORS_HEADERS, 'Content-Type': 'application/json' });
      const rateLimitHeaders = ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-RateLimit-Reset-After', 'X-RateLimit-Bucket'];
      for (const h of rateLimitHeaders) {
        const value = retryResponse.headers.get(h);
        if (value) responseHeaders.set(h, value);
      }

      return new Response(JSON.stringify(json), {
        headers: responseHeaders,
        status: retryResponse.ok ? 200 : retryResponse.status,
      });
    }

    const responseHeaders = new Headers({ ...CORS_HEADERS, 'Content-Type': 'application/json' });
    const rateLimitHeaders = ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-RateLimit-Reset-After', 'X-RateLimit-Bucket'];
    for (const h of rateLimitHeaders) {
      const value = response.headers.get(h);
      if (value) responseHeaders.set(h, value);
    }

    return new Response(JSON.stringify(json), {
      headers: responseHeaders,
      status: response.ok ? 200 : response.status,
    });
  }

  private async handleCatboxUpload(request: Request): Promise<Response> {
    const formData = await request.formData();
    const reqtype = formData.get('reqtype') as string;

    if (reqtype === 'fileupload') {
      const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: formData,
      });
      const text = await response.text();
      return new Response(text, { status: response.ok ? 200 : response.status });
    }

    if (reqtype === 'urlupload') {
      const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: formData,
      });
      const text = await response.text();
      return new Response(text, { status: response.ok ? 200 : response.status });
    }

    if (reqtype === 'createalbum') {
      const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: formData,
      });
      const text = await response.text();
      return new Response(text, { status: response.ok ? 200 : response.status });
    }

    return new Response('Unknown request type', { status: 400 });
  }
}
