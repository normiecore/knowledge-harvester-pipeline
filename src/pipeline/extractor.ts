import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type OpenAI from 'openai';
import { ExtractionResultSchema } from '../types.js';
import type { RawCapture, ExtractionResult } from '../types.js';

export class Extractor {
  private systemPrompt: string;

  constructor(
    private client: OpenAI,
    private model: string = 'gpt-4o-mini',
  ) {
    const promptPath = resolve(process.cwd(), 'prompts', 'extraction.txt');
    this.systemPrompt = readFileSync(promptPath, 'utf-8');
  }

  async extract(capture: RawCapture): Promise<ExtractionResult> {
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
    }

    const result = ExtractionResultSchema.parse(parsed);
    return result;
  }
}
