import { UploadResult, parseRateLimitHeaders } from '../types';
import { SxcuUploadInput, UploadObserver } from './contracts';

interface SxcuRateLimitState {
  limit: number;
  remaining: number;
  reset: number;
  bucket: string | null;
}

interface SxcuFileResponse {
  url?: string;
  error?: { message?: string } | string;
  message?: string;
  rateLimitReset?: string | number;
  rateLimitResetAfter?: string | number;
}

interface SxcuCollectionResponse {
  collection_id?: string;
  id?: string;
  collection_token?: string;
  token?: string;
}

const SXCU_HEADERS = { 'User-Agent': 'sxcuUploader/1.0' };

export function uploadToSxcu(
  input: SxcuUploadInput,
  observer: UploadObserver,
  fetchFn: typeof fetch,
): Promise<UploadResult[]> {
  return new Promise<UploadResult[]>((resolve, reject) => {
  const results: UploadResult[] = [];
  const totalFiles = input.files.length;
  let collectionId = '';
  let collectionToken = '';
  let completedFiles = 0;
  let filesToUpload = [...Array(totalFiles).keys()];

  const rateLimitState: SxcuRateLimitState = {
    limit: 5,
    remaining: 5,
    reset: 0,
    bucket: null,
  };

  const headers = (): Record<string, string> => ({ ...input.authHeaders, ...SXCU_HEADERS });

  const applyRateLimitHeaders = (responseHeaders: Headers): void => {
    const newRateLimit = parseRateLimitHeaders(responseHeaders);
    rateLimitState.limit = newRateLimit.limit ?? 5;
    rateLimitState.remaining = newRateLimit.remaining ?? 0;
    if (newRateLimit.reset !== undefined && newRateLimit.reset > 0) rateLimitState.reset = newRateLimit.reset;
    if (newRateLimit.resetAfter !== undefined && newRateLimit.resetAfter > 0) {
      rateLimitState.reset = Math.floor(Date.now() / 1000) + newRateLimit.resetAfter;
    }
    if (newRateLimit.bucket) rateLimitState.bucket = newRateLimit.bucket;
  };

  const getWaitSeconds = (): number => {
    if (rateLimitState.reset <= 0) return 60;
    const now = Math.floor(Date.now() / 1000);
    const wait = rateLimitState.reset - now + 1;
    return wait > 0 ? wait : 1;
  };

  const finish = (): void => {
    observer.onProgress(100, 'Done!');
    observer.onDone(results);
    resolve(results);
  };

  const delay = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms));

  const waitForRateLimit = async (): Promise<void> => {
    let waitSeconds = getWaitSeconds();

    while (waitSeconds > 0) {
      const msg = 'Rate limited. Waiting ' + waitSeconds + 's...';
      observer.onProgress((completedFiles / totalFiles) * 100, msg);
      observer.onRateLimitWait(waitSeconds);
      waitSeconds--;
      await delay(1000);
    }

    observer.onRateLimitWait(0);
  };

  const uploadFile = async (fileIndex: number): Promise<'success' | 'rate-limited' | 'error'> => {
    const file = input.files[fileIndex];
    observer.onProgress((completedFiles / totalFiles) * 100, 'Uploading ' + file.name + '...');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('noembed', 'true');

    if (collectionId) formData.append('collection', collectionId);
    if (collectionToken) formData.append('collection_token', collectionToken);

    try {
      const response = await fetchFn(input.apiBaseUrl + '/upload/sxcu/files', {
        method: 'POST',
        body: formData,
        headers: headers(),
      });

      applyRateLimitHeaders(response.headers);

      const data = await response.json() as SxcuFileResponse;
      if (response.status === 429) {
        if (data.rateLimitReset !== undefined) {
          rateLimitState.reset = parseInt(String(data.rateLimitReset), 10);
        } else if (data.rateLimitResetAfter !== undefined) {
          rateLimitState.reset = Math.floor(Date.now() / 1000) + parseFloat(String(data.rateLimitResetAfter));
        }
        return 'rate-limited';
      }

      if (!response.ok) {
        let msg: unknown = data.message || (typeof data.error === 'object' ? data.error?.message : data.error) || response.statusText;
        if (typeof msg === 'object') msg = JSON.stringify(msg);
        throw new Error('Upload failed: ' + msg);
      }

      const result: UploadResult = { type: 'success', url: data.url };
      results.push(result);
      completedFiles++;
      observer.onResult(result, results.length - 1);
      return 'success';
    } catch (error) {
      const message = (error as Error).message;
      if (message.includes('Rate limit') || message.includes('429') || message.includes('Too Many Requests')) {
        return 'rate-limited';
      }
      return 'error';
    }
  };

  const processNextBurst = async (): Promise<void> => {
    if (filesToUpload.length === 0) {
      finish();
      return;
    }

    let burstSize = Math.min(4, filesToUpload.length);
    const currentRemaining = rateLimitState.remaining;

    if (currentRemaining < burstSize && currentRemaining > 0) {
      burstSize = currentRemaining;
    }

    const indicesToUpload = filesToUpload.slice(0, burstSize);
    let rateLimited = false;
    let uploadedCount = 0;
    let burstProcessedCount = 0;

    observer.onProgress(
      (completedFiles / totalFiles) * 100,
      'Uploading ' + (completedFiles + 1) + '-' + (completedFiles + indicesToUpload.length) + ' of ' + totalFiles + '...',
    );

    for (let idx = 0; idx < indicesToUpload.length; idx++) {
      const fileIndex = indicesToUpload[idx];
      const file = input.files[fileIndex];
      observer.onProgress(((completedFiles + idx) / totalFiles) * 100, 'Uploading ' + file.name + '...');

      const result = await uploadFile(fileIndex);
      if (result === 'success') {
        uploadedCount++;
        burstProcessedCount = idx + 1;
        const lastResult = results[results.length - 1];
        observer.onProgress(
          ((completedFiles + uploadedCount + (indicesToUpload.length - idx - 1)) / totalFiles) * 100,
          'Uploaded: ' + lastResult?.url,
        );
      } else if (result === 'rate-limited') {
        rateLimited = true;
        break;
      } else {
        burstProcessedCount = idx + 1;
      }
    }

    if (rateLimited) {
      if (burstProcessedCount > 0) {
        filesToUpload = filesToUpload.slice(burstProcessedCount);
      }
      await waitForRateLimit();
      await processNextBurst();
      return;
    }

    filesToUpload = filesToUpload.slice(burstSize);
    if (filesToUpload.length > 0) {
      await delay(200);
      await processNextBurst();
    } else {
      finish();
    }
  };

  const createCollection = async (): Promise<void> => {
    observer.onProgress(0, 'Creating collection...');

    const formData = new FormData();
    formData.append('title', input.title || 'Untitled');
    formData.append('desc', input.description);
    formData.append('private', input.private ? 'true' : 'false');
    formData.append('unlisted', 'false');

    try {
      const response = await fetchFn(input.apiBaseUrl + '/upload/sxcu/collections', {
        method: 'POST',
        body: formData,
        headers: headers(),
      });
      if (!response.ok) throw new Error('Collection creation failed: ' + response.statusText);

      const data = await response.json() as SxcuCollectionResponse;
      collectionId = data.collection_id || data.id || '';
      collectionToken = data.collection_token || data.token || '';

      if (!collectionId && !collectionToken) {
        throw new Error('Invalid collection response. Keys: ' + Object.keys(data).join(', '));
      }

      const collectionResult: UploadResult = { type: 'success', url: 'https://sxcu.net/c/' + collectionId, isCollection: true };
      results.push(collectionResult);
      observer.onResult(collectionResult, results.length - 1);
      observer.onProgress(0, 'Collection created. Starting uploads...');
      await processNextBurst();
    } catch (error) {
      const result: UploadResult = { type: 'error', message: 'Failed to create collection: ' + (error as Error).message };
      results.push(result);
      observer.onResult(result, results.length - 1);
      finish();
    }
  };

  if (input.createCollection) {
    createCollection().catch(reject);
  } else {
    processNextBurst().catch(reject);
  }
  });
}
