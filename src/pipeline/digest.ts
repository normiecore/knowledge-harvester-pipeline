import type { EngramIndex } from '../storage/engram-index.js';

export interface Digest {
  period: 'daily' | 'weekly';
  from: string;
  to: string;
  newEngrams: number;
  topTags: Array<{ tag: string; count: number }>;
  highlights: Array<{
    concept: string;
    confidence: number;
    sourceType: string;
    capturedAt: string;
  }>;
  sourcesBreakdown: Array<{ source: string; count: number }>;
}

const MS_PER_DAY = 86_400_000;

export function generateDigest(
  engramIndex: EngramIndex,
  userId: string,
  period: 'daily' | 'weekly',
): Digest {
  const db = (engramIndex as any).db;

  const now = new Date();
  const to = now.toISOString();
  const days = period === 'daily' ? 1 : 7;
  const from = new Date(now.getTime() - days * MS_PER_DAY).toISOString();

  // Count approved engrams in range
  const countRow = db.prepare(
    `SELECT COUNT(*) AS cnt FROM engram_index
     WHERE user_id = ? AND approval_status = 'approved' AND captured_at >= ?`,
  ).get(userId, from) as { cnt: number };

  // Top tags
  const tagRows = db.prepare(
    `SELECT tags FROM engram_index
     WHERE user_id = ? AND approval_status = 'approved' AND captured_at >= ? AND tags != ''`,
  ).all(userId, from) as Array<{ tags: string }>;

  const tagCounts = new Map<string, number>();
  for (const row of tagRows) {
    const tags = row.tags.split(/\s+/).filter(Boolean);
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  // Highlights: top engrams by confidence
  const highlights = db.prepare(
    `SELECT concept, confidence, source_type AS sourceType, captured_at AS capturedAt
     FROM engram_index
     WHERE user_id = ? AND approval_status = 'approved' AND captured_at >= ?
     ORDER BY confidence DESC
     LIMIT 5`,
  ).all(userId, from) as Array<{
    concept: string;
    confidence: number;
    sourceType: string;
    capturedAt: string;
  }>;

  // Sources breakdown
  const sourcesBreakdown = db.prepare(
    `SELECT source_type AS source, COUNT(*) AS count
     FROM engram_index
     WHERE user_id = ? AND approval_status = 'approved' AND captured_at >= ?
     GROUP BY source_type
     ORDER BY count DESC`,
  ).all(userId, from) as Array<{ source: string; count: number }>;

  return {
    period,
    from,
    to,
    newEngrams: countRow.cnt,
    topTags,
    highlights,
    sourcesBreakdown,
  };
}
