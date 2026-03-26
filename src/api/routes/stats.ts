import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { MuninnDBClient } from '../../storage/muninndb-client.js';
import { VaultManager } from '../../storage/vault-manager.js';

interface StatsRoutesOpts extends FastifyPluginOptions {
  muninnClient: MuninnDBClient;
}

export async function statsRoutes(
  app: FastifyInstance,
  opts: StatsRoutesOpts,
): Promise<void> {
  const { muninnClient } = opts;

  app.get('/api/stats', async (req) => {
    const user = (req as any).user;
    const vault = VaultManager.personalVault(user.userId);
    const result = await muninnClient.recall(vault, '*');
    return {
      totalEngrams: result.engrams?.length ?? 0,
      userId: user.userId,
    };
  });
}
