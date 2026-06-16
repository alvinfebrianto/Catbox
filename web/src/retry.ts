import { calculateExponentialBackoff, DEFAULT_RETRY_CONFIG, RetryConfig } from './types';

export type Sleep = (ms: number) => Promise<void>;

export interface RetryOptions<T> {
  config?: RetryConfig;
  shouldRetry?: (result: T, attempt: number) => boolean;
  delayMs?: (attempt: number, result: T | undefined, error: Error | undefined) => number;
  sleep?: Sleep;
}

const defaultSleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions<T> = {}
): Promise<T> {
  const config = options.config ?? DEFAULT_RETRY_CONFIG;
  const shouldRetry = options.shouldRetry ?? (() => false);
  const delayMs = options.delayMs ?? ((attempt: number) => calculateExponentialBackoff(attempt, config));
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      const result = await operation(attempt);
      if (attempt >= config.maxRetries || !shouldRetry(result, attempt)) {
        return result;
      }

      await sleep(Math.min(delayMs(attempt, result, undefined), config.maxDelayMs));
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (attempt >= config.maxRetries) {
        throw normalized;
      }

      await sleep(Math.min(delayMs(attempt, undefined, normalized), config.maxDelayMs));
    }
  }

  throw new Error('Retry loop exhausted unexpectedly');
}
