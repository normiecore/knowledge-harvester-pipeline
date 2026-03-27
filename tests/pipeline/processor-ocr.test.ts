import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineProcessor } from '../../src/pipeline/processor.js';
import { PipelineMetrics } from '../../src/pipeline/metrics.js';
import type { RawCapture } from '../../src/types.js';

describe('PipelineProcessor OCR enrichment', () => {
  let mockExtractor: any;
  let mockDeduplicator: any;
  let mockVaultManager: any;
  let mockNatsPublish: ReturnType<typeof vi.fn>;
  let mockEngramIndex: any;
  let metrics: PipelineMetrics;
  let mockOcrClient: any;

  const safeExtraction = {
    summary: 'Desktop activity summary',
    tags: ['desktop'],
    confidence: 0.85,
    sensitivity: { classification: 'safe', reasoning: 'Technical content' },
  };

  function makeDesktopCapture(overrides: Partial<RawCapture> = {}): RawCapture {
    return {
      id: 'cap-ocr-1',
      userId: 'user-abc',
      userEmail: 'james@example.com',
      sourceType: 'desktop_screenshot',
      sourceApp: 'ScreenCapture',
      capturedAt: '2026-03-28T10:00:00Z',
      rawContent: JSON.stringify({
        windowTitle: 'Visual Studio Code',
        screenshotBase64: 'iVBORw0KGgoAAAANSUhEUg==',
      }),
      metadata: {},
      ...overrides,
    };
  }

  beforeEach(() => {
    mockExtractor = { extract: vi.fn().mockResolvedValue(safeExtraction) };
    mockDeduplicator = { isDuplicate: vi.fn().mockReturnValue(false) };
    mockVaultManager = { storePending: vi.fn().mockResolvedValue(undefined) };
    mockNatsPublish = vi.fn();
    mockEngramIndex = { upsert: vi.fn() };
    metrics = new PipelineMetrics();
    mockOcrClient = {
      extractText: vi.fn().mockResolvedValue({
        text: 'Extracted screen text',
        confidence: 0.92,
        regions: [{ text: 'Extracted screen text', bbox: [0, 0, 100, 20], confidence: 0.92 }],
        processingTimeMs: 150,
      }),
    };
  });

  it('injects OCR text into desktop capture with screenshot', async () => {
    const processor = new PipelineProcessor(
      mockExtractor, mockDeduplicator, mockVaultManager, mockNatsPublish,
      mockEngramIndex, undefined, metrics, mockOcrClient,
    );

    const result = await processor.process(makeDesktopCapture());

    expect(result.action).toBe('stored');
    expect(mockOcrClient.extractText).toHaveBeenCalledWith('iVBORw0KGgoAAAANSUhEUg==');

    // Verify that the extractor received enriched content with OCR text
    const extractCall = mockExtractor.extract.mock.calls[0][0] as RawCapture;
    const parsed = JSON.parse(extractCall.rawContent);
    expect(parsed.screenshotText).toContain('Extracted screen text');
    expect(parsed.screenshotBase64).toBeUndefined();

    // Metrics should record OCR success
    const snap = metrics.snapshot();
    expect(snap.ocr_processed_total).toBe(1);
  });

  it('skips OCR entirely for non-desktop captures', async () => {
    const processor = new PipelineProcessor(
      mockExtractor, mockDeduplicator, mockVaultManager, mockNatsPublish,
      mockEngramIndex, undefined, metrics, mockOcrClient,
    );

    const emailCapture: RawCapture = {
      id: 'cap-email-1',
      userId: 'user-abc',
      userEmail: 'james@example.com',
      sourceType: 'graph_email',
      sourceApp: 'Outlook',
      capturedAt: '2026-03-28T10:00:00Z',
      rawContent: JSON.stringify({ subject: 'Meeting notes', body: 'Discussed pipeline design.' }),
      metadata: {},
    };

    const result = await processor.process(emailCapture);

    expect(result.action).toBe('stored');
    expect(mockOcrClient.extractText).not.toHaveBeenCalled();
  });

  it('skips OCR when desktop capture has no screenshot data', async () => {
    const processor = new PipelineProcessor(
      mockExtractor, mockDeduplicator, mockVaultManager, mockNatsPublish,
      mockEngramIndex, undefined, metrics, mockOcrClient,
    );

    const noScreenshot = makeDesktopCapture({
      rawContent: JSON.stringify({ windowTitle: 'Terminal' }),
    });

    const result = await processor.process(noScreenshot);

    expect(result.action).toBe('stored');
    expect(mockOcrClient.extractText).not.toHaveBeenCalled();
  });

  it('degrades gracefully when OCR fails (pipeline continues)', async () => {
    mockOcrClient.extractText.mockResolvedValue(null);

    const processor = new PipelineProcessor(
      mockExtractor, mockDeduplicator, mockVaultManager, mockNatsPublish,
      mockEngramIndex, undefined, metrics, mockOcrClient,
    );

    const result = await processor.process(makeDesktopCapture());

    expect(result.action).toBe('stored');
    expect(mockExtractor.extract).toHaveBeenCalled();

    // Metrics should record OCR failure
    const snap = metrics.snapshot();
    expect(snap.ocr_failed_total).toBe(1);
    expect(snap.ocr_processed_total).toBe(0);
  });

  it('strips base64 screenshot data after OCR enrichment', async () => {
    const processor = new PipelineProcessor(
      mockExtractor, mockDeduplicator, mockVaultManager, mockNatsPublish,
      mockEngramIndex, undefined, metrics, mockOcrClient,
    );

    await processor.process(makeDesktopCapture());

    const extractCall = mockExtractor.extract.mock.calls[0][0] as RawCapture;
    const parsed = JSON.parse(extractCall.rawContent);

    // base64 should be removed
    expect(parsed.screenshotBase64).toBeUndefined();
    // Original context fields should be preserved
    expect(parsed.windowTitle).toBe('Visual Studio Code');
    // OCR text should be present
    expect(parsed.screenshotText).toBe('[Screenshot text]: Extracted screen text');
  });
});
