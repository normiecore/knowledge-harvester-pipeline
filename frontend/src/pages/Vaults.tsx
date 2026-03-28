import React, { useEffect, useState, useCallback } from 'react';
import { getVaults, getVaultEngrams, getVaultStats } from '../api';

interface VaultInfo {
  name: string;
  type: 'personal' | 'department' | 'org';
  owner: string;
  engramCount: number;
}

interface VaultGroups {
  personal: VaultInfo[];
  department: VaultInfo[];
  org: VaultInfo[];
}

interface VaultEngramRow {
  id: string;
  userId: string;
  concept: string;
  approvalStatus: string;
  capturedAt: string;
  sourceType: string;
  confidence: number;
  department?: string;
}

interface VaultStatsData {
  count: number;
  topTags: Array<{ tag: string; count: number }>;
  dateRange: { earliest: string | null; latest: string | null };
}

export default function Vaults() {
  const [vaults, setVaults] = useState<VaultGroups | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected vault state
  const [selectedVault, setSelectedVault] = useState<VaultInfo | null>(null);
  const [engrams, setEngrams] = useState<VaultEngramRow[]>([]);
  const [engramTotal, setEngramTotal] = useState(0);
  const [engramOffset, setEngramOffset] = useState(0);
  const [engramSearch, setEngramSearch] = useState('');
  const [engramLoading, setEngramLoading] = useState(false);
  const [stats, setStats] = useState<VaultStatsData | null>(null);

  const [engramError, setEngramError] = useState<string | null>(null);

  const PAGE_SIZE = 20;

  const loadVaults = useCallback(() => {
    setLoading(true);
    setError(null);
    setVaults(null);
    getVaults()
      .then(setVaults)
      .catch((err) => setError(err?.message || 'Failed to load vaults'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadVaults(); }, [loadVaults]);

  const selectVault = async (vault: VaultInfo) => {
    setSelectedVault(vault);
    setEngramOffset(0);
    setEngramSearch('');
    setEngramLoading(true);
    setEngramError(null);

    try {
      const [engramData, statsData] = await Promise.all([
        getVaultEngrams(vault.name, PAGE_SIZE, 0),
        getVaultStats(vault.name),
      ]);
      setEngrams(engramData.engrams);
      setEngramTotal(engramData.total);
      setStats(statsData);
    } catch {
      setEngrams([]);
      setEngramTotal(0);
      setStats(null);
      setEngramError('Failed to load vault contents. Check your connection and try again.');
    } finally {
      setEngramLoading(false);
    }
  };

  const loadPage = async (newOffset: number) => {
    if (!selectedVault) return;
    setEngramLoading(true);
    setEngramError(null);
    setEngramOffset(newOffset);
    try {
      const data = await getVaultEngrams(selectedVault.name, PAGE_SIZE, newOffset, engramSearch || undefined);
      setEngrams(data.engrams);
      setEngramTotal(data.total);
    } catch {
      setEngrams([]);
      setEngramError('Failed to load engrams. Check your connection and try again.');
    } finally {
      setEngramLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVault) return;
    setEngramLoading(true);
    setEngramError(null);
    setEngramOffset(0);
    try {
      const data = await getVaultEngrams(selectedVault.name, PAGE_SIZE, 0, engramSearch || undefined);
      setEngrams(data.engrams);
      setEngramTotal(data.total);
    } catch {
      setEngrams([]);
      setEngramError('Search failed. Check your connection and try again.');
    } finally {
      setEngramLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page page-loading">
        <div className="spinner" />
        <span>Loading vaults...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-retry" onClick={loadVaults}>Retry</button>
        </div>
      </div>
    );
  }

  // Detail view for selected vault
  if (selectedVault) {
    const totalPages = Math.ceil(engramTotal / PAGE_SIZE);
    const currentPage = Math.floor(engramOffset / PAGE_SIZE) + 1;

    return (
      <div className="page vaults-page">
        <button className="btn-back" onClick={() => setSelectedVault(null)}>
          &larr; Back to Vaults
        </button>
        <h2>{selectedVault.name}</h2>
        <p className="page-subtitle">
          {selectedVault.type} vault &middot; {selectedVault.owner}
        </p>

        <div className="vault-detail-layout">
          <div className="vault-detail-main">
            <form className="search-form" onSubmit={handleSearch}>
              <input
                className="search-input"
                type="text"
                placeholder="Search engrams in vault..."
                value={engramSearch}
                onChange={(e) => setEngramSearch(e.target.value)}
              />
              <button className="btn-search" type="submit">Search</button>
            </form>

            {engramError && (
              <div className="error-state">
                <p>{engramError}</p>
                <button className="btn-retry" onClick={() => selectedVault && selectVault(selectedVault)}>Retry</button>
              </div>
            )}

            {!engramError && engramLoading ? (
              <div className="page-loading">
                <div className="spinner" />
              </div>
            ) : !engramError && engrams.length === 0 ? (
              <div className="empty-state">No engrams found</div>
            ) : !engramError ? (
              <>
                <div className="engram-list">
                  {engrams.map((e) => {
                    const confClass = e.confidence >= 0.7 ? 'high' : e.confidence >= 0.4 ? 'medium' : 'low';
                    return (
                      <div className="engram-card" key={e.id}>
                        <div className="engram-header">
                          <div className="engram-info">
                            <div className="engram-title">{e.concept}</div>
                            <div className="engram-meta">
                              <span className={`confidence-badge ${confClass}`}>
                                {(e.confidence * 100).toFixed(0)}%
                              </span>
                              <span className="engram-separator">&middot;</span>
                              <span>{e.sourceType}</span>
                              <span className="engram-separator">&middot;</span>
                              <span>{new Date(e.capturedAt).toLocaleDateString()}</span>
                              <span className="engram-separator">&middot;</span>
                              <span>{e.approvalStatus}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {totalPages > 1 && (
                  <div className="users-pagination">
                    <button
                      disabled={currentPage <= 1}
                      onClick={() => loadPage(engramOffset - PAGE_SIZE)}
                    >
                      Previous
                    </button>
                    <span>Page {currentPage} of {totalPages}</span>
                    <button
                      disabled={currentPage >= totalPages}
                      onClick={() => loadPage(engramOffset + PAGE_SIZE)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            ) : null}
          </div>

          {stats && (
            <aside className="vault-stats-sidebar">
              <div className="vault-stats-card">
                <span className="vault-stats-value">{stats.count}</span>
                <span className="vault-stats-label">Total Engrams</span>
              </div>

              {stats.dateRange.earliest && (
                <div className="vault-stats-card">
                  <span className="vault-stats-label">Date Range</span>
                  <span className="vault-stats-range">
                    {new Date(stats.dateRange.earliest).toLocaleDateString()}
                    {' - '}
                    {stats.dateRange.latest ? new Date(stats.dateRange.latest).toLocaleDateString() : 'now'}
                  </span>
                </div>
              )}

              {stats.topTags.length > 0 && (
                <div className="vault-stats-card">
                  <span className="vault-stats-label">Top Tags</span>
                  <div className="vault-tag-list">
                    {stats.topTags.slice(0, 10).map((t) => (
                      <span className="tag tag-sm" key={t.tag}>
                        {t.tag} <span className="vault-tag-count">{t.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    );
  }

  // Grid view
  const renderSection = (title: string, items: VaultInfo[], icon: string) => {
    if (items.length === 0) return null;
    return (
      <div className="vault-section">
        <h3 className="vault-section-title">{icon} {title}</h3>
        <div className="vault-grid">
          {items.map((v) => (
            <div
              className="vault-card"
              key={v.name}
              onClick={() => selectVault(v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') selectVault(v); }}
            >
              <div className="vault-card-name">{v.name}</div>
              <div className="vault-card-meta">
                <span className="vault-card-owner">{v.owner}</span>
                <span className="vault-card-count">{v.engramCount} engrams</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="page vaults-page">
      <h2>Vaults</h2>
      <p className="page-subtitle">Browse MuninnDB vault tiers</p>

      {renderSection('Personal Vaults', vaults?.personal ?? [], '\u{1F464}')}
      {renderSection('Department Vaults', vaults?.department ?? [], '\u{1F3E2}')}
      {renderSection('Organization Vault', vaults?.org ?? [], '\u{1F30D}')}

      {(vaults?.personal.length === 0 && vaults?.department.length === 0 && vaults?.org.length === 0) && (
        <div className="empty-state">No vaults found. Vaults are created when engrams are stored.</div>
      )}
    </div>
  );
}
