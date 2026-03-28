/** Thrown when the waiting queue has reached its capacity and cannot accept more work. */
export class QueueFullError extends Error {
  constructor(queueSize: number) {
    super(`Concurrency limiter queue is full (${queueSize} pending). Rejecting new work to prevent OOM.`);
    this.name = 'QueueFullError';
  }
}

export class ConcurrencyLimiter {
  private _active = 0;
  private waiting: Array<() => void> = [];
  private readonly _maxQueueSize: number;

  constructor(private maxConcurrency: number, maxQueueSize = 1000) {
    this._maxQueueSize = maxQueueSize;
  }

  get active(): number {
    return this._active;
  }

  get queueSize(): number {
    return this.waiting.length;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this._active >= this.maxConcurrency) {
      if (this.waiting.length >= this._maxQueueSize) {
        throw new QueueFullError(this.waiting.length);
      }
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this._active++;
    try {
      return await fn();
    } finally {
      this._active--;
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}
