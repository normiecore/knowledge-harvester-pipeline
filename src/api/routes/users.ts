import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { UserStore } from '../../storage/user-store.js';
import type { EngramIndex } from '../../storage/engram-index.js';
import type { AuditStore } from '../../storage/audit-store.js';

interface UserRoutesOpts extends FastifyPluginOptions {
  userStore: UserStore;
  engramIndex: EngramIndex;
  auditStore?: AuditStore;
}

/** Convert SQLite 0/1 integer to boolean for API responses */
function toApiUser<T extends { harvestingEnabled: number }>(
  user: T,
): Omit<T, 'harvestingEnabled'> & { harvestingEnabled: boolean } {
  return { ...user, harvestingEnabled: Boolean(user.harvestingEnabled) };
}

export async function userRoutes(
  app: FastifyInstance,
  opts: UserRoutesOpts,
): Promise<void> {
  const { userStore, engramIndex, auditStore } = opts;

  // GET /api/users — List all users with stats (paginated, filterable)
  app.get('/api/users', async (req) => {
    const { page, limit, department, q } = req.query as {
      page?: string;
      limit?: string;
      department?: string;
      q?: string;
    };

    const pageNum = Math.max(1, parseInt(page || '1', 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit || '20', 10)));

    if (q) {
      const { users: rawUsers, total } = userStore.search(q, pageNum, limitNum);
      const users = rawUsers.map((u) => ({ ...toApiUser(u), stats: userStore.getStats(u.id) }));
      return { users, total, page: pageNum, limit: limitNum };
    }

    const { users: rawUsers, total } = userStore.getAllWithStats(pageNum, limitNum, department);
    const users = rawUsers.map((u) => ({ ...toApiUser(u), stats: u.stats }));
    return { users, total, page: pageNum, limit: limitNum };
  });

  // GET /api/users/departments — List all departments with user counts
  app.get('/api/users/departments', async () => {
    return { departments: userStore.getDepartments() };
  });

  // GET /api/users/:id — Single user detail with full stats
  app.get<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const { id } = req.params;
    const user = userStore.getById(id);
    if (!user) {
      reply.code(404);
      return { error: 'User not found' };
    }

    const stats = userStore.getStats(id);

    // Fetch recent engrams for the detail view
    const recentEngrams = engramIndex.listAll(id, 10);

    return { user: toApiUser(user), stats, recentEngrams };
  });

  // PATCH /api/users/:id — Update department, role, harvesting_enabled
  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const { id } = req.params;
    const body = req.body as {
      department?: string;
      role?: string;
      harvestingEnabled?: boolean;
    };

    const existing = userStore.getById(id);
    if (!existing) {
      reply.code(404);
      return { error: 'User not found' };
    }

    if (body.department !== undefined) {
      userStore.upsert({ id, department: body.department });
    }

    if (body.role !== undefined) {
      const validRoles = ['user', 'admin'];
      if (!validRoles.includes(body.role)) {
        reply.code(400);
        return { error: `Invalid role. Must be one of: ${validRoles.join(', ')}` };
      }
      userStore.updateRole(id, body.role);
    }

    if (body.harvestingEnabled !== undefined) {
      userStore.toggleHarvesting(id, body.harvestingEnabled);

      const caller = (req as any).user;
      auditStore?.log({
        userId: caller.userId,
        action: 'user.toggle_harvesting',
        resourceType: 'user',
        resourceId: id,
        details: JSON.stringify({ harvestingEnabled: body.harvestingEnabled }),
        ipAddress: req.ip,
      });
    }

    // Log general user update for department/role changes
    if (body.department !== undefined || body.role !== undefined) {
      const caller = (req as any).user;
      auditStore?.log({
        userId: caller.userId,
        action: 'user.update',
        resourceType: 'user',
        resourceId: id,
        details: JSON.stringify({
          ...(body.department !== undefined && { department: body.department }),
          ...(body.role !== undefined && { role: body.role }),
        }),
        ipAddress: req.ip,
      });
    }

    const updated = userStore.getById(id);
    return { user: updated ? toApiUser(updated) : updated };
  });

  // POST /api/users/:id/sync-stats — Recalculate stats from engram_index
  app.post<{ Params: { id: string } }>('/api/users/:id/sync-stats', async (req, reply) => {
    const { id } = req.params;

    const existing = userStore.getById(id);
    if (!existing) {
      reply.code(404);
      return { error: 'User not found' };
    }

    // Access the underlying better-sqlite3 database from EngramIndex
    const engramDb = (engramIndex as any).db;
    userStore.updateStats(id, engramDb);

    const stats = userStore.getStats(id);
    return { stats };
  });
}
