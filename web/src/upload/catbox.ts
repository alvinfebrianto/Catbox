import { UploadResult } from '../types';
import { CatboxUploadInput, UploadObserver } from './contracts';

/**
 * DOM-free catbox upload sequencer. Owns the canonical results array, drives
 * file + URL upload sequencing, optional album creation, and emits observer
 * events (`onResult` per increment, `onProgress` for the bar, `onDone` at the
 * end). `fetchFn` is injected so tests can stub it.
 */
export function uploadToCatbox(
  input: CatboxUploadInput,
  observer: UploadObserver,
  fetchFn: typeof fetch,
): void {
  const { apiBaseUrl, files, urls, authHeaders, title, description } = input;
  const proxyUrl = apiBaseUrl + '/upload/catbox';
  const headers = authHeaders ?? {};
  const shouldCreateAlbum = input.createAlbum;

  const results: UploadResult[] = [];
  const totalItems = files.length + urls.length;
  let completedItems = 0;

  const uploadFile = (file: File, callback: () => void): void => {
    observer.onProgress((completedItems / totalItems) * 100, 'Uploading ' + file.name + '...');

    const formData = new FormData();
    formData.append('reqtype', 'fileupload');
    formData.append('fileToUpload', file);

    fetchFn(proxyUrl, { method: 'POST', body: formData, headers })
      .then(response => {
        if (!response.ok) throw new Error('Upload failed: ' + response.statusText);
        return response.text();
      })
      .then(url => {
        const result: UploadResult = { type: 'success', url: url.trim() };
        results.push(result);
        observer.onResult(result, results.length - 1);
        completedItems++;
        callback();
      })
      .catch(error => {
        const result: UploadResult = { type: 'error', message: 'Failed to upload ' + file.name + ': ' + error.message };
        results.push(result);
        observer.onResult(result, results.length - 1);
        completedItems++;
        callback();
      });
  };

  const uploadUrl = (url: string, callback: () => void): void => {
    observer.onProgress(((files.length + completedItems) / totalItems) * 100, 'Uploading ' + url + '...');

    const formData = new FormData();
    formData.append('reqtype', 'urlupload');
    formData.append('url', url);

    fetchFn(proxyUrl, { method: 'POST', body: formData, headers })
      .then(response => {
        if (!response.ok) throw new Error('URL upload failed: ' + response.statusText);
        return response.text();
      })
      .then(uploadedUrl => {
        const result: UploadResult = { type: 'success', url: uploadedUrl.trim() };
        results.push(result);
        observer.onResult(result, results.length - 1);
        completedItems++;
        callback();
      })
      .catch(error => {
        const result: UploadResult = { type: 'error', message: 'Failed to upload ' + url + ': ' + error.message };
        results.push(result);
        observer.onResult(result, results.length - 1);
        completedItems++;
        callback();
      });
  };

  const finish = (): void => {
    observer.onProgress(100, 'Done!');
    observer.onDone(results);
  };

  const createAlbum = (): void => {
    observer.onProgress(95, 'Creating album...');

    const uploadedUrls = results.filter(r => r.type === 'success').map(r => r.url!);

    if (uploadedUrls.length > 0) {
      const fileNames = uploadedUrls.map(url => {
        try {
          const uri = new URL(url);
          return uri.pathname.split('/').pop() || url;
        } catch {
          return url;
        }
      });

      const albumFormData = new FormData();
      albumFormData.append('reqtype', 'createalbum');
      albumFormData.append('title', title);
      albumFormData.append('desc', description);
      albumFormData.append('files', fileNames.join(' '));

      fetchFn(proxyUrl, { method: 'POST', body: albumFormData, headers })
        .then(response => {
          if (response.ok) return response.text();
          throw new Error('Album creation failed');
        })
        .then(albumCode => {
          const albumUrl = albumCode.indexOf('http') === 0 ? albumCode : 'https://catbox.moe/album/' + albumCode;
          const albumResult: UploadResult = { type: 'success', url: albumUrl, isAlbum: true };
          results.push(albumResult);
          observer.onResult(albumResult, results.length - 1);
          finish();
        })
        .catch(error => {
          const errorResult: UploadResult = { type: 'error', message: 'Failed to create album: ' + error.message };
          results.push(errorResult);
          observer.onResult(errorResult, results.length - 1);
          finish();
        });
    } else {
      finish();
    }
  };

  const processNext = (): void => {
    if (completedItems >= files.length + urls.length) {
      if (shouldCreateAlbum) {
        createAlbum();
      } else {
        finish();
      }
      return;
    }

    if (completedItems < files.length) {
      uploadFile(files[completedItems], processNext);
    } else {
      uploadUrl(urls[completedItems - files.length], processNext);
    }
  };

  processNext();
}
