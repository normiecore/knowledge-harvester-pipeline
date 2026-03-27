import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OcrClient } from '../../src/pipeline/ocr.js';

describe('OcrClient', () => {
  let client: OcrClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new OcrClient('http://localhost:8866', 5000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // extractText
  // ---------------------------------------------------------------------------

  describe('extractText', () => {
    it('returns structured OcrResult on successful OCR response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [[
            {
              text: 'Hello World',
              confidence: 0.95,
              text_region: [[10, 10], [100, 10], [100, 30], [10, 30]],
            },
            {
              text: 'Second line',
              confidence: 0.90,
              text_region: [[10, 50], [120, 50], [120, 70], [10, 70]],
            },
          ]],
        }),
      });

      const result = await client.extractText('base64imagedata');

      expect(result).not.toBeNull();
      expect(result!.text).toBe('Hello World\nSecond line');
      expect(result!.regions).toHaveLength(2);
      expect(result!.regions[0].text).toBe('Hello World');
      expect(result!.regions[0].bbox).toEqual([10, 10, 100, 30]);
      expect(result!.processingTimeMs).toBeGreaterThanOrEqual(0);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8866/predict/ocr_system',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ images: ['base64imagedata'] }),
        }),
      );
    });

    it('returns null when service is unavailable (fetch throws)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await client.extractText('base64imagedata');

      expect(result).toBeNull();
    });

    it('returns null on timeout (abort error)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('The operation was aborted'));

      const result = await client.extractText('base64imagedata');

      expect(result).toBeNull();
    });

    it('returns null on non-OK HTTP status', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await client.extractText('base64imagedata');

      expect(result).toBeNull();
    });

    it('returns empty text when results array is empty', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [[]] }),
      });

      const result = await client.extractText('base64imagedata');

      expect(result).not.toBeNull();
      expect(result!.text).toBe('');
      expect(result!.regions).toHaveLength(0);
      expect(result!.confidence).toBe(0);
    });

    it('returns empty text when results field is missing', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const result = await client.extractText('base64imagedata');

      expect(result).not.toBeNull();
      expect(result!.text).toBe('');
      expect(result!.regions).toHaveLength(0);
    });

    it('sorts regions top-to-bottom then left-to-right', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [[
            // Bottom-right region (should be last)
            {
              text: 'Bottom Right',
              confidence: 0.90,
              text_region: [[200, 100], [300, 100], [300, 120], [200, 120]],
            },
            // Top-right region (should be second — same line as top-left)
            {
              text: 'Top Right',
              confidence: 0.85,
              text_region: [[200, 10], [300, 10], [300, 30], [200, 30]],
            },
            // Top-left region (should be first)
            {
              text: 'Top Left',
              confidence: 0.92,
              text_region: [[10, 12], [100, 12], [100, 32], [10, 32]],
            },
            // Bottom-left region (should be third — same line as bottom-right)
            {
              text: 'Bottom Left',
              confidence: 0.88,
              text_region: [[10, 100], [100, 100], [100, 120], [10, 120]],
            },
          ]],
        }),
      });

      const result = await client.extractText('base64imagedata');

      expect(result).not.toBeNull();
      // Top line: Top Left (x=10) before Top Right (x=200), within 10px y threshold
      // Bottom line: Bottom Left (x=10) before Bottom Right (x=200)
      expect(result!.regions.map((r) => r.text)).toEqual([
        'Top Left',
        'Top Right',
        'Bottom Left',
        'Bottom Right',
      ]);
      expect(result!.text).toBe('Top Left\nTop Right\nBottom Left\nBottom Right');
    });

    it('computes average confidence across regions', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [[
            {
              text: 'A',
              confidence: 0.80,
              text_region: [[0, 0], [10, 0], [10, 10], [0, 10]],
            },
            {
              text: 'B',
              confidence: 0.90,
              text_region: [[0, 20], [10, 20], [10, 30], [0, 30]],
            },
            {
              text: 'C',
              confidence: 1.0,
              text_region: [[0, 40], [10, 40], [10, 50], [0, 50]],
            },
          ]],
        }),
      });

      const result = await client.extractText('base64imagedata');

      expect(result).not.toBeNull();
      expect(result!.confidence).toBeCloseTo(0.9, 5); // (0.80 + 0.90 + 1.0) / 3
    });
  });

  // ---------------------------------------------------------------------------
  // isAvailable
  // ---------------------------------------------------------------------------

  describe('isAvailable', () => {
    it('returns true when service responds with OK', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

      const available = await client.isAvailable();

      expect(available).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8866/ping',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns false when service is down', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });

    it('returns false when service returns non-OK status', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });
  });
});
