import { describe, it, expect, vi } from 'vitest';
import { Extractor } from '../../src/pipeline/extractor.js';
import type { RawCapture } from '../../src/types.js';

function makeCapture(): RawCapture {
  return {
    id: 'cap-1',
    userId: 'user-1',
    userEmail: 'user@co.com',
    sourceType: 'graph_email',
    sourceApp: 'outlook',
    capturedAt: '2026-03-26T10:00:00Z',
    rawContent: JSON.stringify({
      subject: 'Subsea connector specs',
      bodyPreview: 'The new 3-inch connector passed pressure testing at 500 bar.',
    }),
    metadata: {},
  };
}

function makeMockOpenAI(responseContent: string) {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: responseContent } }],
        })),
      },
    },
  };
}

describe('Extractor', () => {
  it('extracts knowledge from raw capture', async () => {
    const validResponse = JSON.stringify({
      summary: 'New 3-inch subsea connector passed pressure testing at 500 bar.',
      tags: ['subsea', 'connector', 'testing'],
      confidence: 0.85,
      sensitivity: { classification: 'safe', reasoning: 'Technical specification update.' },
    });

    const mockClient = makeMockOpenAI(validResponse);
    const extractor = new Extractor(mockClient as any);
    const result = await extractor.extract(makeCapture());

    expect(result.summary).toContain('connector');
    expect(result.tags).toContain('subsea');
    expect(result.confidence).toBe(0.85);
    expect(result.sensitivity.classification).toBe('safe');
  });

  it('sends capture content to LLM', async () => {
    const validResponse = JSON.stringify({
      summary: 'Test summary',
      tags: ['test'],
      confidence: 0.5,
      sensitivity: { classification: 'safe', reasoning: 'test' },
    });

    const mockClient = makeMockOpenAI(validResponse);
    const extractor = new Extractor(mockClient as any);
    await extractor.extract(makeCapture());

    expect(mockClient.chat.completions.create).toHaveBeenCalledOnce();
    const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
    expect(callArgs.messages).toHaveLength(2);
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[1].role).toBe('user');
    expect(callArgs.messages[1].content).toContain('Subsea connector specs');
  });

  it('throws on invalid LLM JSON response', async () => {
    const mockClient = makeMockOpenAI('this is not valid json at all');
    const extractor = new Extractor(mockClient as any, 'gpt-4o-mini', 1, 10);

    await expect(extractor.extract(makeCapture())).rejects.toThrow();
  });
});
