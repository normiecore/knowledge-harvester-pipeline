export function getToken(): string {
  return localStorage.getItem('mycelium_token') || '';
}

export function setToken(token: string): void {
  localStorage.setItem('mycelium_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('mycelium_token');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export async function fetchWithAuth(path: string, opts?: RequestInit): Promise<Response> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      ...opts?.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
  }
  return res;
}

async function fetchAPI(path: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      ...opts?.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface EngramFilters {
  status?: string;
  q?: string;
  source?: string;
  from?: string;
  to?: string;
  confidence_min?: number;
  confidence_max?: number;
  department?: string;
  limit?: number;
  offset?: number;
}

export async function getEngrams(statusOrFilters?: string | EngramFilters, q?: string): Promise<any> {
  const params = new URLSearchParams();

  if (typeof statusOrFilters === 'string') {
    // Legacy two-arg signature: getEngrams(status?, q?)
    if (statusOrFilters) params.set('status', statusOrFilters);
    if (q) params.set('q', q);
  } else if (statusOrFilters) {
    const f = statusOrFilters;
    if (f.status) params.set('status', f.status);
    if (f.q) params.set('q', f.q);
    if (f.source) params.set('source', f.source);
    if (f.from) params.set('from', f.from);
    if (f.to) params.set('to', f.to);
    if (f.confidence_min !== undefined) params.set('confidence_min', String(f.confidence_min));
    if (f.confidence_max !== undefined) params.set('confidence_max', String(f.confidence_max));
    if (f.department) params.set('department', f.department);
    if (f.limit !== undefined) params.set('limit', String(f.limit));
    if (f.offset !== undefined) params.set('offset', String(f.offset));
  }

  return fetchAPI(`/api/engrams?${params}`);
}

export async function patchEngram(id: string, approvalStatus: string, department?: string): Promise<any> {
  const body: Record<string, string> = { approval_status: approvalStatus };
  if (department !== undefined) body.department = department;
  return fetchAPI(`/api/engrams/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function getEngramDetail(id: string): Promise<any> {
  return fetchAPI(`/api/engrams/${id}`);
}

export async function getStats(): Promise<any> {
  return fetchAPI('/api/stats');
}

export async function getAnalyticsOverview(): Promise<any> {
  return fetchAPI('/api/analytics/overview');
}

export async function getAnalyticsVolume(period: string = 'day'): Promise<any> {
  return fetchAPI(`/api/analytics/volume?period=${period}`);
}

export async function getAnalyticsSources(): Promise<any> {
  return fetchAPI('/api/analytics/sources');
}

export async function getAnalyticsTopTags(limit: number = 20): Promise<any> {
  return fetchAPI(`/api/analytics/top-tags?limit=${limit}`);
}

export async function getAnalyticsConfidence(): Promise<any> {
  return fetchAPI('/api/analytics/confidence');
}

export async function getHealth(): Promise<any> {
  const res = await fetch('/api/health');
  return res.json();
}

// User management
export async function getUsers(page = 1, limit = 20, department?: string, q?: string): Promise<any> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (department) params.set('department', department);
  if (q) params.set('q', q);
  return fetchAPI(`/api/users?${params}`);
}

export async function getUser(id: string): Promise<any> {
  return fetchAPI(`/api/users/${id}`);
}

export async function updateUser(id: string, data: { department?: string; role?: string; harvestingEnabled?: boolean }): Promise<any> {
  return fetchAPI(`/api/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function getDepartments(): Promise<any> {
  return fetchAPI('/api/users/departments');
}

export async function syncUserStats(id: string): Promise<any> {
  return fetchAPI(`/api/users/${id}/sync-stats`, { method: 'POST' });
}

export async function retryDeadLetter(id: string): Promise<any> {
  return fetchAPI(`/api/dead-letters/${id}/retry`, { method: 'POST' });
}

// Audit log
export interface AuditFilters {
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export async function getAuditLog(filters?: AuditFilters): Promise<any> {
  const params = new URLSearchParams();
  if (filters) {
    if (filters.userId) params.set('userId', filters.userId);
    if (filters.action) params.set('action', filters.action);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters.offset !== undefined) params.set('offset', String(filters.offset));
  }
  return fetchAPI(`/api/audit?${params}`);
}

export async function getAuditActions(): Promise<any> {
  return fetchAPI('/api/audit/actions');
}

// Settings
export interface UserSettings {
  userId: string;
  notificationNewEngram: number;
  notificationSound: number;
  autoApproveConfidence: number;
  theme: string;
  itemsPerPage: number;
  updatedAt: string;
}

export async function getSettings(): Promise<UserSettings> {
  return fetchAPI('/api/settings');
}

export async function updateSettings(data: Partial<Omit<UserSettings, 'userId' | 'updatedAt'>>): Promise<UserSettings> {
  return fetchAPI('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// Bulk engram actions
export async function bulkEngramAction(ids: string[], action: 'approve' | 'dismiss'): Promise<{ processed: number; failed: number }> {
  return fetchAPI('/api/engrams/bulk', {
    method: 'POST',
    body: JSON.stringify({ ids, action }),
  });
}

// Vaults
export async function getVaults(): Promise<any> {
  return fetchAPI('/api/vaults');
}

export async function getVaultEngrams(name: string, limit = 20, offset = 0, q?: string): Promise<any> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  if (q) params.set('q', q);
  return fetchAPI(`/api/vaults/${encodeURIComponent(name)}/engrams?${params}`);
}

export async function getVaultStats(name: string): Promise<any> {
  return fetchAPI(`/api/vaults/${encodeURIComponent(name)}/stats`);
}

// Timeline
export async function getTimeline(date?: string, userId?: string): Promise<any> {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (userId) params.set('userId', userId);
  return fetchAPI(`/api/engrams/timeline?${params}`);
}

// Digest
export async function getDigest(period: 'daily' | 'weekly'): Promise<any> {
  return fetchAPI(`/api/digest?period=${period}`);
}

export interface WebSocketHandle {
  close(): void;
}

/**
 * Connect to the engrams WebSocket with automatic reconnection.
 *
 * Reconnection uses exponential backoff: 1s, 2s, 4s, 8s, ... up to 30s max.
 * The backoff resets once a connection is successfully opened.
 *
 * Note on ping/pong: The server sends WebSocket ping frames every 30s.
 * Browsers handle pong responses automatically at the protocol level --
 * no application-level code is needed on the client side.
 */
export function connectWebSocket(onMessage: (data: any) => void): WebSocketHandle {
  let currentWs: WebSocket | null = null;
  let closed = false;
  let backoffMs = 1000;
  const MAX_BACKOFF_MS = 30_000;

  function connect() {
    if (closed) return;

    const token = getToken();
    if (!token) {
      window.location.href = '/login';
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/engrams?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    currentWs = ws;

    ws.onopen = () => {
      // Reset backoff on successful connection
      backoffMs = 1000;
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onMessage(data);
      } catch {}
    };

    ws.onclose = (event) => {
      if (closed) return;
      if (event.code === 4001) {
        clearToken();
        window.location.href = '/login';
        return;
      }
      // Exponential backoff reconnection
      setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    };
  }

  connect();

  return {
    close() {
      closed = true;
      currentWs?.close();
      currentWs = null;
    },
  };
}
