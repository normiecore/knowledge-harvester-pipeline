import { logger } from '../config/logger.js';

/** Default timeout for MuninnDB requests (15 seconds). */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Maximum retries for transient MuninnDB failures. */
const MAX_RETRIES = 2;

/** Base delay between retries (doubles each attempt). */
const RETRY_BASE_DELAY_MS = 500;

export class MuninnDBClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(baseUrl: string, apiKey: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (!response.ok) {
          const text = await response.text();
          const err = new Error(`MuninnDB error: ${response.status} ${text}`);
          // Only retry on 5xx / 429, not on 4xx client errors
          if (response.status >= 500 || response.status === 429) {
            lastError = err;
            if (attempt < MAX_RETRIES) {
              const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
              await new Promise((r) => setTimeout(r, delay));
              continue;
            }
          }
          throw err;
        }

        return response.json() as Promise<T>;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Retry on timeout / network errors
        const isTransient =
          lastError.name === 'TimeoutError' ||
          lastError.name === 'AbortError' ||
          lastError.message.includes('fetch failed') ||
          lastError.message.includes('ECONNREFUSED');
        if (isTransient && attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          logger.warn(
            { attempt: attempt + 1, path, err: lastError.message },
            'MuninnDB request failed, retrying',
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError;
  }

  async remember(
    vault: string,
    concept: string,
    content: string,
  ): Promise<{ id: string; concept: string; content: string; metadata?: Record<string, unknown> }> {
    return this.request('/remember', { vault, concept, content });
  }

  async recall(
    vault: string,
    context: string,
  ): Promise<{ engrams: Array<{ id: string; concept: string }> }> {
    return this.request('/recall', { vault, context });
  }

  async read(
    vault: string,
    id: string,
  ): Promise<{ id: string; concept: string; content: string; metadata?: Record<string, unknown> }> {
    return this.request('/read', { vault, id });
  }

  /**
   * List all engrams in a vault. Uses recall with a broad context
   * and paginates to retrieve everything available.
   */
  async listAll(
    vault: string,
  ): Promise<Array<{ id: string; concept: string; content: string }>> {
    // Recall with broad context to get all engram IDs
    const result = await this.recall(vault, '*');
    const engrams: Array<{ id: string; concept: string; content: string }> = [];

    for (const entry of result.engrams) {
      try {
        const full = await this.read(vault, entry.id);
        engrams.push(full);
      } catch (err) {
        logger.warn({ engramId: entry.id, vault, err }, 'Failed to read engram');
      }
    }

    return engrams;
  }
}
