import { RateLimitHeaders } from './types';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ProviderResult {
  status: number;
  body: JsonValue;
  rateLimitHeaders?: RateLimitHeaders;
}

export function getDefaultFetch(): FetchLike {
  return globalThis.fetch.bind(globalThis);
}
