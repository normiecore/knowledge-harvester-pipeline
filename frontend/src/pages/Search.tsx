import React, { useState, useEffect, useCallback } from 'react';
import { getEngrams, getDepartments } from '../api';
import type { EngramFilters } from '../api';
import EngramCard from '../components/EngramCard';
import { SkeletonCard } from '../components/Skeleton';

const SOURCE_TYPES = ['mail', 'teams', 'calendar', 'onedrive', 'todo', 'desktop'] as const;
const PAGE_SIZE = 20;

export default function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Facet state
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [confidenceMin, setConfidenceMin] = useState('');
  const [confidenceMax, setConfidenceMax] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [facetsOpen, setFacetsOpen] = useState(true);

  useEffect(() => {
    getDepartments()
      .then((data) => {
        const depts = data.departments || data || [];
        setDepartments(Array.isArray(depts) ? depts : []);
      })
      .catch(() => {});
  }, []);

  const buildFilters = useCallback(
    (pageNum: number): EngramFilters => {
      const filters: EngramFilters = {
        limit: PAGE_SIZE,
        offset: (pageNum - 1) * PAGE_SIZE,
      };
      if (query.trim()) filters.q = query.trim();
      if (selectedSources.size === 1) {
        filters.source = [...selectedSources][0];
      }
      if (dateFrom) filters.from = dateFrom;
      if (dateTo) filters.to = dateTo;
      if (confidenceMin !== '') {
        const val = parseFloat(confidenceMin);
        if (!isNaN(val)) filters.confidence_min = val;
      }
      if (confidenceMax !== '') {
        const val = parseFloat(confidenceMax);
        if (!isNaN(val)) filters.confidence_max = val;
      }
      if (selectedDepartment) filters.department = selectedDepartment;
      return filters;
    },
    [query, selectedSources, dateFrom, dateTo, confidenceMin, confidenceMax, selectedDepartment],
  );

  const executeSearch = async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const filters = buildFilters(pageNum);
      const data = await getEngrams(filters);
      setResults(data.engrams || []);
      setTotal(data.total ?? (data.engrams || []).length);
      setPage(pageNum);
    } catch (err) {
      setResults([]);
      setTotal(0);
      setError('Search failed. Check your connection and try again.');
    }
    setSearched(true);
    setLoading(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeSearch(1);
  };

  const toggleSource = (src: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  };

  const clearFilters = () => {
    setSelectedSources(new Set());
    setDateFrom('');
    setDateTo('');
    setConfidenceMin('');
    setConfidenceMax('');
    setSelectedDepartment('');
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page search-page">
      <h2>Search Knowledge</h2>
      <p className="page-subtitle">Find knowledge across all captured engrams</p>

      <form onSubmit={handleSearch} className="search-form" role="search">
        <input
          type="text"
          className="search-input"
          placeholder="Search engrams... (e.g. 'pipe stress analysis')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search engrams"
        />
        <button type="submit" className="btn-search" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {/* Faceted search panel */}
      <div className="search-facets">
        <button
          type="button"
          className="facets-toggle"
          onClick={() => setFacetsOpen(!facetsOpen)}
          aria-expanded={facetsOpen}
        >
          {facetsOpen ? 'Hide Filters' : 'Show Filters'}
        </button>

        {facetsOpen && (
          <div className="facets-panel">
            {/* Source filter */}
            <div className="facet-group">
              <span className="facet-label">Source</span>
              <div className="facet-checkboxes">
                {SOURCE_TYPES.map((src) => (
                  <label key={src} className="facet-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedSources.has(src)}
                      onChange={() => toggleSource(src)}
                    />
                    <span className="facet-checkbox-text">{src}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Date range */}
            <div className="facet-group">
              <span className="facet-label">Date Range</span>
              <div className="facet-row">
                <input
                  type="date"
                  className="facet-input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  aria-label="Date from"
                />
                <span className="facet-separator">to</span>
                <input
                  type="date"
                  className="facet-input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  aria-label="Date to"
                />
              </div>
            </div>

            {/* Confidence range */}
            <div className="facet-group">
              <span className="facet-label">Confidence (0-1)</span>
              <div className="facet-row">
                <input
                  type="number"
                  className="facet-input facet-input-sm"
                  value={confidenceMin}
                  onChange={(e) => setConfidenceMin(e.target.value)}
                  placeholder="Min"
                  min="0"
                  max="1"
                  step="0.05"
                  aria-label="Minimum confidence"
                />
                <span className="facet-separator">to</span>
                <input
                  type="number"
                  className="facet-input facet-input-sm"
                  value={confidenceMax}
                  onChange={(e) => setConfidenceMax(e.target.value)}
                  placeholder="Max"
                  min="0"
                  max="1"
                  step="0.05"
                  aria-label="Maximum confidence"
                />
              </div>
            </div>

            {/* Department filter */}
            <div className="facet-group">
              <span className="facet-label">Department</span>
              <select
                className="facet-select"
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                aria-label="Filter by department"
              >
                <option value="">All departments</option>
                {departments.map((dept) => (
                  <option key={dept} value={dept}>
                    {dept}
                  </option>
                ))}
              </select>
            </div>

            <button type="button" className="btn-clear-filters" onClick={clearFilters}>
              Clear Filters
            </button>
          </div>
        )}
      </div>

      {loading && <SkeletonCard count={3} />}

      {error && (
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-retry" onClick={() => executeSearch(page)}>Retry</button>
        </div>
      )}

      {!loading && !error && !searched && (
        <div className="empty-state">
          <p>Search for knowledge across all captured engrams.</p>
        </div>
      )}

      {!loading && !error && searched && (
        results.length === 0 ? (
          <div className="empty-state">
            <p>No results found.</p>
          </div>
        ) : (
          <>
            <div className="search-results-header">
              <span className="search-results-count">
                {total} result{total !== 1 ? 's' : ''} found
              </span>
            </div>
            <div className="engram-list" role="list">
              {results.map((e, i) => (
                <div role="listitem" key={e.id || i}>
                  <EngramCard engram={e} showActions={false} />
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="search-pagination">
                <button
                  disabled={page <= 1}
                  onClick={() => executeSearch(page - 1)}
                >
                  Prev
                </button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => executeSearch(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
