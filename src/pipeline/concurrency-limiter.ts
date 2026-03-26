export class ConcurrencyLimiter {
  private _active = 0;
  private waiting: Array<() => void> = [];

  constructor(private maxConcurrency: number) {}

  get active(): number {
    return this._active;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this._active >= this.maxConcurrency) {
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
