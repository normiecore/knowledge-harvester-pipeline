import type { MuninnDBClient } from './muninndb-client.js';
import type { HarvesterEngram } from '../types.js';
import { FidelityReducer } from '../pipeline/fidelity-reducer.js';
import type { EngramWithPriority } from '../pipeline/engram-builder.js';

export class VaultManager {
  private client: MuninnDBClient;
  private reducer: FidelityReducer;

  constructor(client: MuninnDBClient) {
    this.client = client;
    this.reducer = new FidelityReducer();
  }

  static personalVault(userId: string): string {
    return `knowledge-harvester-${userId}`;
  }

  static deptVault(department: string): string {
    return `knowledge-harvester-dept-${department}`;
  }

  static orgVault(): string {
    return 'knowledge-harvester-org';
  }

  /**
   * Store a pending engram in the user's personal vault only.
   * Returns the MuninnDB-assigned engram ID.
   */
  async storePending(engram: HarvesterEngram): Promise<string> {
    const vault = VaultManager.personalVault(engram.user_id);
    const result = await this.client.remember(vault, engram.concept, JSON.stringify(engram));
    return result.id;
  }

  /**
   * Store an approved engram in all three vault tiers with fidelity reduction.
   */
  async storeApproved(engram: HarvesterEngram, department: string): Promise<void> {
    const engramWithPriority = engram as EngramWithPriority;

    // Personal vault: full fidelity
    const personalVault = VaultManager.personalVault(engram.user_id);
    await this.client.remember(personalVault, engram.concept, JSON.stringify(engram));

    // Department vault: reduced fidelity
    const deptVault = VaultManager.deptVault(department);
    const deptEngram = this.reducer.toDepartment(engramWithPriority);
    await this.client.remember(deptVault, engram.concept, JSON.stringify(deptEngram));

    // Org vault: minimal fidelity
    const orgVault = VaultManager.orgVault();
    const orgEngram = this.reducer.toOrg(engramWithPriority, department);
    await this.client.remember(orgVault, engram.concept, JSON.stringify(orgEngram));
  }
}
