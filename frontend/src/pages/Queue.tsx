import React, { useEffect, useState, useCallback } from 'react';
import { getEngrams, connectWebSocket } from '../api';
import EngramCard from '../components/EngramCard';

export default function Queue() {
  const [engrams, setEngrams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEngrams = useCallback(async () => {
    try {
      const data = await getEngrams('pending');
      setEngrams(data.engrams || []);
    } catch (err) {
      console.error('Failed to load engrams:', err);
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

  if (loading) return <div className="page-loading">Loading...</div>;

  return (
    <div className="page">
      <h2>Review Queue</h2>
      <p className="page-subtitle">{engrams.length} engram{engrams.length !== 1 ? 's' : ''} pending review</p>
      {engrams.length === 0 ? (
        <div className="empty-state">
          <p>No pending engrams. The pipeline will surface new knowledge as it arrives.</p>
        </div>
      ) : (
        <div className="engram-list">
          {engrams.map(e => (
            <EngramCard key={e.id} engram={e} onAction={loadEngrams} />
          ))}
        </div>
      )}
    </div>
  );
}
