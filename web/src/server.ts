import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { Readable } from 'stream';
import { pathToFileURL } from 'url';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, extname, sep } from 'path';
import {
  RateLimitHeaders,
  MAX_IMGCHEST_IMAGES_PER_REQUEST,
  validateKekFiles,
  getCorsHeaders,
} from './types';
import { KekProviderInputError, readKekUploadInput, uploadToKek } from './providers/kek';
import { FAIL_FAST_RATE_LIMIT_POLICY, RateLimitStore, executeRateLimited } from './rate-limit/engine';
import { FileRateLimitStore } from './rate-limit/file-store';
import { FetchLike } from './provider-protocol';
import { SxcuUploadInput, uploadToSxcu } from './providers/sxcu';
import { uploadToImgchest } from './providers/imgchest';
import { handleUploadRequest, type UploadEndpointDeps } from './upload-endpoint';

export interface HostDeps {
  fetch?: FetchLike;
  store?: RateLimitStore;
}

const PORT = 3000;
const TEMP_DIR = 'C:\\Users\\lenovo\\AppData\\Local\\Temp';
const RATE_LIMIT_FILE = `${TEMP_DIR}\\image_uploader_rate_limits.json`;
const PUBLIC_ROOT = resolve(process.cwd());
const ALLOWED_STATIC_EXTS = new Set(['.html', '.css', '.js', '.map', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; connect-src 'self' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; base-uri 'self'; frame-ancestors 'none'",
};

function safeStaticPath(urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }

  decoded = decoded.replaceAll('\\', '/');

  const requested = decoded === '/' ? '/index.html' : decoded;

  if (requested.includes('\0')) return null;

  const resolved = resolve(PUBLIC_ROOT, '.' + requested);

  if (!resolved.startsWith(PUBLIC_ROOT + sep)) return null;

  const ext = extname(resolved).toLowerCase();
  if (!ALLOWED_STATIC_EXTS.has(ext)) return null;

  return resolved;
}

function getImgchestToken(): string | null {
  return process.env.IMGCHEST_API_TOKEN || null;
}

function getKekKey(): string | null {
  return process.env.KEK_API_KEY || null;
}

function getBearerToken(req: Request): string | null {
  const raw = req.headers.get('Authorization');
  if (!raw) return null;

  const m = raw.match(/^Bearer\s+(.+)$/i);
  const token = (m ? m[1] : raw).trim();
  return token || null;
}

