import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { EngramIndex } from '../../storage/engram-index.js';
import { generateDigest } from '../../pipeline/digest.js';

interface DigestRoutesOpts extends FastifyPluginOptions {
  engramIndex: EngramIndex;
}

export async function digestRoutes(
  app: FastifyInstance,
  opts: DigestRoutesOpts,
): Promise<void> {
  const { engramIndex } = opts;

  // GET /api/digest?period=daily|weekly
  app.get('/api/digest', async (req, reply) => {
    const user = (req as any).user;
    const { period } = req.query as { period?: string };

    if (period !== 'daily' && period !== 'weekly') {
      reply.code(400);
      return { error: 'period must be "daily" or "weekly"' };
    }

    try {
      const digest = generateDigest(engramIndex, user.userId, period);
      return digest;
    } catch (err) {
      req.log.error({ err }, 'Failed to generate digest');
      return reply.code(500).send({ error: 'Failed to generate digest' });
    }
  });
}
