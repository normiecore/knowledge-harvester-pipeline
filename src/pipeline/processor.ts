import { logger } from '../config/logger.js';
import { sensitivityPreFilter } from './sensitivity-filter.js';
import { buildEngram } from './engram-builder.js';
import type { Extractor } from './extractor.js';
import type { Deduplicator } from './deduplicator.js';
import type { VaultManager } from '../storage/vault-manager.js';
import type { EngramIndex } from '../storage/engram-index.js';
import { ExtractionError } from '../types.js';
import type { RawCapture } from '../types.js';
import { topicForUser, TOPICS } from '../queue/topics.js';
import type { ConcurrencyLimiter } from './concurrency-limiter.js';
import type { PipelineMetrics } from './metrics.js';
import type { OcrClient } from './ocr.js';
import type { SettingsStore } from '../storage/settings-store.js';

export interface ProcessResult {
  action: 'stored' | 'blocked' | 'deduplicated' | 'error';
  reason?: string;
}

export class PipelineProcessor {
  constructor(
    private extractor: Extractor,
    private deduplicator: Deduplicator,
    private vaultManager: VaultManager,
    private publishToNats: (topic: string, data: unknown) => void,
    private engramIndex?: EngramIndex,
    private limiter?: ConcurrencyLimiter,
    private metrics?: PipelineMetrics,
    private ocrClient?: OcrClient,
    private settingsStore?: SettingsStore,
  ) {}

  async process(capture: RawCapture): Promise<ProcessResult> {
    // Stage 1: Rules-based sensitivity pre-filter (must run first for audit trail)
    const filterResult = sensitivityPreFilter(capture);
    if (filterResult.action === 'block') {
      this.metrics?.recordBlocked();
      return { action: 'blocked', reason: `pre-filter: ${filterResult.reason}` };
    }

    // Stage 2: OCR enrichment for desktop screenshots (before LLM to replace base64 with text)
    capture = await this.enrichWithOcr(capture);

    // Stage 3: Dedup check (before LLM call to save compute)
    if (this.deduplicator.isDuplicate(capture.userId, capture.rawContent)) {
      this.metrics?.recordDeduplicated();
      return { action: 'deduplicated' };
    }

    // Stage 3: LLM extraction + sensitivity (with optional concurrency limiting)
    let extraction;
    try {
      extraction = this.limiter
        ? await this.limiter.run(() => this.extractor.extract(capture))
        : await this.extractor.extract(capture);
    } catch (err: unknown) {
      if (err instanceof ExtractionError) {
        // All retries exhausted — publish to dead-letter topic for later inspection
        this.publishToNats(TOPICS.DEAD_LETTER, {
          capture: err.capture,
          error: err.message,
          attempts: err.attempts,
          failedAt: new Date().toISOString(),
        });
        this.metrics?.recordError();
        return {
          action: 'error',
          reason: `extraction failed after ${err.attempts} attempts: ${err.message}`,
        };
      }
      throw err;
    }

    // Stage 4: LLM sensitivity gate
    if (extraction.sensitivity.classification === 'block') {
      this.metrics?.recordBlocked();
      return { action: 'blocked', reason: `llm: ${extraction.sensitivity.reasoning}` };
    }

    // Stage 5: Build engram and store (MuninnDB is source of truth, write there first)
    const engram = buildEngram(capture, extraction);

    // Auto-approve: if the user has configured an auto-approve threshold and
    // the extraction confidence meets or exceeds it, skip the pending state.
    if (this.settingsStore) {
      const threshold = this.settingsStore.getAutoApproveThreshold(capture.userId);
      if (threshold > 0 && extraction.confidence >= threshold) {
        engram.approval_status = 'approved';
        engram.approved_at = new Date().toISOString();
        engram.approved_by = 'auto';
        logger.info(
          { captureId: capture.id, confidence: extraction.confidence, threshold },
          'Auto-approved engram (confidence >= threshold)',
        );
      }
    }

    await this.vaultManager.storePending(engram);

    // Update local index so the API can query pending engrams.
    // If this fails, log a warning but don't fail the pipeline --
    // the index is a cache and can be rebuilt from MuninnDB.
    if (this.engramIndex) {
      try {
        this.engramIndex.upsert({
          id: capture.id,
          userId: capture.userId,
          concept: engram.concept,
          approvalStatus: engram.approval_status,
          capturedAt: engram.captured_at,
          sourceType: engram.source_type,
          confidence: engram.confidence,
          tags: engram.tags,
        });
      } catch (indexErr) {
        logger.warn({ captureId: capture.id, err: indexErr }, 'Local index upsert failed (MuninnDB write succeeded, index can be rebuilt)');
      }
    }

    // Stage 6: Notify
    this.publishToNats(topicForUser(capture.userId), engram);
    this.metrics?.recordProcessed();
    return { action: 'stored' };
  }

  // ---------------------------------------------------------------------------
  // OCR enrichment
  // ---------------------------------------------------------------------------

  /**
   * For desktop captures that contain a base64 screenshot, run OCR to extract
   * text and append it to the capture's rawContent. The base64 image data is
   * then stripped so downstream stages (LLM extractor) receive only text.
   *
   * If OCR is unavailable or fails, the capture is returned unchanged --
   * the pipeline degrades gracefully, falling back to the extractor's own
   * `prepareContent` which already strips the screenshot.
   */
  private async enrichWithOcr(capture: RawCapture): Promise<RawCapture> {
    if (!this.ocrClient) return capture;

    // Only process desktop captures that carry screenshot data
    const isDesktop =
      capture.sourceType === 'desktop_screenshot' ||
      capture.sourceType === 'desktop_window';
    if (!isDesktop) return capture;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(capture.rawContent);
    } catch {
      return capture;
    }

    const base64 = parsed.screenshotBase64;
    if (typeof base64 !== 'string' || base64.length === 0) return capture;

    const ocrResult = await this.ocrClient.extractText(base64);

    if (!ocrResult || ocrResult.text.trim().length === 0) {
      this.metrics?.recordOcrFailed();
      logger.debug({ captureId: capture.id }, 'OCR returned no text, continuing without enrichment');
      return capture;
    }

    this.metrics?.recordOcrProcessed(ocrResult.confidence);
    logger.info(
      {
        captureId: capture.id,
        ocrChars: ocrResult.text.length,
        ocrRegions: ocrResult.regions.length,
        ocrConfidence: ocrResult.confidence.toFixed(3),
        ocrTimeMs: ocrResult.processingTimeMs,
      },
      'OCR enrichment complete',
    );

    // Replace base64 with extracted text and rebuild rawContent
    const { screenshotBase64: _, ...contextWithoutScreenshot } = parsed;
    const enriched = {
      ...contextWithoutScreenshot,
      screenshotText: `[Screenshot text]: ${ocrResult.text}`,
    };

    return {
      ...capture,
      rawContent: JSON.stringify(enriched),
    };
  }
}
