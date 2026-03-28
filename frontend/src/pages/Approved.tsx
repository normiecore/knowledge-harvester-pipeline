import React, { useEffect, useState, useCallback, useRef } from 'react';
import { getEngrams, connectWebSocket, getToken } from '../api';
import EngramCard from '../components/EngramCard';
import { SkeletonCard } from '../components/Skeleton';
import { useToast } from '../components/Toast';

export default function Approved() {
  const [engrams, setEngrams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();

  const loadEngrams = useCallback(async () => {
    try {
      setError(null);
      const data = await getEngrams('approved');
      setEngrams(data.engrams || []);
    } catch (err) {
      setError('Failed to load approved engrams. Check your connection and try again.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEngrams();
    const ws = connectWebSocket((data) => {
      if (data.type === 'engram_updated' && data.status === 'approved') {
        loadEngrams();
        addToast('success', 'Engram approved', data.concept || 'A new engram was approved.');
      }
    });
    return () => ws.close();
  }, [loadEngrams, addToast]);

  // Close export dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleExport = async (format: 'csv' | 'json') => {
    setExportOpen(false);
    try {
      const res = await fetch(`/api/engrams/export?format=${format}&status=approved`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `engrams-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('success', 'Export complete', `Downloaded engrams as ${format.toUpperCase()}.`);
    } catch {
      addToast('error', 'Export failed', 'Could not export engrams. Try again.');
    }
  };

  if (loading) {
    return (
      <div className="page">
        <h2>Approved Knowledge</h2>
        <p className="page-subtitle">Loading approved engrams...</p>
        <SkeletonCard count={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h2>Approved Knowledge</h2>
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-retry" onClick={loadEngrams}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2>Approved Knowledge</h2>
        <div className="export-wrapper" ref={exportRef}>
          <button className="export-btn" onClick={() => setExportOpen(!exportOpen)}>
            Export
          </button>
          {exportOpen && (
            <div className="export-dropdown">
              <button onClick={() => handleExport('csv')}>Export CSV</button>
              <button onClick={() => handleExport('json')}>Export JSON</button>
            </div>
          )}
        </div>
      </div>
      <p className="page-subtitle">{engrams.length} approved engram{engrams.length !== 1 ? 's' : ''}</p>
      {engrams.length === 0 ? (
        <div className="empty-state"><p>No approved engrams yet.</p></div>
      ) : (
        <div className="engram-list">
          {engrams.map(e => (
            <EngramCard key={e.id} engram={e} showActions={false} />
          ))}
        </div>
      )}
    </div>
  );
}
