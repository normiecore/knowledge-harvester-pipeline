import React, { useEffect, useState, useCallback, useRef } from 'react';
import { getEngrams, patchEngram, connectWebSocket } from '../api';
import EngramCard from '../components/EngramCard';

export default function Queue() {
  const [engrams, setEngrams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batchAction, setBatchAction] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [focusIndex, setFocusIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const loadEngrams = useCallback(async () => {
    try {
      setError(null);
      const data = await getEngrams('pending');
      const items = data.engrams || [];
      // Sort by confidence descending so highest-value engrams appear first
      items.sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0));
      setEngrams(items);
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
      }
      if (data.type === 'engram_updated' && (data.status === 'approved' || data.status === 'dismissed')) {
        setEngrams(prev => prev.filter(e => e.id !== data.id));
      }
    });
    return () => ws.close();
  }, [loadEngrams]);

  // Keep focusIndex in bounds when engrams change
  useEffect(() => {
    setFocusIndex(prev => {
      if (engrams.length === 0) return 0;
      return Math.min(prev, engrams.length - 1);
    });
  }, [engrams]);

  // Single engram action used by keyboard shortcuts
  const handleSingleAction = useCallback(async (status: string) => {
    if (engrams.length === 0) return;
    const target = engrams[focusIndex];
    if (!target) return;
    try {
      await patchEngram(target.id, status);
      setEngrams(prev => prev.filter(e => e.id !== target.id));
    } catch (err) {
      console.error('Action failed:', err);
    }
  }, [engrams, focusIndex]);

  // Batch action: process engrams sequentially
  const handleBatchAction = useCallback(async (status: string) => {
    if (engrams.length === 0 || batchAction) return;
    const ids = engrams.map(e => e.id);
    setBatchAction(status);
    setBatchProgress({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i++) {
      try {
        await patchEngram(ids[i], status);
        setBatchProgress({ done: i + 1, total: ids.length });
        setEngrams(prev => prev.filter(e => e.id !== ids[i]));
      } catch (err) {
        console.error(`Batch ${status} failed for ${ids[i]}:`, err);
      }
    }
    setBatchAction(null);
    setBatchProgress({ done: 0, total: 0 });
  }, [engrams, batchAction]);

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
        <div className="page-loading">
          <div className="spinner" />
          <p>Loading engrams...</p>
        </div>
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

  return (
    <div className="page">
      <h2>Review Queue ({engrams.length})</h2>
      <p className="page-subtitle">{engrams.length} engram{engrams.length !== 1 ? 's' : ''} pending review</p>

      {engrams.length > 0 && (
        <div className="queue-toolbar">
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
        <div className="engram-list" ref={listRef}>
          {engrams.map((e, i) => (
            <EngramCard
              key={e.id}
              engram={e}
              onAction={loadEngrams}
              focused={i === focusIndex}
              onFocus={() => setFocusIndex(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
