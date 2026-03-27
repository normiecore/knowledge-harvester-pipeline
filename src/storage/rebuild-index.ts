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
export async function rebuildIndex(
  muninnClient: MuninnDBClient,
  engramIndex: EngramIndex,
  userIds: string[],
): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  for (const userId of userIds) {
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
          });
          synced++;
        } catch (err) {
          console.warn(`Failed to parse/index engram ${raw.id} in vault ${vault}:`, err);
          errors++;
        }
      }
    } catch (err) {
      console.warn(`Failed to list engrams from vault ${vault}:`, err);
      errors++;
    }
  }

  return { synced, errors };
}
