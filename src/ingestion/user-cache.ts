import type { GraphUser } from './graph-types.js';

export interface CachedUserInfo {
  department: string;
}

const DEFAULT_DEPARTMENT = 'unassigned';

/**
 * In-memory cache mapping Azure AD user IDs to profile fields
 * needed downstream (currently just `department`).
 *
 * Populated during each Graph API poll cycle so the data stays
 * reasonably fresh without extra API calls.
 */
export class UserCache {
  private cache = new Map<string, CachedUserInfo>();

  /** Replace the entire cache with a fresh user list from Graph API. */
  refresh(users: ReadonlyArray<GraphUser>): void {
    const next = new Map<string, CachedUserInfo>();
    for (const user of users) {
      next.set(user.id, {
        department: user.department ?? DEFAULT_DEPARTMENT,
      });
    }
    this.cache = next;
  }

  /** Look up a single user's cached info. */
  get(userId: string): CachedUserInfo | undefined {
    return this.cache.get(userId);
  }

  /** Get the user's department, falling back to 'unassigned'. */
  getDepartment(userId: string): string {
    return this.cache.get(userId)?.department ?? DEFAULT_DEPARTMENT;
  }

  get size(): number {
    return this.cache.size;
  }
}
