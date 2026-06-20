import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { Readable } from 'stream';
import { pathToFileURL } from 'url';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, extname, sep } from 'path';
import { getCorsHeaders } from './types';
import { RateLimitStore } from './rate-limit/engine';
import { FileRateLimitStore } from './rate-limit/file-store';
import { FetchLike } from './provider-protocol';
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

async function handleRequest(req: Request, hostDeps: HostDeps = {}): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method;
  const path = url.pathname;

  if (method === 'POST') {
    const deps: UploadEndpointDeps = {
      corsHeaders: getCorsHeaders(req.headers.get('Origin')),
      fetch: hostDeps.fetch,
      store: hostDeps.store ?? new FileRateLimitStore(RATE_LIMIT_FILE),
      secrets: {
        kekApiKey: getKekKey() ?? undefined,
        imgchestToken: getBearerToken(req) ?? getImgchestToken() ?? undefined,
      },
    };
    const result = await handleUploadRequest(req, deps);
    if (result) return result;
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
  handleRequest,
};
