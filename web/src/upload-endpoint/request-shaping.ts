import { CatboxUploadInput, readCatboxUploadInput, CatboxProviderInputError } from '../providers/catbox';
import {
  KekUploadInput,
  readKekUploadInputWithOptions,
  KekProviderInputError,
} from '../providers/kek';
import { validateFiles, validateKekFiles } from '../types';

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
