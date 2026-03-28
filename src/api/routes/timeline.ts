import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { EngramIndex } from '../../storage/engram-index.js';
import type { MuninnDBClient } from '../../storage/muninndb-client.js';
import { VaultManager } from '../../storage/vault-manager.js';

interface TimelineRoutesOpts extends FastifyPluginOptions {
  engramIndex: EngramIndex;
  muninnClient: MuninnDBClient;
}

export interface TimelineBlock {
  startTime: string;
  endTime: string;
  engrams: TimelineEngram[];
  appCategory: string;
  totalDuration: number;
}

export interface TimelineEngram {
  id: string;
  concept: string;
  capturedAt: string;
  sourceType: string;
  sourceApp: string;
  confidence: number;
  appCategory: string;
  durationSeconds: number;
  documentName: string;
  tags: string;
}

export interface TimelineResponse {
  date: string;
  blocks: TimelineBlock[];
  summary: {
    totalActiveSeconds: number;
    totalEngrams: number;
    topApps: Array<{ app: string; seconds: number }>;
  };
}

/**
 * Group engrams into contiguous time blocks by appCategory.
 * Engrams within 5 minutes of each other in the same category are grouped together.
 */
export function buildTimelineBlocks(engrams: TimelineEngram[]): TimelineBlock[] {
  if (engrams.length === 0) return [];

  const GAP_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
  const blocks: TimelineBlock[] = [];
  let currentBlock: TimelineBlock | null = null;

  for (const engram of engrams) {
    const engramTime = new Date(engram.capturedAt).getTime();
    const engramEnd = engramTime + (engram.durationSeconds || 0) * 1000;

    if (
      currentBlock &&
      currentBlock.appCategory === engram.appCategory &&
      engramTime - new Date(currentBlock.endTime).getTime() < GAP_THRESHOLD_MS
    ) {
      // Extend current block
      currentBlock.engrams.push(engram);
      currentBlock.endTime = new Date(engramEnd).toISOString();
      currentBlock.totalDuration += engram.durationSeconds || 0;
    } else {
      // Start a new block
      currentBlock = {
        startTime: engram.capturedAt,
        endTime: new Date(engramEnd).toISOString(),
        engrams: [engram],
        appCategory: engram.appCategory,
        totalDuration: engram.durationSeconds || 0,
      };
      blocks.push(currentBlock);
    }
  }

  return blocks;
}

export async function timelineRoutes(
  app: FastifyInstance,
  opts: TimelineRoutesOpts,
): Promise<void> {
  const { engramIndex, muninnClient } = opts;

  // GET /api/engrams/timeline?date=YYYY-MM-DD&userId=optional
  app.get('/api/engrams/timeline', async (req, reply) => {
    const user = (req as any).user;
    const { date, userId } = req.query as { date?: string; userId?: string };

    // Default to today
    const targetDate = date || new Date().toISOString().slice(0, 10);

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      reply.code(400);
      return { error: 'date must be YYYY-MM-DD format' };
    }

    const effectiveUserId = userId || user.userId;
    const dayStart = `${targetDate}T00:00:00.000Z`;
    const dayEnd = `${targetDate}T23:59:59.999Z`;

    // Fetch engrams for the day using the faceted query
    const result = engramIndex.queryFaceted(effectiveUserId, {
      from: dayStart,
      to: dayEnd,
      limit: 1000,
      offset: 0,
    });

    // Enrich engrams with source_metadata from MuninnDB.
    // Fetch in parallel batches (max 10 concurrent) to avoid N+1 stalls.
    const vault = VaultManager.personalVault(effectiveUserId);
    const BATCH_CONCURRENCY = 10;
    const enrichedEngrams: TimelineEngram[] = [];

    // Process in batches of BATCH_CONCURRENCY
    for (let i = 0; i < result.engrams.length; i += BATCH_CONCURRENCY) {
      const batch = result.engrams.slice(i, i + BATCH_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (engram) => {
          let sourceMetadata: any = {};
          try {
            const detail = await muninnClient.read(vault, engram.id);
            sourceMetadata = detail.metadata ?? {};
          } catch {
            // Engram might not exist in MuninnDB anymore
          }

          return {
            id: engram.id,
            concept: engram.concept,
            capturedAt: engram.capturedAt,
            sourceType: engram.sourceType,
            sourceApp: sourceMetadata.sourceApp ?? engram.sourceType,
            confidence: engram.confidence,
            appCategory: sourceMetadata.appCategory ?? 'other',
            durationSeconds: sourceMetadata.durationSeconds ?? 0,
            documentName: sourceMetadata.documentName ?? '',
            tags: typeof engram.tags === 'string' ? engram.tags : (engram.tags ?? []).join(' '),
          } satisfies TimelineEngram;
        }),
      );

      for (const result of settled) {
        if (result.status === 'fulfilled') {
          enrichedEngrams.push(result.value);
        }
      }
    }

    // Sort by captured_at ascending
    enrichedEngrams.sort(
      (a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime(),
    );

    // Build time blocks
    const blocks = buildTimelineBlocks(enrichedEngrams);

    // Build summary
    const appDurations = new Map<string, number>();
    let totalActiveSeconds = 0;

    for (const engram of enrichedEngrams) {
      totalActiveSeconds += engram.durationSeconds;
      const current = appDurations.get(engram.sourceApp) ?? 0;
      appDurations.set(engram.sourceApp, current + engram.durationSeconds);
    }

    const topApps = [...appDurations.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([app, seconds]) => ({ app, seconds }));

    const response: TimelineResponse = {
      date: targetDate,
      blocks,
      summary: {
        totalActiveSeconds,
        totalEngrams: enrichedEngrams.length,
        topApps,
      },
    };

    return response;
  });
}
