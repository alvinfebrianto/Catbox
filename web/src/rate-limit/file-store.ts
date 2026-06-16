import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { AllRateLimits } from '../types';
import { createEmptyRateLimitState, RateLimitStore } from './engine';

export class FileRateLimitStore implements RateLimitStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<AllRateLimits> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf-8')) as AllRateLimits;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return createEmptyRateLimitState();
      }
      throw error;
    }
  }

  async save(state: AllRateLimits): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2));
  }
}
