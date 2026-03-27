import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type OpenAI from 'openai';
import { ExtractionResultSchema, ExtractionError } from '../types.js';
import type { RawCapture, ExtractionResult } from '../types.js';

/** Default retry configuration for LLM extraction. */
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1_000;

/**
 * Try to extract a JSON object from an LLM response that may contain
 * markdown fences, preamble text, or other wrapping around the actual JSON.
 * Returns `undefined` if no JSON object can be found.
 */
function tryExtractJson(text: string): unknown | undefined {
  // First: try direct parse
  try {
    return JSON.parse(text);
  } catch {
    // continue to heuristics
  }

  // Second: strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      // continue
    }
  }

  // Third: find the first { ... } block (greedy from first { to last })
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      // give up
    }
  }

  return undefined;
}

export class Extractor {
  private systemPrompt: string;

  constructor(
    private client: OpenAI,
    private model: string = 'gpt-4o-mini',
    private maxRetries: number = DEFAULT_MAX_RETRIES,
    private baseDelayMs: number = DEFAULT_BASE_DELAY_MS,
  ) {
    const promptPath = resolve(process.cwd(), 'prompts', 'extraction.txt');
    this.systemPrompt = readFileSync(promptPath, 'utf-8');
  }

  /**
   * Extract structured data from a raw capture via LLM.
   *
   * Retries up to `maxRetries` times with exponential backoff (1s, 2s, 4s)
   * on transient failures (timeouts, network errors, non-JSON responses).
   *
   * @throws {ExtractionError} when all retries are exhausted — carries the
   *   original capture so the caller can route it to the dead-letter topic.
   */
  async extract(capture: RawCapture): Promise<ExtractionResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.attemptExtraction(capture);
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          const delayMs = this.baseDelayMs * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }

    // All retries exhausted — wrap in ExtractionError for dead-letter routing
    throw new ExtractionError(
      `Extraction failed after ${this.maxRetries + 1} attempts: ${lastError?.message ?? 'unknown error'}`,
      capture,
      this.maxRetries + 1,
      lastError,
    );
  }

  /** Single extraction attempt — no retry logic here. */
  private async attemptExtraction(capture: RawCapture): Promise<ExtractionResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: capture.rawContent },
      ],
      temperature: 0.2,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM returned empty response');
    }

    const parsed = tryExtractJson(content);
    if (parsed === undefined) {
      throw new Error(`LLM returned non-JSON response: ${content.slice(0, 200)}`);
    }

    const result = ExtractionResultSchema.parse(parsed);
    return result;
  }
}
