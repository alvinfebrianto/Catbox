import { UploadResult, validateImgchestFiles } from '../types';
import { ImgchestUploadInput, UploadObserver } from './contracts';

export function uploadToImgchest(
  input: ImgchestUploadInput,
  observer: UploadObserver,
  fetchFn: typeof fetch,
): void {
  const { apiBaseUrl, files, urls, authHeaders, title, postId, anonymous, privacy, nsfw, apiToken } = input;
  const headers: Record<string, string> = { ...authHeaders };
  if (apiToken) {
    headers['Authorization'] = 'Bearer ' + apiToken;
  }

  if (files.length > 0) {
    const validation = validateImgchestFiles(files);
    if (!validation.ok) {
      const result: UploadResult = { type: 'error', message: validation.error || 'Invalid files' };
      observer.onResult(result, 0);
      observer.onDone([result]);
      return;
    }
  }

  let filesToUpload = files.slice();
  if (anonymous) {
    filesToUpload = filesToUpload.slice(0, 20);
  }

  if (filesToUpload.length === 0) {
    observer.onDone([]);
    return;
  }

  if (anonymous) {
    uploadBatch(apiBaseUrl, filesToUpload, headers, title, privacy, nsfw, observer, fetchFn);
  } else if (postId) {
    uploadProgressiveAddToPost(apiBaseUrl, postId, filesToUpload, headers, privacy, nsfw, observer, fetchFn);
  } else {
    uploadProgressive(apiBaseUrl, filesToUpload, headers, title, privacy, nsfw, observer, fetchFn);
  }
}

function uploadBatch(
  apiBaseUrl: string,
  files: File[],
  headers: Record<string, string>,
  title: string,
  privacy: string,
  nsfw: boolean,
  observer: UploadObserver,
  fetchFn: typeof fetch,
): void {
  const results: UploadResult[] = [];
  observer.onProgress(0, 'Creating post...');

  const formData = new FormData();
  if (title) formData.append('title', title);
  formData.append('privacy', privacy);
  formData.append('nsfw', nsfw ? 'true' : 'false');
  formData.append('anonymous', '1');

  for (const file of files) {
    formData.append('images[]', file);
  }

  const url = apiBaseUrl + '/upload/imgchest/post';

  fetchFn(url, { method: 'POST', body: formData, headers })
    .then(response => response.text())
    .then(text => {
      try {
        const data = JSON.parse(text);
        if (data.error) {
          let errorMsg = data.error;
          if (data.details) {
            errorMsg += ': ' + (typeof data.details === 'object' ? JSON.stringify(data.details) : data.details);
          }
          throw new Error(errorMsg);
        }

        const postResult: UploadResult = { type: 'success', url: 'https://imgchest.com/p/' + data.data.id, isPost: true };
        results.push(postResult);
        observer.onResult(postResult, results.length - 1);

        for (const img of data.data.images) {
          const imgResult: UploadResult = { type: 'success', url: img.link };
          results.push(imgResult);
          observer.onResult(imgResult, results.length - 1);
        }

        observer.onProgress(100, 'Done!');
        observer.onDone(results);
      } catch (e) {
        const result: UploadResult = { type: 'error', message: 'Failed to upload: ' + (e as Error).message };
        results.push(result);
        observer.onResult(result, results.length - 1);
        observer.onProgress(100, 'Done!');
        observer.onDone(results);
      }
    })
    .catch(error => {
      const result: UploadResult = { type: 'error', message: 'Failed to upload: ' + error.message };
      results.push(result);
      observer.onResult(result, results.length - 1);
      observer.onProgress(100, 'Done!');
      observer.onDone(results);
    });
}

