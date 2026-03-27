import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { MuninnDBClient } from '../../storage/muninndb-client.js';
import type { VaultManager } from '../../storage/vault-manager.js';
import type { EngramIndex } from '../../storage/engram-index.js';
import type { WebSocketManager } from '../ws.js';
import type { UserCache } from '../../ingestion/user-cache.js';
import { VaultManager as VM } from '../../storage/vault-manager.js';

interface EngramRoutesOpts extends FastifyPluginOptions {
  muninnClient: MuninnDBClient;
  vaultManager: VaultManager;
  engramIndex: EngramIndex;
  wsManager: WebSocketManager;
  userCache?: UserCache;
}

export async function engramRoutes(
  app: FastifyInstance,
  opts: EngramRoutesOpts,
): Promise<void> {
  const { muninnClient, vaultManager, engramIndex, wsManager, userCache } = opts;

  app.get('/api/engrams', async (req) => {
    const user = (req as any).user;
    const { status, q, limit } = req.query as {
      status?: string;
      q?: string;
      limit?: string;
    };
    const maxResults = parseInt(limit || '20', 10);

    if (status) {
      return { engrams: engramIndex.listByStatus(user.userId, status, maxResults) };
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

      return { engrams: merged.slice(0, maxResults) };
    }

    return { engrams: engramIndex.listAll(user.userId, maxResults) };
  });

  app.get('/api/engrams/:id', async (req) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    return await muninnClient.read(VM.personalVault(user.userId), id);
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

    return { status: 'ok', approval_status };
  });
}
