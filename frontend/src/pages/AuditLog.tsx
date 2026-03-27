import React, { useEffect, useState, useCallback } from 'react';
import { getAuditLog, getAuditActions, getUsers, type AuditFilters } from '../api';
import { SkeletonCard } from '../components/Skeleton';

interface AuditRecord {
  id: number;
  timestamp: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: string | null;
  ipAddress: string | null;
}

interface UserOption {
  id: string;
  displayName: string;
  email: string;
}

export default function AuditLog() {
  const [entries, setEntries] = useState<AuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterUser, setFilterUser] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');

  // Dropdown options
  const [actions, setActions] = useState<string[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);

  // Pagination
  const [page, setPage] = useState(1);
  const limit = 50;

  const loadEntries = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const filters: AuditFilters = {
        limit,
        offset: (page - 1) * limit,
      };
      if (filterUser) filters.userId = filterUser;
      if (filterAction) filters.action = filterAction;
      if (filterFrom) filters.from = filterFrom;
      if (filterTo) filters.to = filterTo;

      const data = await getAuditLog(filters);
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch {
      setError('Failed to load audit log. You may not have admin access.');
    }
    setLoading(false);
  }, [page, filterUser, filterAction, filterFrom, filterTo]);

  const loadDropdowns = useCallback(async () => {
    try {
      const [actionsData, usersData] = await Promise.all([
        getAuditActions(),
        getUsers(1, 200),
      ]);
      setActions(actionsData.actions || []);
      setUsers(
        (usersData.users || []).map((u: any) => ({
          id: u.id,
          displayName: u.displayName,
          email: u.email,
        })),
      );
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);
  useEffect(() => { loadDropdowns(); }, [loadDropdowns]);

  const handleClearFilters = () => {
    setFilterUser('');
    setFilterAction('');
    setFilterFrom('');
    setFilterTo('');
    setPage(1);
  };

  const hasFilters = filterUser || filterAction || filterFrom || filterTo;
  const totalPages = Math.ceil(total / limit);

  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts + 'Z').toLocaleString();
    } catch {
      return ts;
    }
  };

  const formatDetails = (details: string | null) => {
    if (!details) return '--';
    try {
      const obj = JSON.parse(details);
      return Object.entries(obj)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
    } catch {
      return details;
    }
  };

  const getUserLabel = (userId: string) => {
    const u = users.find((usr) => usr.id === userId);
    return u ? (u.displayName || u.email) : userId.slice(0, 12) + '...';
  };

  if (loading && entries.length === 0) {
    return (
      <div className="page audit-page">
        <h2>Audit Log</h2>
        <p className="page-subtitle">Loading...</p>
        <SkeletonCard count={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page audit-page">
        <h2>Audit Log</h2>
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-retry" onClick={loadEntries}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page audit-page">
      <h2>Audit Log</h2>
      <p className="page-subtitle">
        Compliance records -- who did what, when ({total} total entries)
      </p>

      {/* Filters */}
      <div className="audit-filters">
        <div className="audit-filter-group">
          <label className="audit-filter-label">User</label>
          <select
            className="audit-filter-select"
            value={filterUser}
            onChange={(e) => { setFilterUser(e.target.value); setPage(1); }}
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName || u.email || u.id.slice(0, 12)}
              </option>
            ))}
          </select>
        </div>

        <div className="audit-filter-group">
          <label className="audit-filter-label">Action</label>
          <select
            className="audit-filter-select"
            value={filterAction}
            onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
          >
            <option value="">All actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div className="audit-filter-group">
          <label className="audit-filter-label">From</label>
          <input
            type="date"
            className="audit-filter-input"
            value={filterFrom}
            onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
          />
        </div>

        <div className="audit-filter-group">
          <label className="audit-filter-label">To</label>
          <input
            type="date"
            className="audit-filter-input"
            value={filterTo}
            onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
          />
        </div>

        {hasFilters && (
          <button
            className="btn-clear-filters audit-clear-btn"
            onClick={handleClearFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {entries.length === 0 ? (
        <div className="empty-state">No audit entries found.</div>
      ) : (
        <>
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="audit-row">
                    <td className="audit-ts">{formatTimestamp(entry.timestamp)}</td>
                    <td className="audit-user" title={entry.userId}>
                      {getUserLabel(entry.userId)}
                    </td>
                    <td>
                      <span className="audit-action-badge">{entry.action}</span>
                    </td>
                    <td className="audit-resource">
                      {entry.resourceType}
                      {entry.resourceId && (
                        <span className="audit-resource-id" title={entry.resourceId}>
                          /{entry.resourceId.slice(0, 8)}
                        </span>
                      )}
                    </td>
                    <td className="audit-details" title={entry.details ?? ''}>
                      {formatDetails(entry.details)}
                    </td>
                    <td className="audit-ip">{entry.ipAddress || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="audit-pagination">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
