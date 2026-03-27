import React, { useState } from 'react';
import { patchEngram } from '../api';

interface EngramCardProps {
  engram: any;
  showActions?: boolean;
  onAction?: () => void;
  focused?: boolean;
  onFocus?: () => void;
}

export default function EngramCard({ engram, showActions = true, onAction, focused = false, onFocus }: EngramCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const confidence = engram.confidence ?? 0;
  const confidenceClass = confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : 'low';

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const handleAction = async (status: string) => {
    setLoading(true);
    try {
      await patchEngram(engram.id, status);
      onAction?.();
    } catch (err) {
      console.error('Action failed:', err);
    }
    setLoading(false);
  };

  // Parse content if it's a JSON string
  let content = engram.content || engram.concept || '';
  let rawText = '';
  let tags: string[] = engram.tags || [];
  let sensitivityClassification = '';
  let sensitivityReasoning = '';

  try {
    const parsed = typeof content === 'string' ? JSON.parse(content) : content;
    content = parsed.content || parsed.concept || content;
    rawText = parsed.raw_text || '';
    tags = parsed.tags || tags;
    sensitivityClassification = parsed.sensitivity_classification || '';
    sensitivityReasoning = parsed.sensitivity_reasoning || '';
  } catch {}

  return (
    <div className={`engram-card ${expanded ? 'expanded' : ''} ${focused ? 'focused' : ''}`} onClick={() => { onFocus?.(); setExpanded(!expanded); }}>
      <div className="engram-header">
        <div className="engram-info">
          <h3 className="engram-title">{engram.concept || 'Untitled'}</h3>
          <div className="engram-meta">
            <span className="engram-source">{engram.sourceType?.replace('graph_', '') || engram.source_app || '—'}</span>
            <span className="engram-separator">&bull;</span>
            <span>{timeAgo(engram.capturedAt || engram.captured_at || new Date().toISOString())}</span>
            <span className="engram-separator">&bull;</span>
            <span className={`confidence-badge ${confidenceClass}`}>{Math.round(confidence * 100)}%</span>
          </div>
        </div>
        {showActions && !expanded && (
          <div className="engram-actions" onClick={e => e.stopPropagation()}>
            <button className="btn-approve" disabled={loading} onClick={() => handleAction('approved')}>Approve</button>
            <button className="btn-dismiss" disabled={loading} onClick={() => handleAction('dismissed')}>Dismiss</button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="engram-details">
          <div className="detail-section">
            <label>Summary</label>
            <p>{content}</p>
          </div>

          {rawText && (
            <div className="detail-section">
              <label>Source Text</label>
              <pre className="raw-text">{typeof rawText === 'string' ? rawText : JSON.stringify(rawText, null, 2)}</pre>
            </div>
          )}

          {tags.length > 0 && (
            <div className="engram-tags">
              {tags.map((tag: string) => <span key={tag} className="tag">{tag}</span>)}
            </div>
          )}

          {sensitivityClassification && (
            <div className="detail-section">
              <label>Sensitivity</label>
              <span className={`sensitivity-badge ${sensitivityClassification}`}>{sensitivityClassification}</span>
              {sensitivityReasoning && <p className="sensitivity-reason">{sensitivityReasoning}</p>}
            </div>
          )}

          {showActions && (
            <div className="engram-actions expanded-actions" onClick={e => e.stopPropagation()}>
              <button className="btn-approve" disabled={loading} onClick={() => handleAction('approved')}>Approve</button>
              <button className="btn-dismiss" disabled={loading} onClick={() => handleAction('dismissed')}>Dismiss</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
