import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { MuninnDBClient } from '../../storage/muninndb-client.js';
import type { VaultManager } from '../../storage/vault-manager.js';
import type { EngramIndex } from '../../storage/engram-index.js';
import { VaultManager as VM } from '../../storage/vault-manager.js';

interface EngramRoutesOpts extends FastifyPluginOptions {
  muninnClient: MuninnDBClient;
  vaultManager: VaultManager;
  engramIndex: EngramIndex;
}

export async function engramRoutes(
  app: FastifyInstance,
  opts: EngramRoutesOpts,
): Promise<void> {
  const { muninnClient, vaultManager, engramIndex } = opts;

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
      const result = await muninnClient.recall(vault, q);
      return { engrams: result.engrams ?? [] };
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
    const { approval_status, department } = req.body as {
      approval_status: 'approved' | 'dismissed';
      department?: string;
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

    if (approval_status === 'approved' && department) {
      await vaultManager.storeApproved(engram, department);
    } else {
      await muninnClient.remember(vault, existing.concept, JSON.stringify(engram));
    }

    return { status: 'ok', approval_status };
  });
}
