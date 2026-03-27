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

  app.get('/api/settings', async (req) => {
    const user = (req as any).user;
    return settingsStore.get(user.userId);
  });

  app.patch('/api/settings', async (req) => {
    const user = (req as any).user;
    const body = req.body as Partial<{
      notificationNewEngram: number;
      notificationSound: number;
      autoApproveConfidence: number;
      theme: string;
      itemsPerPage: number;
    }>;

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
