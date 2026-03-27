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
  ) {}

  async process(capture: RawCapture): Promise<ProcessResult> {
    // Stage 1: Rules-based sensitivity pre-filter (must run first for audit trail)
    const filterResult = sensitivityPreFilter(capture);
    if (filterResult.action === 'block') {
      this.metrics?.recordBlocked();
      return { action: 'blocked', reason: `pre-filter: ${filterResult.reason}` };
    }

    // Stage 2: Dedup check (before LLM call to save compute)
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
        });
      } catch (indexErr) {
        console.warn(
          `Local index upsert failed for capture ${capture.id} (MuninnDB write succeeded, index can be rebuilt):`,
          indexErr,
        );
      }
    }

    // Stage 6: Notify
    this.publishToNats(topicForUser(capture.userId), engram);
    this.metrics?.recordProcessed();
    return { action: 'stored' };
  }
}
