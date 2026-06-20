import { FetchLike, getDefaultFetch, ProviderResult } from '../provider-protocol';
import { withRetry, Sleep } from '../retry';
import { DEFAULT_RETRY_CONFIG, parseRateLimitHeaders, RetryConfig } from '../types';

export const CATBOX_REQUEST_TYPES = ['fileupload', 'urlupload', 'createalbum'] as const;
export type CatboxRequestType = typeof CATBOX_REQUEST_TYPES[number];

export interface CatboxUploadInput {
  reqtype: CatboxRequestType;
  userhash?: string;
  fileToUpload?: FormDataEntryValue | FormDataEntryValue[];
  url?: string;
  title?: string;
  desc?: string;
  files?: string;
}

export interface CatboxProviderOptions {
  fetch?: FetchLike;
  retryConfig?: RetryConfig;
  sleep?: Sleep;
}

function createCatboxFormData(input: CatboxUploadInput): FormData {
  const formData = new FormData();

  formData.append('reqtype', input.reqtype);
  appendString(formData, 'userhash', input.userhash);

  if (input.reqtype === 'fileupload') {
    const files = Array.isArray(input.fileToUpload) ? input.fileToUpload : [input.fileToUpload];
    for (const file of files) {
      if (file !== undefined) {
        formData.append('fileToUpload', file);
      }
    }
  }

  if (input.reqtype === 'urlupload') {
    appendString(formData, 'url', input.url);
  }

  if (input.reqtype === 'createalbum') {
    appendString(formData, 'title', input.title);
    appendString(formData, 'desc', input.desc);
    appendString(formData, 'files', input.files);
  }

  return formData;
}

function appendString(formData: FormData, key: string, value: string | undefined): void {
  if (value !== undefined) {
    formData.append(key, value);
  }
}

export async function uploadToCatbox(
  input: CatboxUploadInput,
  options: CatboxProviderOptions = {}
): Promise<ProviderResult> {
  const fetchImpl = options.fetch ?? getDefaultFetch();
  const config = options.retryConfig ?? DEFAULT_RETRY_CONFIG;
  const formData = createCatboxFormData(input);

  return withRetry(
    async () => {
      const response = await fetchImpl('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: formData,
        headers: {
          'User-Agent': 'CatboxUploader/2.0',
        },
      });

      return {
        status: response.status,
        body: await response.text(),
        rateLimitHeaders: parseRateLimitHeaders(response.headers),
      };
    },
    {
      config,
      shouldRetry: result => result.status === 429,
      sleep: options.sleep,
    }
  );
}
