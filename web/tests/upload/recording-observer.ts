import { UploadResult } from '../../src/types';
import { UploadObserver } from '../../src/upload/contracts';

export type RecordedUploadObserverEvent =
  | { type: 'result'; result: UploadResult; index: number }
  | { type: 'progress'; percent: number; label: string }
  | { type: 'rateLimitWait'; secondsRemaining: number };

export class RecordingUploadObserver implements UploadObserver {
  readonly results: Array<{ result: UploadResult; index: number }> = [];
  readonly progress: Array<{ percent: number; label: string }> = [];
  readonly rateLimitWaits: number[] = [];
  readonly events: RecordedUploadObserverEvent[] = [];

  onResult(result: UploadResult, index: number): void {
    this.results.push({ result, index });
    this.events.push({ type: 'result', result, index });
  }

  onProgress(percent: number, label: string): void {
    this.progress.push({ percent, label });
    this.events.push({ type: 'progress', percent, label });
  }

  onRateLimitWait(secondsRemaining: number): void {
    this.rateLimitWaits.push(secondsRemaining);
    this.events.push({ type: 'rateLimitWait', secondsRemaining });
  }
}
