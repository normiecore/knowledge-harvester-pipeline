import { logger } from '../config/logger.js';
import type { MuninnDBClient } from './muninndb-client.js';
import type { EngramIndex } from './engram-index.js';
import { VaultManager } from './vault-manager.js';
import type { HarvesterEngram } from '../types.js';

/**
 * Rebuild the local SQLite engram index from MuninnDB (the source of truth).
 *
 * This is safe to call on startup or any time the local index may have drifted.
 * It reads all engrams from every known personal vault and upserts them into
 * the local index. Because the index uses upsert semantics, running this
 * multiple times is idempotent.
 *
 * @param muninnClient - The MuninnDB client to read from
 * @param engramIndex  - The local SQLite index to repopulate
 * @param userIds      - List of user IDs whose vaults should be synced.
 *                       If empty, skips rebuild (no users to sync).
 */
/** Maximum number of user vaults to sync concurrently. */
const REBUILD_CONCURRENCY = 5;

export async function rebuildIndex(
  muninnClient: MuninnDBClient,
  engramIndex: EngramIndex,
  userIds: string[],
): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  /** Process a single user vault: list engrams, parse, and upsert into local index. */
  async function syncVault(userId: string): Promise<{ synced: number; errors: number }> {
    let vaultSynced = 0;
    let vaultErrors = 0;
    const vault = VaultManager.personalVault(userId);

    try {
      const engrams = await muninnClient.listAll(vault);

      for (const raw of engrams) {
        try {
          const engram: HarvesterEngram = JSON.parse(raw.content);
          engramIndex.upsert({
            id: raw.id,
            userId: engram.user_id,
            concept: engram.concept,
            approvalStatus: engram.approval_status,
            capturedAt: engram.captured_at,
            sourceType: engram.source_type,
            confidence: engram.confidence,
            tags: engram.tags,
          });
          vaultSynced++;
        } catch (err) {
          logger.warn({ engramId: raw.id, vault, err }, 'Failed to parse/index engram');
          vaultErrors++;
        }
      }
    } catch (err) {
      logger.warn({ vault, err }, 'Failed to list engrams from vault');
      vaultErrors++;
    }

    return { synced: vaultSynced, errors: vaultErrors };
  }

  // Process user vaults in concurrent batches
  for (let i = 0; i < userIds.length; i += REBUILD_CONCURRENCY) {
    const batch = userIds.slice(i, i + REBUILD_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((uid) => syncVault(uid)));

    for (const outcome of results) {
      if (outcome.status === 'fulfilled') {
        synced += outcome.value.synced;
        errors += outcome.value.errors;
      } else {
        logger.warn({ err: outcome.reason }, 'Vault sync failed unexpectedly');
        errors++;
      }
    }
  }

  return { synced, errors };
}