function uploadProgressiveAddToPost(
  apiBaseUrl: string,
  postId: string,
  files: File[],
  headers: Record<string, string>,
  privacy: string,
  nsfw: boolean,
  observer: UploadObserver,
  fetchFn: typeof fetch,
): void {
  const results: UploadResult[] = [];
  const totalItems = files.length;
  let completedFiles = 0;
  let postResultAdded = false;

  const uploadNextFile = (index: number): void => {
    if (index >= files.length) {
      observer.onProgress(100, 'Done!');
      observer.onDone(results);
      return;
    }

    const file = files[index];
    const isLastFile = index === files.length - 1;
    observer.onProgress((index / totalItems) * 100, 'Adding ' + file.name + ' to post...');

    const formData = new FormData();
    formData.append('images[]', file);
    if (isLastFile) {
      formData.append('privacy', privacy);
      formData.append('nsfw', nsfw ? 'true' : 'false');
    }

    const url = apiBaseUrl + '/upload/imgchest/post/' + postId + '/add';

    fetchFn(url, { method: 'POST', body: formData, headers })
      .then(response => response.text())
      .then(text => {
        try {
          const data = JSON.parse(text);
          if (data.error) {
            let errorMsg = data.error;
            if (data.details) {
              errorMsg += ': ' + (typeof data.details === 'object' ? JSON.stringify(data.details) : data.details);
            }
            throw new Error(errorMsg);
          }

          if (!postResultAdded) {
            const postResult: UploadResult = { type: 'success', url: 'https://imgchest.com/p/' + data.data.id, isPost: true };
            results.push(postResult);
            observer.onResult(postResult, results.length - 1);
            postResultAdded = true;
          }

          const existingCount = data.data.image_count - 1;
          const newImages = data.data.images.slice(existingCount);
          for (const img of newImages) {
            const imgResult: UploadResult = { type: 'success', url: img.link };
            results.push(imgResult);
            observer.onResult(imgResult, results.length - 1);
          }

          completedFiles++;
          observer.onProgress((completedFiles / totalItems) * 100, 'Added ' + completedFiles + ' of ' + totalItems);
          uploadNextFile(index + 1);
        } catch (e) {
          const errResult: UploadResult = { type: 'error', message: 'Failed to add ' + file.name + ': ' + (e as Error).message };
          results.push(errResult);
          observer.onResult(errResult, results.length - 1);
          completedFiles++;
          observer.onProgress((completedFiles / totalItems) * 100, 'Added ' + completedFiles + ' of ' + totalItems);
          uploadNextFile(index + 1);
        }
      })
      .catch(error => {
        const errResult: UploadResult = { type: 'error', message: 'Failed to add ' + file.name + ': ' + error.message };
        results.push(errResult);
        observer.onResult(errResult, results.length - 1);
        completedFiles++;
        uploadNextFile(index + 1);
      });
  };

  uploadNextFile(0);
}

function uploadProgressive(
  apiBaseUrl: string,
  files: File[],
  headers: Record<string, string>,
  title: string,
  privacy: string,
  nsfw: boolean,
  observer: UploadObserver,
  fetchFn: typeof fetch,
): void {
  const results: UploadResult[] = [];
  const totalItems = files.length;
  let currentPostId: string | null = null;
  let completedFiles = 0;

  const uploadNextFile = (index: number): void => {
    if (index >= files.length) {
      observer.onProgress(100, 'Done!');
      observer.onDone(results);
      return;
    }

    const file = files[index];
    const isFirst = index === 0;
    observer.onProgress((index / totalItems) * 100, 'Uploading ' + file.name + '...');

    const formData = new FormData();
    formData.append('images[]', file);

    if (isFirst) {
      if (title) formData.append('title', title);
      formData.append('privacy', privacy);
      formData.append('nsfw', nsfw ? 'true' : 'false');
    }

    const url = isFirst
      ? apiBaseUrl + '/upload/imgchest/post'
      : apiBaseUrl + '/upload/imgchest/post/' + currentPostId + '/add';

    fetchFn(url, { method: 'POST', body: formData, headers })
      .then(response => response.text())
      .then(text => {
        try {
          const data = JSON.parse(text);
          if (data.error) {
            let errorMsg = data.error;
            if (data.details) {
              errorMsg += ': ' + (typeof data.details === 'object' ? JSON.stringify(data.details) : data.details);
            }
            throw new Error(errorMsg);
          }

          if (isFirst) {
            currentPostId = data.data.id;
            const postResult: UploadResult = { type: 'success', url: 'https://imgchest.com/p/' + data.data.id, isPost: true };
            results.push(postResult);
            observer.onResult(postResult, results.length - 1);
          }

          const newImages = isFirst
            ? data.data.images
            : data.data.images.slice(-1);
          for (const img of newImages) {
            const imgResult: UploadResult = { type: 'success', url: img.link };
            results.push(imgResult);
            observer.onResult(imgResult, results.length - 1);
          }

          completedFiles++;
          observer.onProgress((completedFiles / totalItems) * 100, 'Uploaded ' + completedFiles + ' of ' + totalItems);
          uploadNextFile(index + 1);
        } catch (e) {
          const errResult: UploadResult = { type: 'error', message: 'Failed to upload ' + file.name + ': ' + (e as Error).message };
          results.push(errResult);
          observer.onResult(errResult, results.length - 1);

          if (isFirst) {
            observer.onProgress(100, 'Done!');
            observer.onDone(results);
          } else {
            completedFiles++;
            observer.onProgress((completedFiles / totalItems) * 100, 'Uploaded ' + completedFiles + ' of ' + totalItems);
            uploadNextFile(index + 1);
          }
        }
      })
      .catch(error => {
        const errResult: UploadResult = { type: 'error', message: 'Failed to upload ' + file.name + ': ' + error.message };
        results.push(errResult);
        observer.onResult(errResult, results.length - 1);

        if (isFirst) {
          observer.onProgress(100, 'Done!');
          observer.onDone(results);
        } else {
          completedFiles++;
          uploadNextFile(index + 1);
        }
      });
  };

  uploadNextFile(0);
}
