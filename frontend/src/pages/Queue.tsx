import React, { useEffect, useState, useCallback, useRef } from 'react';
import { getEngrams, patchEngram, bulkEngramAction, connectWebSocket } from '../api';
import EngramCard from '../components/EngramCard';
import { SkeletonCard } from '../components/Skeleton';
import { useToast } from '../components/Toast';

export default function Queue() {
  const [engrams, setEngrams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batchAction, setBatchAction] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [focusIndex, setFocusIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();

  const loadEngrams = useCallback(async () => {
    try {
      setError(null);
      const data = await getEngrams('pending');
      const items = data.engrams || [];
      // Sort by confidence descending so highest-value engrams appear first
      items.sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0));
      setEngrams(items);
      setSelected(new Set());
    } catch (err) {
      console.error('Failed to load engrams:', err);
      setError('Failed to load engrams. Check your connection and try again.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEngrams();
    const ws = connectWebSocket((data) => {
      if (data.type === 'new_engram') {
        loadEngrams(); // reload on new engram
        addToast('info', 'New engram received', data.concept || 'A new knowledge item arrived for review.');
      }
      if (data.type === 'engram_updated' && (data.status === 'approved' || data.status === 'dismissed')) {
        setEngrams(prev => prev.filter(e => e.id !== data.id));
        setSelected(prev => {
          const next = new Set(prev);
          next.delete(data.id);
          return next;
        });
      }
    });
    return () => ws.close();
  }, [loadEngrams, addToast]);

  // Keep focusIndex in bounds when engrams change
  useEffect(() => {
    setFocusIndex(prev => {
      if (engrams.length === 0) return 0;
      return Math.min(prev, engrams.length - 1);
    });
  }, [engrams]);

  // Toggle selection for a single engram
  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Select all / deselect all
  const toggleSelectAll = useCallback(() => {
    if (selected.size === engrams.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(engrams.map(e => e.id)));
    }
  }, [engrams, selected.size]);

  // Single engram action used by keyboard shortcuts
  const handleSingleAction = useCallback(async (status: string) => {
    if (engrams.length === 0) return;
    const target = engrams[focusIndex];
    if (!target) return;
    try {
      await patchEngram(target.id, status);
      setEngrams(prev => prev.filter(e => e.id !== target.id));
      setSelected(prev => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      addToast('success', `Engram ${status}`, target.concept || 'Engram updated successfully.');
    } catch (err) {
      console.error('Action failed:', err);
      addToast('error', 'Action failed', 'Could not update the engram. Try again.');
    }
  }, [engrams, focusIndex, addToast]);

  // Bulk action on selected engrams via bulk API
  const handleBulkSelected = useCallback(async (action: 'approve' | 'dismiss') => {
    if (selected.size === 0 || batchAction) return;
    const ids = Array.from(selected);
    const status = action === 'approve' ? 'approved' : 'dismissed';
    setBatchAction(status);
    setBatchProgress({ done: 0, total: ids.length });
    try {
      const result = await bulkEngramAction(ids, action);
      setBatchProgress({ done: result.processed + result.failed, total: ids.length });
      // Remove processed engrams from the list
      setEngrams(prev => prev.filter(e => !selected.has(e.id)));
      setSelected(new Set());
      if (result.failed === 0) {
        addToast('success', `Bulk ${action}`, `All ${result.processed} engrams ${status} successfully.`);
      } else {
        addToast('warning', `Bulk ${action} partial`, `${result.processed} succeeded, ${result.failed} failed.`);
      }
    } catch {
      addToast('error', `Bulk ${action} failed`, 'Could not process the bulk action. Try again.');
    }
    setBatchAction(null);
    setBatchProgress({ done: 0, total: 0 });
  }, [selected, batchAction, addToast]);

  // Batch action: process ALL engrams (legacy approve/dismiss all)
  const handleBatchAction = useCallback(async (status: string) => {
    if (engrams.length === 0 || batchAction) return;
    const ids = engrams.map(e => e.id);
    const action = status === 'approved' ? 'approve' : 'dismiss';
    setBatchAction(status);
    setBatchProgress({ done: 0, total: ids.length });
    try {
      const result = await bulkEngramAction(ids, action as 'approve' | 'dismiss');
      setBatchProgress({ done: result.processed + result.failed, total: ids.length });
      setEngrams([]);
      setSelected(new Set());
      if (result.failed === 0) {
        addToast('success', `Batch ${status}`, `All ${result.processed} engrams ${status} successfully.`);
      } else {
        addToast('warning', `Batch ${status} partial`, `${result.processed} succeeded, ${result.failed} failed.`);
      }
    } catch {
      addToast('error', `Batch ${status} failed`, 'Could not process the batch action. Try again.');
    }
    setBatchAction(null);
    setBatchProgress({ done: 0, total: 0 });
  }, [engrams, batchAction, addToast]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (batchAction) return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          setFocusIndex(prev => Math.min(prev + 1, engrams.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setFocusIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'a':
          e.preventDefault();
          handleSingleAction('approved');
          break;
        case 'd':
          e.preventDefault();
          handleSingleAction('dismissed');
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [engrams.length, batchAction, handleSingleAction]);

  // Scroll focused card into view
  useEffect(() => {
    if (!listRef.current) return;
    const cards = listRef.current.querySelectorAll('.engram-card');
    const card = cards[focusIndex] as HTMLElement | undefined;
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIndex]);

  if (loading) {
    return (
      <div className="page">
        <h2>Review Queue</h2>
        <p className="page-subtitle">Loading engrams...</p>
        <SkeletonCard count={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h2>Review Queue</h2>
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-retry" onClick={loadEngrams}>Retry</button>
        </div>
      </div>
    );
  }

  const allSelected = engrams.length > 0 && selected.size === engrams.length;
  const someSelected = selected.size > 0;

  return (
    <div className="page">
      <h2>Review Queue (<span role="status">{engrams.length}</span>)</h2>
      <p className="page-subtitle">{engrams.length} engram{engrams.length !== 1 ? 's' : ''} pending review</p>

      {engrams.length > 0 && (
        <div className="queue-toolbar">
          <div className="queue-toolbar-left">
            <label className="queue-select-all" aria-label="Select all engrams">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                onChange={toggleSelectAll}
              />
              <span className="queue-select-all-label">
                {someSelected ? `${selected.size} selected` : 'Select all'}
              </span>
            </label>
            {someSelected && (
              <div className="bulk-selected-actions">
                <button
                  className="btn-approve"
                  disabled={!!batchAction}
                  onClick={() => handleBulkSelected('approve')}
                >
                  {batchAction === 'approved'
                    ? `Approving ${batchProgress.done}/${batchProgress.total}...`
                    : `Approve ${selected.size}`}
                </button>
                <button
                  className="btn-dismiss"
                  disabled={!!batchAction}
                  onClick={() => handleBulkSelected('dismiss')}
                >
                  {batchAction === 'dismissed'
                    ? `Dismissing ${batchProgress.done}/${batchProgress.total}...`
                    : `Dismiss ${selected.size}`}
                </button>
              </div>
            )}
            {!someSelected && (
              <div className="batch-actions">
                <button
                  className="btn-approve"
                  disabled={!!batchAction}
                  onClick={() => handleBatchAction('approved')}
                >
                  {batchAction === 'approved'
                    ? `Approving ${batchProgress.done}/${batchProgress.total}...`
                    : 'Approve All'}
                </button>
                <button
                  className="btn-dismiss"
                  disabled={!!batchAction}
                  onClick={() => handleBatchAction('dismissed')}
                >
                  {batchAction === 'dismissed'
                    ? `Dismissing ${batchProgress.done}/${batchProgress.total}...`
                    : 'Dismiss All'}
                </button>
              </div>
            )}
          </div>
          <div className="keyboard-hints">
            <span className="kbd">j</span><span className="kbd-label">/</span><span className="kbd">k</span><span className="kbd-label"> navigate</span>
            <span className="kbd-spacer" />
            <span className="kbd">a</span><span className="kbd-label"> approve</span>
            <span className="kbd-spacer" />
            <span className="kbd">d</span><span className="kbd-label"> dismiss</span>
          </div>
        </div>
      )}

      {engrams.length === 0 ? (
        <div className="empty-state">
          <p>No pending engrams. New knowledge will appear here as it's captured.</p>
        </div>
      ) : (
        <div className="engram-list" ref={listRef} aria-live="polite" aria-keyshortcuts="j k a d">
          {engrams.map((e, i) => (
            <div key={e.id} className="engram-card-row">
              <label className="engram-checkbox" onClick={(ev) => ev.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(e.id)}
                  onChange={() => toggleSelect(e.id)}
                  aria-label={`Select ${e.concept || 'engram'}`}
                />
              </label>
              <EngramCard
                engram={e}
                onAction={loadEngrams}
                focused={i === focusIndex}
                onFocus={() => setFocusIndex(i)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
