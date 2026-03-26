import { sensitivityPreFilter } from './sensitivity-filter.js';
import { buildEngram } from './engram-builder.js';
import type { Extractor } from './extractor.js';
import type { Deduplicator } from './deduplicator.js';
import type { VaultManager } from '../storage/vault-manager.js';
import type { EngramIndex } from '../storage/engram-index.js';
import type { RawCapture } from '../types.js';
import { topicForUser } from '../queue/topics.js';

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
  ) {}

  async process(capture: RawCapture): Promise<ProcessResult> {
    // Stage 1: Rules-based sensitivity pre-filter (must run first for audit trail)
    const filterResult = sensitivityPreFilter(capture);
    if (filterResult.action === 'block') {
      return { action: 'blocked', reason: `pre-filter: ${filterResult.reason}` };
    }

    // Stage 2: Dedup check (before LLM call to save compute)
    if (this.deduplicator.isDuplicate(capture.userId, capture.rawContent)) {
      return { action: 'deduplicated' };
    }

    // Stage 3: LLM extraction + sensitivity
    const extraction = await this.extractor.extract(capture);

    // Stage 4: LLM sensitivity gate
    if (extraction.sensitivity.classification === 'block') {
      return { action: 'blocked', reason: `llm: ${extraction.sensitivity.reasoning}` };
    }

    // Stage 5: Build engram and store
    const engram = buildEngram(capture, extraction);
    await this.vaultManager.storePending(engram);

    // Update local index so the API can query pending engrams
    if (this.engramIndex) {
      this.engramIndex.upsert({
        id: capture.id,
        userId: capture.userId,
        concept: engram.concept,
        approvalStatus: engram.approval_status,
        capturedAt: engram.captured_at,
        sourceType: engram.source_type,
        confidence: engram.confidence,
      });
    }

    // Stage 6: Notify
    this.publishToNats(topicForUser(capture.userId), engram);
    return { action: 'stored' };
  }
}