async function handleKekPost(req: Request, deps?: HostDeps): Promise<Response> {
  const headerApiKey = req.headers.get('X-Kek-Auth')?.trim() || undefined;

  let input;
  try {
    input = readKekUploadInput(await req.formData(), getKekKey() ?? undefined, headerApiKey);
  } catch (error) {
    const status = error instanceof KekProviderInputError ? 400 : 500;
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      headers: { 'Content-Type': 'application/json' },
      status,
    });
  }

  if (input.files && input.files.length > 0) {
    const files = input.files.filter((f): f is File => f instanceof File);
    const validation = validateKekFiles(files);
    if (!validation.ok) {
      return new Response(JSON.stringify({ error: validation.error }), {
        headers: { 'Content-Type': 'application/json' },
        status: 400,
      });
    }
  }

  try {
    const result = await uploadToKek(input, { fetch: deps?.fetch });

    return new Response(
      typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
      {
        headers: { 'Content-Type': 'application/json' },
        status: result.status >= 200 && result.status < 300 ? 200 : result.status,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleSxcuCollections(req: Request, deps?: HostDeps): Promise<Response> {
  const formData = await req.formData();

  const input: SxcuUploadInput = { type: 'collection', formData };
  const store = deps?.store ?? new FileRateLimitStore(RATE_LIMIT_FILE);

  const result = await executeRateLimited({
    provider: 'sxcu',
    policy: FAIL_FAST_RATE_LIMIT_POLICY,
    store,
    operation: () => uploadToSxcu(input, { fetch: deps?.fetch }),
  });

  if (result.type === 'error') {
    return new Response(JSON.stringify({ error: result.error }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }

  return new Response(JSON.stringify(result.providerResult.body), {
    headers: buildRateLimitHeaders(result.providerResult.rateLimitHeaders),
    status: result.providerResult.status,
  });
}

async function handleSxcuFiles(req: Request, deps?: HostDeps): Promise<Response> {
  const formData = await req.formData();

  const input: SxcuUploadInput = { type: 'file', formData };
  const store = deps?.store ?? new FileRateLimitStore(RATE_LIMIT_FILE);

  const result = await executeRateLimited({
    provider: 'sxcu',
    policy: FAIL_FAST_RATE_LIMIT_POLICY,
    store,
    operation: () => uploadToSxcu(input, { fetch: deps?.fetch }),
  });

  if (result.type === 'error') {
    return new Response(JSON.stringify({ error: result.error }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500,
    });
  }

  return new Response(JSON.stringify(result.providerResult.body), {
    headers: buildRateLimitHeaders(result.providerResult.rateLimitHeaders),
    status: result.providerResult.status,
  });
}

async function handleImgchestPost(req: Request, deps?: HostDeps): Promise<Response> {
  const token = getBearerToken(req) ?? getImgchestToken();
  if (!token) {
    return new Response(JSON.stringify({
      error: 'Imgchest API token not found. Provide a custom API key in the UI or set IMGCHEST_API_TOKEN environment variable in .env file'
    }), {
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

  const title = formData.get('title') as string | null;
  const privacy = formData.get('privacy') as string | null;
  const nsfwRaw = formData.get('nsfw') as string | null;

  if (privacy !== null && !['public', 'hidden', 'secret'].includes(privacy)) {
    return new Response(JSON.stringify({ error: 'Invalid privacy value. Must be public, hidden, or secret.' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    });
  }

  const store = deps?.store ?? new FileRateLimitStore(RATE_LIMIT_FILE);
  const result = await uploadToImgchest({
    images,
    token,
    title: title ?? undefined,
    privacy: privacy ?? undefined,
    nsfw: nsfwRaw !== null ? nsfwRaw === 'true' || nsfwRaw === '1' : undefined,
  }, { fetch: deps?.fetch, store });

  return new Response(JSON.stringify(result.body), {
    headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(result.rateLimitHeaders) },
    status: result.status,
  });
}

async function handleImgchestAdd(req: Request, deps?: HostDeps): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const postId = pathParts[4];

  const token = getBearerToken(req) ?? getImgchestToken();
  if (!token) {
    return new Response(JSON.stringify({ error: 'Imgchest API token not found. Provide a custom API key in the UI or set IMGCHEST_API_TOKEN environment variable.' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 401,
    });
  }

  const formData = await req.formData();
  const images = formData.getAll('images[]') as File[];
  const privacyRaw = formData.get('privacy') as string | null;
  const nsfwRaw = formData.get('nsfw') as string | null;
  const privacy = privacyRaw && privacyRaw.trim() !== '' ? privacyRaw.trim() : null;
  const nsfw = nsfwRaw && nsfwRaw.trim() !== '' ? nsfwRaw.trim() : null;

  if (privacy !== null && !['public', 'hidden', 'secret'].includes(privacy)) {
    return new Response(JSON.stringify({ error: 'Invalid privacy value. Must be public, hidden, or secret.' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    });
  }

  if (images.length === 0) {
    return new Response(JSON.stringify({ error: 'No images provided' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
    });
  }

  const store = deps?.store ?? new FileRateLimitStore(RATE_LIMIT_FILE);
  const result = await uploadToImgchest({
    images,
    token,
    existingPostId: postId,
    privacy: privacy ?? undefined,
    nsfw: nsfw !== null ? nsfw === 'true' || nsfw === '1' : undefined,
  }, { fetch: deps?.fetch, store });

  return new Response(JSON.stringify(result.body), {
    headers: { 'Content-Type': 'application/json', ...buildRateLimitHeaders(result.rateLimitHeaders) },
    status: result.status,
  });
}

function buildRateLimitHeaders(rlh: RateLimitHeaders | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (rlh?.limit !== undefined) headers['X-RateLimit-Limit'] = String(rlh.limit);
  if (rlh?.remaining !== undefined) headers['X-RateLimit-Remaining'] = String(rlh.remaining);
  if (rlh?.reset !== undefined) headers['X-RateLimit-Reset'] = String(rlh.reset);
  if (rlh?.resetAfter !== undefined) headers['X-RateLimit-Reset-After'] = String(rlh.resetAfter);
  if (rlh?.bucket !== undefined) headers['X-RateLimit-Bucket'] = rlh.bucket;
  if (rlh?.isGlobal) headers['X-RateLimit-Global'] = 'true';

  return headers;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method;
  const path = url.pathname;

  if (method === 'POST') {
    const deps: UploadEndpointDeps = {
      corsHeaders: getCorsHeaders(req.headers.get('Origin')),
      fetch: undefined,
    };
    const result = await handleUploadRequest(req, deps);
    if (result) return result;
  }

  if (method === 'POST' && path === '/upload/kek/posts') {
    return handleKekPost(req);
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

  const staticPath = safeStaticPath(path);
  if (staticPath && existsSync(staticPath)) {
    const data = readFileSync(staticPath);
    const ext = extname(staticPath).slice(1).toLowerCase();
    const contentTypes: Record<string, string> = {
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      ico: 'image/x-icon',
    };
    return new Response(data, {
      headers: {
        'Content-Type': contentTypes[ext] || 'text/plain',
        ...SECURITY_HEADERS,
      },
    });
  }
  return new Response('Not Found', { status: 404 });
}

function toWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? `localhost:${PORT}`;
  const url = `http://${host}${req.url ?? '/'}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';

  return new Request(url, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);
}

async function sendWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (webRes.body) {
    const nodeStream = Readable.fromWeb(webRes.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
    await new Promise<void>((resolveStream, rejectStream) => {
      nodeStream.on('error', rejectStream);
      res.on('finish', () => resolveStream());
      res.on('error', rejectStream);
      nodeStream.pipe(res);
    });
  } else {
    res.end();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMain) {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const request = toWebRequest(req);
        const response = await handleRequest(request);
        await sendWebResponse(res, response);
      } catch (err) {
        console.error(err);
        if (!res.headersSent) res.statusCode = 500;
        if (!res.writableEnded) res.end('Internal Server Error');
      }
    })();
  });

  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

export {
  getImgchestToken,
  getKekKey,
  handleKekPost,
  handleSxcuCollections,
  handleSxcuFiles,
  handleImgchestPost,
  handleImgchestAdd,
  MAX_IMGCHEST_IMAGES_PER_REQUEST,
};
