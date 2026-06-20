import { CatboxUploadInput, readCatboxUploadInput, CatboxProviderInputError } from '../providers/catbox';
import {
  KekUploadInput,
  readKekUploadInputWithOptions,
  KekProviderInputError,
} from '../providers/kek';
import { SxcuUploadInput } from '../providers/sxcu';
import { ImgchestUploadInput } from '../providers/imgchest';
import { validateFiles, validateKekFiles, validateImgchestFiles } from '../types';

export interface CatboxRequestResult {
  ok: true;
  input: CatboxUploadInput;
}

export interface CatboxRequestError {
  ok: false;
  error: string;
}

export type CatboxRequestShaping = CatboxRequestResult | CatboxRequestError;

export async function readCatboxRequest(formData: FormData): Promise<CatboxRequestShaping> {
  let input: CatboxUploadInput;
  try {
    input = readCatboxUploadInput(formData);
  } catch (error) {
    if (error instanceof CatboxProviderInputError) {
      return { ok: false, error: error.message };
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: message };
  }

  if (input.reqtype === 'fileupload') {
    const entries = Array.isArray(input.fileToUpload) ? input.fileToUpload : [input.fileToUpload];
    const files = entries.filter((f): f is File => f instanceof File);
    const validation = validateFiles(files);
    if (!validation.ok) {
      return { ok: false, error: validation.error! };
    }
  }

  return { ok: true, input };
}

export interface KekRequestResult {
  ok: true;
  input: KekUploadInput;
}

export interface KekRequestError {
  ok: false;
  error: string;
}

export type KekRequestShaping = KekRequestResult | KekRequestError;

export interface KekRequestOptions {
  /** Pre-resolved env-level API key from `deps.secrets.kekApiKey`. */
  envApiKey?: string;
  /** Caller-supplied key from the X-Kek-Auth header, if any. */
  headerApiKey?: string;
}

export async function readKekRequest(
  formData: FormData,
  options: KekRequestOptions,
): Promise<KekRequestShaping> {
  let input: KekUploadInput;
  try {
    input = readKekUploadInputWithOptions(formData, options);
  } catch (error) {
    if (error instanceof KekProviderInputError) {
      return { ok: false, error: error.message };
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: message };
  }

  if (input.files && input.files.length > 0) {
    const files = input.files.filter((f): f is File => f instanceof File);
    const validation = validateKekFiles(files);
    if (!validation.ok) {
      return { ok: false, error: validation.error! };
    }
  }

  return { ok: true, input };
}

export interface SxcuRequestResult {
  ok: true;
  input: SxcuUploadInput;
}

export interface SxcuRequestError {
  ok: false;
  error: string;
}

export type SxcuRequestShaping = SxcuRequestResult | SxcuRequestError;

export async function readSxcuRequest(
  formData: FormData,
  type: SxcuUploadInput['type'],
): Promise<SxcuRequestShaping> {
  if (type === 'file') {
    const files = formData.getAll('file').filter((f): f is File => f instanceof File);
    const validation = validateFiles(files);
    if (!validation.ok) {
      return { ok: false, error: validation.error! };
    }

    return { ok: true, input: { type, formData } };
  }

  const shaped = new FormData();
  for (const key of ['title', 'desc', 'private', 'unlisted'] as const) {
    const value = formData.get(key);
    if (value !== null) shaped.append(key, value);
  }

  return { ok: true, input: { type, formData: shaped } };
}

export interface ImgchestRequestResult {
  ok: true;
  input: ImgchestUploadInput;
}

export interface ImgchestRequestError {
  ok: false;
  error: string;
}

export type ImgchestRequestShaping = ImgchestRequestResult | ImgchestRequestError;

export interface ReadImgchestRequestOptions {
  /** Pre-resolved imgchest token from `deps.secrets.imgchestToken` (header-then-env, by the host). */
  token: string | undefined;
  /** Post id from the `:id` path parameter, for the add-to-post variant. */
  postId?: string;
}

export async function readImgchestRequest(
  formData: FormData,
  options: ReadImgchestRequestOptions,
): Promise<ImgchestRequestShaping> {
  if (!options.token) {
    return { ok: false, error: 'Imgchest API token not configured' };
  }

  const images = formData.getAll('images[]').filter((f): f is File => f instanceof File);
  const validation = validateImgchestFiles(images);
  if (!validation.ok) {
    return { ok: false, error: validation.error! };
  }

  const titleEntry = formData.get('title');
  const title = typeof titleEntry === 'string' && titleEntry.length > 0 ? titleEntry : undefined;

  const privacyEntry = formData.get('privacy');
  const privacyRaw = typeof privacyEntry === 'string' && privacyEntry.trim() !== ''
    ? privacyEntry.trim()
    : null;

  if (privacyRaw !== null && !['public', 'hidden', 'secret'].includes(privacyRaw)) {
    return { ok: false, error: 'Invalid privacy value. Must be public, hidden, or secret.' };
  }

  const nsfwEntry = formData.get('nsfw');
  const nsfwRaw = typeof nsfwEntry === 'string' && nsfwEntry.trim() !== ''
    ? nsfwEntry.trim()
    : null;
  const nsfwParsed = nsfwRaw !== null ? (nsfwRaw === 'true' || nsfwRaw === '1') : null;

  const isAddToPost = options.postId !== undefined;

  // New posts bake in the imgchest defaults (privacy=hidden, nsfw=true).
  // Add-to-post passes privacy/nsfw through as undefined unless the client sent them,
  // so the provider's follow-up PATCH step fires only on an explicit override.
  const privacy = privacyRaw ?? (isAddToPost ? undefined : 'hidden');
  const nsfw = nsfwParsed ?? (isAddToPost ? undefined : true);

  const input: ImgchestUploadInput = {
    images,
    token: options.token,
    title,
    privacy,
    nsfw,
  };

  if (isAddToPost) {
    input.existingPostId = options.postId;
  }

  return { ok: true, input };
}
