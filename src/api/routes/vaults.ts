import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { EngramIndex } from '../../storage/engram-index.js';
import { VaultManager } from '../../storage/vault-manager.js';

interface VaultRoutesOpts extends FastifyPluginOptions {
  engramIndex: EngramIndex;
}

interface VaultInfo {
  name: string;
  type: 'personal' | 'department' | 'org';
  owner: string;
  engramCount: number;
}

/**
 * Derive vault information from the engram_index table.
 *
 * Since MuninnDB does not expose a "list vaults" endpoint, we reconstruct
 * the vault structure from the user_id and department columns stored in the
 * local SQLite index.  The VaultManager naming conventions are used:
 *   - personal: knowledge-harvester-<userId>
 *   - department: knowledge-harvester-dept-<department>
 *   - org: knowledge-harvester-org
 */
function deriveVaults(engramIndex: EngramIndex): {
  personal: VaultInfo[];
  department: VaultInfo[];
  org: VaultInfo[];
} {
  const db = (engramIndex as any).db;

  // Personal vaults — one per user_id
  const userRows = db.prepare(
    `SELECT user_id, COUNT(*) as count FROM engram_index GROUP BY user_id ORDER BY count DESC`,
  ).all() as Array<{ user_id: string; count: number }>;

  const personal: VaultInfo[] = userRows.map((r) => ({
    name: VaultManager.personalVault(r.user_id),
    type: 'personal' as const,
    owner: r.user_id,
    engramCount: r.count,
  }));

  // Department vaults — one per department (excluding 'unassigned')
  const deptRows = db.prepare(
    `SELECT department, COUNT(*) as count
     FROM engram_index
     WHERE department != 'unassigned' AND approval_status = 'approved'
     GROUP BY department ORDER BY count DESC`,
  ).all() as Array<{ department: string; count: number }>;

  const department: VaultInfo[] = deptRows.map((r) => ({
    name: VaultManager.deptVault(r.department),
    type: 'department' as const,
    owner: r.department,
    engramCount: r.count,
  }));

  // Org vault — all approved engrams
  const orgRow = db.prepare(
    `SELECT COUNT(*) as count FROM engram_index WHERE approval_status = 'approved'`,
  ).get() as { count: number };

  const org: VaultInfo[] = orgRow.count > 0
    ? [{
        name: VaultManager.orgVault(),
        type: 'org' as const,
        owner: 'organization',
        engramCount: orgRow.count,
      }]
    : [];

  return { personal, department, org };
}

/**
 * Resolve a vault name to a WHERE clause for querying engram_index.
 * Returns [whereSql, params] or null if the vault name is unrecognised.
 */
function vaultFilter(vaultName: string): { where: string; params: (string | number)[] } | null {
  // Personal vault: knowledge-harvester-<userId>
  const personalPrefix = 'knowledge-harvester-';
  const deptPrefix = 'knowledge-harvester-dept-';
  const orgName = 'knowledge-harvester-org';

  if (vaultName === orgName) {
    return { where: `approval_status = 'approved'`, params: [] };
  }

  if (vaultName.startsWith(deptPrefix)) {
    const dept = vaultName.slice(deptPrefix.length);
    if (!dept) return null; // empty department name is invalid
    return {
      where: `department = ? AND approval_status = 'approved'`,
      params: [dept],
    };
  }

  if (vaultName.startsWith(personalPrefix)) {
    const userId = vaultName.slice(personalPrefix.length);
    if (!userId) return null; // empty userId is invalid
    return { where: `user_id = ?`, params: [userId] };
  }

  return null;
}

export async function vaultRoutes(
  app: FastifyInstance,
  opts: VaultRoutesOpts,
): Promise<void> {
  const { engramIndex } = opts;

  // GET /api/vaults — list known vaults derived from engram_index
  app.get('/api/vaults', async () => {
    return deriveVaults(engramIndex);
  });

  // GET /api/vaults/:name/engrams — paginated engram list for a vault
  app.get('/api/vaults/:name/engrams', async (req, reply) => {
    const { name } = req.params as { name: string };
    const { limit, offset, q } = req.query as {
      limit?: string;
      offset?: string;
      q?: string;
    };

    const filter = vaultFilter(name);
    if (!filter) {
      reply.code(404);
      return { error: 'Unknown vault' };
    }

    const db = (engramIndex as any).db;
    const maxResults = parseInt(limit || '20', 10);
    const offsetNum = parseInt(offset || '0', 10);

    let where = filter.where;
    const params = [...filter.params];

    if (q) {
      where += ` AND (concept LIKE ? OR tags LIKE ?)`;
      const like = `%${q}%`;
      params.push(like, like);
    }

    const countRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM engram_index WHERE ${where}`,
    ).get(...params) as { cnt: number };

    const engrams = db.prepare(
      `SELECT id, user_id AS userId, concept, approval_status AS approvalStatus,
        captured_at AS capturedAt, source_type AS sourceType, confidence, department
      FROM engram_index
      WHERE ${where}
      ORDER BY captured_at DESC
      LIMIT ? OFFSET ?`,
    ).all(...params, maxResults, offsetNum);

    return { engrams, total: countRow.cnt, limit: maxResults, offset: offsetNum };
  });

  // GET /api/vaults/:name/stats — count, top tags, date range
  app.get('/api/vaults/:name/stats', async (req, reply) => {
    const { name } = req.params as { name: string };

    const filter = vaultFilter(name);
    if (!filter) {
      reply.code(404);
      return { error: 'Unknown vault' };
    }

    const db = (engramIndex as any).db;
    const { where, params } = filter;

    const countRow = db.prepare(
      `SELECT COUNT(*) AS cnt FROM engram_index WHERE ${where}`,
    ).get(...params) as { cnt: number };

    // Date range
    const rangeRow = db.prepare(
      `SELECT MIN(captured_at) AS earliest, MAX(captured_at) AS latest
       FROM engram_index WHERE ${where}`,
    ).get(...params) as { earliest: string | null; latest: string | null };

    // Top tags
    const tagRows = db.prepare(
      `SELECT tags FROM engram_index WHERE ${where} AND tags != ''`,
    ).all(...params) as Array<{ tags: string }>;

    const tagCounts = new Map<string, number>();
    for (const row of tagRows) {
      const tags = row.tags.split(/\s+/).filter(Boolean);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    return {
      count: countRow.cnt,
      topTags,
      dateRange: {
        earliest: rangeRow.earliest,
        latest: rangeRow.latest,
      },
    };
  });
}
