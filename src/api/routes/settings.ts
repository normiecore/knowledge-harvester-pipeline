import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { SettingsStore } from '../../storage/settings-store.js';
import type { AuditStore } from '../../storage/audit-store.js';

interface SettingsRoutesOpts extends FastifyPluginOptions {
  settingsStore: SettingsStore;
  auditStore?: AuditStore;
}

export async function settingsRoutes(
  app: FastifyInstance,
  opts: SettingsRoutesOpts,
): Promise<void> {
  const { settingsStore, auditStore } = opts;

  app.get('/api/settings', async (req, reply) => {
    const user = (req as any).user;
    if (!user?.userId) return reply.code(401).send({ error: 'Unauthorized' });
    return settingsStore.get(user.userId);
  });

  app.patch('/api/settings', async (req, reply) => {
    const user = (req as any).user;
    if (!user?.userId) return reply.code(401).send({ error: 'Unauthorized' });
    const raw = req.body as Record<string, unknown>;

    // Validate and sanitize inputs
    const body: Record<string, unknown> = {};
    if (raw.notificationNewEngram !== undefined) body.notificationNewEngram = raw.notificationNewEngram ? 1 : 0;
    if (raw.notificationSound !== undefined) body.notificationSound = raw.notificationSound ? 1 : 0;
    if (raw.autoApproveConfidence !== undefined) {
      const c = Number(raw.autoApproveConfidence);
      body.autoApproveConfidence = Math.max(0, Math.min(1, Number.isFinite(c) ? c : 0));
    }
    if (raw.theme !== undefined) {
      body.theme = raw.theme === 'light' ? 'light' : 'dark';
    }
    if (raw.itemsPerPage !== undefined) {
      const allowed = [10, 20, 50, 100];
      const n = Number(raw.itemsPerPage);
      body.itemsPerPage = allowed.includes(n) ? n : 20;
    }

    const updated = settingsStore.update(user.userId, body);

    auditStore?.log({
      userId: user.userId,
      action: 'settings.update',
      resourceType: 'settings',
      details: JSON.stringify(body),
      ipAddress: req.ip,
    });

    return updated;
  });
}
