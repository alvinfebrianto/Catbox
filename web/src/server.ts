import { serve } from 'bun';
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { RateLimitData, MAX_IMGCHEST_IMAGES_PER_REQUEST } from './types';

const PORT = 3000;
const TEMP_DIR = 'C:\\Users\\lenovo\\AppData\\Local\\Temp';

if (import.meta.main) {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }
}

function getImgchestToken(): string | null {
  return process.env.IMGCHEST_API_TOKEN || null;
}

function getRateLimitFile(provider: string): string {
  return `${TEMP_DIR}\\image_uploader_${provider}_rate_limit.json`;
}

function getRateLimit(provider: string): RateLimitData | null {
  const file = getRateLimitFile(provider);
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}

function setRateLimit(provider: string, data: RateLimitData): void {
  writeFileSync(getRateLimitFile(provider), JSON.stringify(data));
}

function clearRateLimit(provider: string): void {
  const file = getRateLimitFile(provider);
  if (existsSync(file)) {
    unlinkSync(file);
  }
}

async function handleCatboxUpload(req: Request): Promise<Response> {
  const formData = await req.formData();
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

async function handleSxcuCollections(req: Request): Promise<Response> {
  await waitForRateLimitAsync('sxcu', 1);

  const formData = await req.formData();
  const response = await fetch('https://sxcu.net/api/collections/create', {
    method: 'POST',
    body: formData,
    headers: { 'User-Agent': 'sxcuUploader/1.0' },
  });

  const json = await response.json();

  const limit = response.headers.get('X-RateLimit-Limit');
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');

  if (limit && remaining !== null) {
    setRateLimit('sxcu', {
      remaining: parseInt(remaining),
      limit: parseInt(limit),
      reset: reset ? parseInt(reset) : Math.floor(Date.now() / 1000) + 60,
      windowStart: Math.floor(Date.now() / 1000),
    });
  }

  if (response.status === 429) {
    const resetAfter = response.headers.get('X-RateLimit-Reset-After');
    const waitSeconds = resetAfter ? parseFloat(resetAfter) + 1 : 61;

    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

    clearRateLimit('sxcu');

    const retryResponse = await fetch('https://sxcu.net/api/collections/create', {
      method: 'POST',
      body: formData,
      headers: { 'User-Agent': 'sxcuUploader/1.0' },
    });

    const retryJson = await retryResponse.json();

    const retryLimit = retryResponse.headers.get('X-RateLimit-Limit');
    const retryRemaining = retryResponse.headers.get('X-RateLimit-Remaining');
    const retryReset = retryResponse.headers.get('X-RateLimit-Reset');

    if (retryLimit && retryRemaining !== null) {
      setRateLimit('sxcu', {
        remaining: parseInt(retryRemaining),
        limit: parseInt(retryLimit),
        reset: retryReset ? parseInt(retryReset) : Math.floor(Date.now() / 1000) + 60,
        windowStart: Math.floor(Date.now() / 1000),
      });
    }

    return new Response(JSON.stringify(retryJson), {
      headers: { 'Content-Type': 'application/json' },
      status: retryResponse.ok ? 200 : retryResponse.status,
    });
  }

  return new Response(JSON.stringify(json), {
    headers: { 'Content-Type': 'application/json' },
    status: response.ok ? 200 : response.status,
  });
}

async function handleSxcuFiles(req: Request): Promise<Response> {
  await waitForRateLimitAsync('sxcu', 1);

  const formData = await req.formData();

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

  const limit = response.headers.get('X-RateLimit-Limit');
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const reset = response.headers.get('X-RateLimit-Reset');

  if (limit && remaining !== null) {
    setRateLimit('sxcu', {
      remaining: parseInt(remaining),
      limit: parseInt(limit),
      reset: reset ? parseInt(reset) : Math.floor(Date.now() / 1000) + 60,
      windowStart: Math.floor(Date.now() / 1000),
    });
  }

  if (response.status === 429) {
    const resetAfter = response.headers.get('X-RateLimit-Reset-After');
    const waitSeconds = resetAfter ? parseFloat(resetAfter) + 1 : 61;

    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

    clearRateLimit('sxcu');

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

    if (retryLimit && retryRemaining !== null) {
      setRateLimit('sxcu', {
        remaining: parseInt(retryRemaining),
        limit: parseInt(retryLimit),
        reset: retryReset ? parseInt(retryReset) : Math.floor(Date.now() / 1000) + 60,
        windowStart: Math.floor(Date.now() / 1000),
      });
    }

    return new Response(JSON.stringify(json), {
      headers: { 'Content-Type': 'application/json' },
      status: retryResponse.ok ? 200 : retryResponse.status,
    });
  }

  return new Response(JSON.stringify(json), {
    headers: { 'Content-Type': 'application/json' },
    status: response.ok ? 200 : response.status,
  });
}

async function handleImgchestPost(req: Request): Promise<Response> {
  await waitForRateLimitAsync('imgchest', 1);

  const token = getImgchestToken();
  if (!token) {
    return new Response(JSON.stringify({ error: 'Imgchest API token not found. Set IMGCHEST_API_TOKEN environment variable in .env file' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 401,
    });
  }

  const formData = await req.formData();
  const images = formData.getAll('images[]') as File[];

  if (images.length === 0) {
    return new Response(JSON.stringify({ error: 'No images provided' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    });
  }

  const otherEntries: [string, FormDataEntryValue][] = [];
  for (const [key, value] of formData.entries()) {
    if (key !== 'images[]') {
      otherEntries.push([key, value]);
    }
  }

  const chunks: File[][] = [];
  for (let i = 0; i < images.length; i += MAX_IMGCHEST_IMAGES_PER_REQUEST) {
    chunks.push(images.slice(i, i + MAX_IMGCHEST_IMAGES_PER_REQUEST));
  }

  let finalResult: Record<string, unknown> | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isFirstChunk = i === 0;
    const url = isFirstChunk
      ? 'https://api.imgchest.com/v1/post'
      : `https://api.imgchest.com/v1/post/${(finalResult as { data: { id: string } }).data.id}/add`;

    await waitForRateLimitAsync('imgchest', 1);

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
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    try {
      const json = JSON.parse(text);
      const remaining = response.headers.get('x-ratelimit-remaining');
      const limit = response.headers.get('x-ratelimit-limit');

      if (remaining && limit) {
        setRateLimit('imgchest', {
          remaining: parseInt(remaining),
          limit: parseInt(limit),
          windowStart: Math.floor(Date.now() / 1000),
        });
      }

      if (!response.ok) {
        return new Response(JSON.stringify({ error: 'Imgchest API error', status: response.status, details: json, raw: text.substring(0, 500), chunk: i + 1 }), {
          headers: { 'Content-Type': 'application/json' },
          status: response.status,
        });
      }

      finalResult = json;
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to parse JSON', raw: text.substring(0, 200), chunk: i + 1 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      });
    }
  }

  return new Response(JSON.stringify(finalResult), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

async function handleImgchestAdd(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const postId = pathParts[4];

  await waitForRateLimitAsync('imgchest', 1);

  const token = getImgchestToken();
  if (!token) {
    return new Response(JSON.stringify({ error: 'Imgchest API token not found' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 401,
    });
  }

  const formData = await req.formData();
  const images = formData.getAll('images[]') as File[];

  if (images.length === 0) {
    return new Response(JSON.stringify({ error: 'No images provided' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    });
  }

  const chunks: File[][] = [];
  for (let i = 0; i < images.length; i += MAX_IMGCHEST_IMAGES_PER_REQUEST) {
    chunks.push(images.slice(i, i + MAX_IMGCHEST_IMAGES_PER_REQUEST));
  }

  let finalResult: Record<string, unknown> | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    await waitForRateLimitAsync('imgchest', 1);

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
        headers: { 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    try {
      const json = JSON.parse(text);
      const remaining = response.headers.get('x-ratelimit-remaining');
      const limit = response.headers.get('x-ratelimit-limit');

      if (remaining && limit) {
        setRateLimit('imgchest', {
          remaining: parseInt(remaining),
          limit: parseInt(limit),
          windowStart: Math.floor(Date.now() / 1000),
        });
      }

      if (!response.ok) {
        return new Response(JSON.stringify({ error: 'Imgchest API error', status: response.status, details: json, raw: text.substring(0, 500), chunk: i + 1 }), {
          headers: { 'Content-Type': 'application/json' },
          status: response.status,
        });
      }

      finalResult = json;
    } catch {
      return new Response(JSON.stringify({ error: 'Failed to parse JSON', raw: text.substring(0, 200), chunk: i + 1 }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      });
    }
  }

  return new Response(JSON.stringify(finalResult), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

async function waitForRateLimitAsync(provider: string, cost = 1): Promise<void> {
  const file = getRateLimitFile(provider);
  const now = Math.floor(Date.now() / 1000);

  if (existsSync(file)) {
    try {
      const data: RateLimitData = JSON.parse(readFileSync(file, 'utf-8'));

      const windowElapsed = now - data.windowStart;
      if (windowElapsed >= 60) {
        clearRateLimit(provider);
        return;
      }

      if ((data.remaining - cost) < 0) {
        const waitSeconds = Math.max(60 - windowElapsed + 1, 1);
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
        clearRateLimit(provider);
      }
    } catch (e) {
      console.error('Rate limit check failed:', e);
    }
  }
}

if (import.meta.main) {
  const server = serve({
    port: PORT,

    fetch(req: Request): Response | Promise<Response> {
      const url = new URL(req.url);
      const method = req.method;
      const path = url.pathname;

      if (method === 'POST' && path === '/upload/catbox') {
        return handleCatboxUpload(req);
      }

      if (method === 'POST' && path === '/upload/sxcu/collections') {
        return handleSxcuCollections(req);
      }

      if (method === 'POST' && path === '/upload/sxcu/files') {
        return handleSxcuFiles(req);
      }

      if (method === 'POST' && path === '/upload/imgchest/post') {
        return handleImgchestPost(req);
      }

      if (method === 'POST' && path.startsWith('/upload/imgchest/post/') && path.endsWith('/add')) {
        return handleImgchestAdd(req);
      }

      const filePath = path === '/' ? './index.html' : '.' + path;
      if (existsSync(filePath)) {
        const file = Bun.file(filePath);
        const ext = filePath.split('.').pop() || '';
        const contentTypes: Record<string, string> = {
          html: 'text/html',
          css: 'text/css',
          js: 'application/javascript',
        };
        return new Response(file, {
          headers: { 'Content-Type': contentTypes[ext] || 'text/plain' },
        });
      }
      return new Response('Not Found', { status: 404 });
    },
  });

  console.log(`Server running at http://localhost:${PORT}`);
}

export {
  getImgchestToken,
  getRateLimitFile,
  getRateLimit,
  setRateLimit,
  clearRateLimit,
  waitForRateLimitAsync,
  handleCatboxUpload,
  handleSxcuCollections,
  handleSxcuFiles,
  handleImgchestPost,
  handleImgchestAdd,
  MAX_IMGCHEST_IMAGES_PER_REQUEST,
};
