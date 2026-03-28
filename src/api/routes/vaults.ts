import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { EngramIndex, VaultQueryFilter } from '../../storage/engram-index.js';
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
  // Personal vaults — one per user_id
  const userRows = engramIndex.getUserCounts();

  const personal: VaultInfo[] = userRows.map((r) => ({
    name: VaultManager.personalVault(r.user_id),
    type: 'personal' as const,
    owner: r.user_id,
    engramCount: r.count,
  }));

  // Department vaults — one per department (excluding 'unassigned')
  const deptRows = engramIndex.getDepartmentCounts();

  const department: VaultInfo[] = deptRows.map((r) => ({
    name: VaultManager.deptVault(r.department),
    type: 'department' as const,
    owner: r.department,
    engramCount: r.count,
  }));

  // Org vault — all approved engrams
  const orgCount = engramIndex.countApproved();

  const org: VaultInfo[] = orgCount > 0
    ? [{
        name: VaultManager.orgVault(),
        type: 'org' as const,
        owner: 'organization',
        engramCount: orgCount,
      }]
    : [];

  return { personal, department, org };
}

/**
 * Resolve a vault name to a WHERE clause for querying engram_index.
 * Returns [whereSql, params] or null if the vault name is unrecognised.
 */
function vaultFilter(vaultName: string): VaultQueryFilter | null {
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

    const maxResults = parseInt(limit || '20', 10);
    const offsetNum = parseInt(offset || '0', 10);

    const result = engramIndex.queryVaultEngrams(filter, q, maxResults, offsetNum);
    return result;
  });

  // GET /api/vaults/:name/stats — count, top tags, date range
  app.get('/api/vaults/:name/stats', async (req, reply) => {
    const { name } = req.params as { name: string };

    const filter = vaultFilter(name);
    if (!filter) {
      reply.code(404);
      return { error: 'Unknown vault' };
    }

    return engramIndex.getVaultStats(filter);
  });
}
