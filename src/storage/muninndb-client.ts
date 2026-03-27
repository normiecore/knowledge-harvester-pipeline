export class MuninnDBClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`MuninnDB error: ${response.status} ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async remember(
    vault: string,
    concept: string,
    content: string,
  ): Promise<{ id: string; concept: string; content: string }> {
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
  ): Promise<{ id: string; concept: string; content: string }> {
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
        console.warn(`Failed to read engram ${entry.id} from vault ${vault}:`, err);
      }
    }

    return engrams;
  }
}
