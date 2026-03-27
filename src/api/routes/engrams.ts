import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { MuninnDBClient } from '../../storage/muninndb-client.js';
import type { VaultManager } from '../../storage/vault-manager.js';
import type { EngramIndex } from '../../storage/engram-index.js';
import type { WebSocketManager } from '../ws.js';
import type { UserCache } from '../../ingestion/user-cache.js';
import type { AuditStore } from '../../storage/audit-store.js';
import { VaultManager as VM } from '../../storage/vault-manager.js';

interface EngramRoutesOpts extends FastifyPluginOptions {
  muninnClient: MuninnDBClient;
  vaultManager: VaultManager;
  engramIndex: EngramIndex;
  wsManager: WebSocketManager;
  userCache?: UserCache;
  auditStore?: AuditStore;
}

export async function engramRoutes(
  app: FastifyInstance,
  opts: EngramRoutesOpts,
): Promise<void> {
  const { muninnClient, vaultManager, engramIndex, wsManager, userCache, auditStore } = opts;

  app.get('/api/engrams', async (req) => {
    const user = (req as any).user;
    const {
      status, q, limit, offset,
      source, from, to,
      confidence_min, confidence_max,
      department,
    } = req.query as {
      status?: string;
      q?: string;
      limit?: string;
      offset?: string;
      source?: string;
      from?: string;
      to?: string;
      confidence_min?: string;
      confidence_max?: string;
      department?: string;
    };
    const maxResults = parseInt(limit || '20', 10);
    const offsetNum = parseInt(offset || '0', 10);

    // Check if any facet filters are active (beyond just status or q)
    const hasFacets = source || from || to || confidence_min || confidence_max || department || offset;

    if (hasFacets || (status && q)) {
      // Use faceted query engine for any combination of filters
      const filters = {
        status,
        source,
        from,
        to,
        confidence_min: confidence_min !== undefined ? parseFloat(confidence_min) : undefined,
        confidence_max: confidence_max !== undefined ? parseFloat(confidence_max) : undefined,
        department,
        q,
        limit: maxResults,
        offset: offsetNum,
      };
      return engramIndex.queryFaceted(user.userId, filters);
    }

    if (status) {
      const engrams = engramIndex.listByStatus(user.userId, status, maxResults);
      return { engrams, total: engrams.length, limit: maxResults, offset: 0 };
    }

    if (q) {
      const vault = VM.personalVault(user.userId);

      // Hybrid search: run semantic (MuninnDB) and local FTS5 in parallel
      const [semanticResult, ftsResults] = await Promise.all([
        muninnClient.recall(vault, q).catch(() => ({ engrams: [] as Array<{ id: string; concept: string }> })),
        Promise.resolve(engramIndex.search(user.userId, q, maxResults)),
      ]);

      const semanticEngrams = semanticResult.engrams ?? [];

      // Merge: start with semantic results (better ranking), then append
      // FTS5 matches that were not already returned by semantic search.
      const seenIds = new Set<string>(semanticEngrams.map((e) => e.id));
      const merged = [...semanticEngrams];

      for (const ftsRow of ftsResults) {
        if (!seenIds.has(ftsRow.id)) {
          seenIds.add(ftsRow.id);
          merged.push({
            id: ftsRow.id,
            concept: ftsRow.concept,
          });
        }
      }

      const sliced = merged.slice(0, maxResults);
      return { engrams: sliced, total: merged.length, limit: maxResults, offset: 0 };
    }

    const engrams = engramIndex.listAll(user.userId, maxResults);
    return { engrams, total: engrams.length, limit: maxResults, offset: 0 };
  });

  app.get('/api/engrams/export', async (req, reply) => {
    const user = (req as any).user;
    const { format = 'json', status } = req.query as {
      format?: string;
      status?: string;
    };

    const MAX_EXPORT = 10000;
    const engrams = status
      ? engramIndex.listByStatus(user.userId, status, MAX_EXPORT)
      : engramIndex.listAll(user.userId, MAX_EXPORT);

    auditStore?.log({
      userId: user.userId,
      action: 'engram.export',
      resourceType: 'engram',
      details: JSON.stringify({ format, status: status ?? 'all', count: engrams.length }),
      ipAddress: req.ip,
    });

    if (format === 'csv') {
      const header = 'id,concept,source_type,confidence,tags,approval_status,captured_at';
      const escapeCsv = (val: string) => `"${String(val ?? '').replace(/"/g, '""')}"`;
      const rows = engrams.map((e) =>
        [
          escapeCsv(e.id),
          escapeCsv(e.concept),
          escapeCsv(e.sourceType),
          e.confidence,
          escapeCsv((e.tags ?? []).join(';')),
          escapeCsv(e.approvalStatus),
          escapeCsv(e.capturedAt),
        ].join(','),
      );
      const csv = [header, ...rows].join('\n');
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', 'attachment; filename="engrams-export.csv"');
      return csv;
    }

    return engrams;
  });

  app.get('/api/engrams/:id', async (req) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const result = await muninnClient.read(VM.personalVault(user.userId), id);

    // Enrich with related engrams (by shared tags) and local index metadata
    const related_engrams = engramIndex.findRelatedByTags(user.userId, id, 5);

    return {
      ...result,
      related_engrams,
      source_metadata: result.metadata ?? null,
    };
  });

  app.patch('/api/engrams/:id', async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const { approval_status } = req.body as {
      approval_status: 'approved' | 'dismissed';
    };

    const vault = VM.personalVault(user.userId);
    const existing = await muninnClient.read(vault, id);
    const engram = JSON.parse(existing.content);

    if (engram.user_id !== user.userId) {
      reply.code(403);
      return { error: 'Forbidden' };
    }

    engram.approval_status = approval_status;
    engram.approved_at = new Date().toISOString();
    engram.approved_by = user.userId;

    engramIndex.updateStatus(id, approval_status);

    if (approval_status === 'approved') {
      const department = userCache?.getDepartment(user.userId) ?? 'unassigned';
      await vaultManager.storeApproved(engram, department);
    } else {
      await muninnClient.remember(vault, existing.concept, JSON.stringify(engram));
    }

    wsManager.notify(user.userId, { type: 'engram_updated', id, status: approval_status });

    auditStore?.log({
      userId: user.userId,
      action: approval_status === 'approved' ? 'engram.approve' : 'engram.dismiss',
      resourceType: 'engram',
      resourceId: id,
      details: JSON.stringify({ approval_status }),
      ipAddress: req.ip,
    });

    return { status: 'ok', approval_status };
  });
}
