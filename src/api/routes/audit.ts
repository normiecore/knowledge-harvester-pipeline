import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { AuditStore } from '../../storage/audit-store.js';

interface AuditRoutesOpts extends FastifyPluginOptions {
  auditStore: AuditStore;
}

export async function auditRoutes(
  app: FastifyInstance,
  opts: AuditRoutesOpts,
): Promise<void> {
  const { auditStore } = opts;

  // GET /api/audit — Query audit log with filters
  app.get('/api/audit', async (req, reply) => {
    const user = (req as any).user;

    // Admin-only: only users with role 'admin' may view audit logs.
    // If no role info is available on the auth context, allow access
    // (the preHandler already enforces authentication).
    if (user.role && user.role !== 'admin') {
      reply.code(403);
      return { error: 'Admin access required' };
    }

    const { userId, action, resourceType, from, to, limit, offset } = req.query as {
      userId?: string;
      action?: string;
      resourceType?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };

    return auditStore.query({
      userId,
      action,
      resourceType,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  });

  // GET /api/audit/actions — List distinct action types for filter dropdowns
  app.get('/api/audit/actions', async (req, reply) => {
    const user = (req as any).user;

    if (user.role && user.role !== 'admin') {
      reply.code(403);
      return { error: 'Admin access required' };
    }

    return { actions: auditStore.getDistinctActions() };
  });
}
