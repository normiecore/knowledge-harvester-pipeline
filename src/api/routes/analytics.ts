import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { EngramIndex } from '../../storage/engram-index.js';
import type { PipelineMetrics } from '../../pipeline/metrics.js';

interface AnalyticsRoutesOpts extends FastifyPluginOptions {
  engramIndex: EngramIndex;
  metrics?: PipelineMetrics;
}

export async function analyticsRoutes(
  app: FastifyInstance,
  opts: AnalyticsRoutesOpts,
): Promise<void> {
  const { engramIndex, metrics } = opts;

  const MS_PER_DAY = 86_400_000;

  // GET /api/analytics/overview — summary stats
  app.get('/api/analytics/overview', async (req, reply) => {
    try {
    const user = (req as any).user;

    const statusCounts = engramIndex.getStatusCounts(user.userId);

    const totals: Record<string, number> = { pending: 0, approved: 0, dismissed: 0 };
    let totalEngrams = 0;
    for (const row of statusCounts) {
      totals[row.approval_status] = row.count;
      totalEngrams += row.count;
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now.getTime() - 7 * MS_PER_DAY).toISOString().slice(0, 10);
    const monthAgo = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString().slice(0, 10);

    const todayCount = engramIndex.countSince(user.userId, todayStr);
    const weekCount = engramIndex.countSince(user.userId, weekAgo);
    const monthCount = engramIndex.countSince(user.userId, monthAgo);

    const avgConfidence = engramIndex.getAverageConfidence(user.userId);

    const metricsSnapshot = metrics?.snapshot() ?? {
      processed_total: 0,
      blocked_total: 0,
      deduplicated_total: 0,
      errors_total: 0,
    };

    return {
      totalEngrams,
      byStatus: totals,
      captures: { today: todayCount, week: weekCount, month: monthCount },
      avgConfidence: avgConfidence != null ? Math.round(avgConfidence * 1000) / 1000 : 0,
      pipeline: metricsSnapshot,
    };
    } catch (err) {
      req.log.error({ err }, 'Failed to load analytics overview');
      return reply.status(500).send({ error: 'Failed to load analytics' });
    }
  });

  // GET /api/analytics/volume?period=day|week|month — time-series capture volume
  app.get('/api/analytics/volume', async (req, reply) => {
    try {
    const user = (req as any).user;
    const { period } = req.query as { period?: string };

    let days: number;
    switch (period) {
      case 'month':
        days = 30;
        break;
      case 'week':
        days = 7;
        break;
      case 'day':
      default:
        days = 14;
        break;
    }

    const since = new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);

    const rows = engramIndex.getDailyVolume(user.userId, since);

    return { period: period || 'day', days, volume: rows };
    } catch (err) {
      req.log.error({ err }, 'Failed to load analytics volume');
      return reply.status(500).send({ error: 'Failed to load analytics' });
    }
  });

  // GET /api/analytics/sources — breakdown by source type
  app.get('/api/analytics/sources', async (req, reply) => {
    try {
    const user = (req as any).user;

    const rows = engramIndex.getSourceBreakdown(user.userId);

    const total = rows.reduce((s, r) => s + r.count, 0);
    const sources = rows.map((r) => ({
      source: r.source,
      count: r.count,
      percentage: total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0,
    }));

    return { sources };
    } catch (err) {
      req.log.error({ err }, 'Failed to load analytics sources');
      return reply.status(500).send({ error: 'Failed to load analytics' });
    }
  });

  // GET /api/analytics/top-tags?limit=20 — most frequent tags
  app.get('/api/analytics/top-tags', async (req, reply) => {
    try {
    const user = (req as any).user;
    const { limit } = req.query as { limit?: string };
    const maxTags = parseInt(limit || '20', 10);

    const tagStrings = engramIndex.getAllTags(user.userId);

    const tagCounts = new Map<string, number>();
    for (const tagStr of tagStrings) {
      const tags = tagStr.split(/\s+/).filter(Boolean);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    const sorted = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxTags)
      .map(([tag, count]) => ({ tag, count }));

    return { tags: sorted };
    } catch (err) {
      req.log.error({ err }, 'Failed to load analytics top-tags');
      return reply.status(500).send({ error: 'Failed to load analytics' });
    }
  });

  // GET /api/analytics/confidence — confidence distribution
  app.get('/api/analytics/confidence', async (req, reply) => {
    try {
    const user = (req as any).user;

    const rows = engramIndex.getConfidenceDistribution(user.userId);

    // Ensure all buckets exist
    const buckets = ['0.0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0'];
    const rowMap = new Map(rows.map((r) => [r.range, r.count]));
    const distribution = buckets.map((range) => ({
      range,
      count: rowMap.get(range) ?? 0,
    }));

    return { distribution };
    } catch (err) {
      req.log.error({ err }, 'Failed to load analytics confidence');
      return reply.status(500).send({ error: 'Failed to load analytics' });
    }
  });
}
