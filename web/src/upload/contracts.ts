import { UploadResult } from '../types';

export type UploadHeaders = Record<string, string>;

export interface UploadObserver {
  onResult(result: UploadResult, index: number): void;
  onProgress(percent: number, label: string): void;
  /** 0 means the wait has resumed and the rate-limit notice should be removed. */
  onRateLimitWait(secondsRemaining: number): void;
}

interface UploadInputBase {
  apiBaseUrl: string;
  files: File[];
  urls: string[];
  authHeaders?: UploadHeaders;
}

export interface CatboxUploadInput extends UploadInputBase {
  title: string;
  description: string;
  createAlbum: boolean;
}

export interface KekUploadInput extends UploadInputBase {
  apiKey?: string;
  mature: boolean;
}

export interface SxcuUploadInput extends UploadInputBase {
  title: string;
  description: string;
  createCollection: boolean;
  private: boolean;
}

export interface ImgchestUploadInput extends UploadInputBase {
  title: string;
  postId: string;
  anonymous: boolean;
  privacy: string;
  nsfw: boolean;
  apiToken?: string;
}
