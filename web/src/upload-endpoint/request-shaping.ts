import { CatboxUploadInput, readCatboxUploadInput, CatboxProviderInputError } from '../providers/catbox';
import { validateFiles } from '../types';

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
