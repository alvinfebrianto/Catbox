export type Provider = 'catbox' | 'sxcu' | 'imgchest';

export interface UploadResult {
  type: 'success' | 'error' | 'warning';
  url?: string;
  message?: string;
  isAlbum?: boolean;
  isCollection?: boolean;
  isPost?: boolean;
}

export interface RateLimitData {
  remaining: number;
  limit: number;
  reset?: number;
  windowStart: number;
}

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
  rateLimitExceeded?: boolean;
  rateLimitReset?: number;
  rateLimitResetAfter?: number;
}

export interface WorkerEnv {
  IMGCHEST_API_TOKEN?: string;
}

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export const ALLOWED_EXTENSIONS = [
  '.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp',
  '.tiff', '.tif', '.webm', '.webp'
];

export const MAX_IMGCHEST_IMAGES_PER_REQUEST = 20;
