export class RetryableError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs = 60000 } = opts;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (!(err instanceof RetryableError)) throw err;
      if (attempt >= maxRetries) break;

      let delayMs: number;
      if (err.retryAfterSeconds) {
        delayMs = err.retryAfterSeconds * 1000;
      } else {
        delayMs = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}
