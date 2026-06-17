import { describe, expect, test } from 'vitest';
import { UploadResult } from '../../src/types';
import { RecordingUploadObserver } from './recording-observer';

describe('RecordingUploadObserver', () => {
  test('captures a synthetic upload event sequence in order', () => {
    const observer = new RecordingUploadObserver();
    const result: UploadResult = { type: 'success', url: 'https://files.example/cat.png' };
    const finalResults: UploadResult[] = [result];

    observer.onProgress(0, 'Starting upload...');
    observer.onResult(result, 0);
    observer.onRateLimitWait(3);
    observer.onRateLimitWait(0);
    observer.onProgress(100, 'Done!');
    observer.onDone(finalResults);

    expect(observer.results).toEqual([{ result, index: 0 }]);
    expect(observer.progress).toEqual([
      { percent: 0, label: 'Starting upload...' },
      { percent: 100, label: 'Done!' },
    ]);
    expect(observer.rateLimitWaits).toEqual([3, 0]);
    expect(observer.doneWith).toEqual([finalResults]);
    expect(observer.events).toEqual([
      { type: 'progress', percent: 0, label: 'Starting upload...' },
      { type: 'result', result, index: 0 },
      { type: 'rateLimitWait', secondsRemaining: 3 },
      { type: 'rateLimitWait', secondsRemaining: 0 },
      { type: 'progress', percent: 100, label: 'Done!' },
      { type: 'done', results: finalResults },
    ]);
  });
});
