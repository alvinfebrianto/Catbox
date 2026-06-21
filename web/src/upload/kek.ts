import { UploadResult, validateKekFiles } from '../types';
import { KekUploadInput, UploadObserver } from './contracts';

export function uploadToKek(
  input: KekUploadInput,
  observer: UploadObserver,
  fetchFn: typeof fetch,
): Promise<UploadResult[]> {
  return new Promise<UploadResult[]>((resolve, reject) => {
  try {
  const { apiBaseUrl, files, urls, authHeaders, apiKey, mature } = input;
  const proxyUrl = apiBaseUrl + '/upload/kek/posts';
  const headers: Record<string, string> = { ...authHeaders };
  if (apiKey) {
    headers['X-Kek-Auth'] = apiKey;
  }

  if (files.length > 0) {
    const validation = validateKekFiles(files);
    if (!validation.ok) {
      const result: UploadResult = { type: 'error', message: validation.error || 'Invalid files' };
      observer.onResult(result, 0);
      resolve([result]);
      return;
    }
  }

  type QueueItem = { type: 'file'; file: File } | { type: 'url'; url: string };
  const queue: QueueItem[] = [
    ...files.map(f => ({ type: 'file' as const, file: f })),
    ...urls.map(u => ({ type: 'url' as const, url: u })),
  ];

  if (queue.length === 0) {
    resolve([]);
    return;
  }

  const results: UploadResult[] = [];
  const totalItems = queue.length;

  const processNext = (index: number): void => {
    if (index >= queue.length) {
      observer.onProgress(100, 'Done!');
      resolve(results);
      return;
    }

    const item = queue[index];
    const label = item.type === 'file' ? item.file.name : item.url;
    observer.onProgress((index / totalItems) * 100, 'Uploading ' + label + '...');

    const formData = new FormData();
    if (item.type === 'file') {
      formData.append('file', item.file);
    } else {
      formData.append('url', item.url);
    }
    formData.append('mature', mature ? 'true' : 'false');

    fetchFn(proxyUrl, { method: 'POST', body: formData, headers })
      .then(response => response.text())
      .then(text => {
        let data: { filename?: string; error?: string };
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error('Unexpected response: ' + text.substring(0, 200));
        }

        if (data.error || !data.filename) {
          throw new Error(data.error || 'Upload failed');
        }

        const result: UploadResult = { type: 'success', url: 'https://i.kek.sh/' + data.filename };
        results.push(result);
        observer.onResult(result, results.length - 1);
        observer.onProgress((results.length / totalItems) * 100, 'Uploaded ' + results.length + ' of ' + totalItems);
        processNext(index + 1);
      })
      .catch(error => {
        const errMsg = item.type === 'file'
          ? 'Failed to upload ' + item.file.name + ': ' + error.message
          : 'Failed to upload URL ' + item.url + ': ' + error.message;
        const result: UploadResult = { type: 'error', message: errMsg };
        results.push(result);
        observer.onResult(result, results.length - 1);
        processNext(index + 1);
      });
  };

  processNext(0);
  } catch (error) {
    reject(error);
  }
  });
}
