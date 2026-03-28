import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getEngramDetail, patchEngram } from '../api';
import { useToast } from '../components/Toast';

const SOURCE_LABELS: Record<string, string> = {
  graph_email: 'Email',
  graph_teams: 'Teams',
  graph_calendar: 'Calendar',
  graph_document: 'OneDrive',
  graph_task: 'To-Do',
  desktop_screenshot: 'Screenshot',
  desktop_window: 'Desktop',
};

const SOURCE_ICONS: Record<string, string> = {
  graph_email: '\u2709',
  graph_teams: '\u{1F4AC}',
  graph_calendar: '\u{1F4C5}',
  graph_document: '\u{1F4C4}',
  graph_task: '\u2705',
  desktop_screenshot: '\u{1F4F7}',
  desktop_window: '\u{1F5A5}',
};

function getSourceLabel(sourceType?: string): string {
  if (sourceType && SOURCE_LABELS[sourceType]) return SOURCE_LABELS[sourceType];
  if (sourceType) return sourceType.replace(/^(graph_|desktop_)/, '');
  return 'Unknown';
}

function getSourceIcon(sourceType?: string): string {
  if (sourceType && SOURCE_ICONS[sourceType]) return SOURCE_ICONS[sourceType];
  return '\u{1F4CB}';
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export default function EngramDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [engram, setEngram] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const { addToast } = useToast();
  const [sourceExpanded, setSourceExpanded] = useState(false);

  const loadEngram = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const data = await getEngramDetail(id);
      setEngram(data);
    } catch (err) {
      setError('Failed to load engram detail. Check your connection and try again.');
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadEngram();
  }, [loadEngram]);

  const handleAction = async (status: string) => {
    if (!id) return;
    setActionLoading(true);
    try {
      await patchEngram(id, status);
      if (status === 'approved') {
        addToast('success', 'Approved');
      } else {
        addToast('info', 'Dismissed');
      }
      // Refresh data to reflect new status
      await loadEngram();
    } catch (err: any) {
      addToast('error', 'Action failed', err?.message);
    }
    setActionLoading(false);
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-loading">
          <div className="spinner" />
          <p>Loading engram...</p>
        </div>
      </div>
    );
  }

  if (error || !engram) {
    return (
      <div className="page">
        <div className="error-state">
          <p>{error || 'Engram not found.'}</p>
          <button className="btn-retry" onClick={loadEngram}>Retry</button>
        </div>
      </div>
    );
  }

  // Parse content
  let content = engram.content || engram.concept || '';
  let parsedContent: any = {};
  let summary = '';
  let tags: string[] = [];
  let sourceType = '';
  let confidence = 0;
  let capturedAt = '';
  let approvalStatus = '';
  let sensitivityClassification = '';
  let sensitivityReasoning = '';
  let sourceMetadata: Record<string, any> = {};

  try {
    parsedContent = typeof content === 'string' ? JSON.parse(content) : content;
    summary = parsedContent.content || parsedContent.concept || parsedContent.summary || content;
    tags = parsedContent.tags || [];
    sourceType = parsedContent.source_type || engram.sourceType || '';
    confidence = parsedContent.confidence ?? engram.confidence ?? 0;
    capturedAt = parsedContent.captured_at || engram.capturedAt || engram.captured_at || '';
    approvalStatus = parsedContent.approval_status || engram.approvalStatus || 'pending';
    sensitivityClassification = parsedContent.sensitivity_classification || '';
    sensitivityReasoning = parsedContent.sensitivity_reasoning || '';

    // Extract source metadata from parsed content
    const metaKeys = ['subject', 'sender', 'from', 'to', 'channel', 'participants', 'window_title', 'app_name', 'url', 'file_path', 'message_id'];
    for (const key of metaKeys) {
      if (parsedContent[key]) sourceMetadata[key] = parsedContent[key];
    }
  } catch {
    summary = content;
  }

  // Merge in source_metadata from API enrichment
  if (engram.source_metadata && typeof engram.source_metadata === 'object') {
    sourceMetadata = { ...sourceMetadata, ...engram.source_metadata };
  }

  const confidenceClass = confidence >= 0.7 ? 'high' : confidence >= 0.4 ? 'medium' : 'low';
  const confidencePct = Math.round(confidence * 100);
  const relatedEngrams = engram.related_engrams || [];
  const isPending = approvalStatus === 'pending';

  const statusBadgeClass = approvalStatus === 'approved' ? 'status-approved' :
    approvalStatus === 'dismissed' ? 'status-dismissed' : 'status-pending';

  return (
    <div className="page engram-detail-page">
      {/* Back navigation */}
      <button className="btn-back" onClick={() => navigate(-1)}>
        &larr; Back
      </button>

      {/* Header section */}
      <div className="detail-header">
        <div className="detail-header-top">
          <span className="detail-source-icon">{getSourceIcon(sourceType)}</span>
          <h2 className="detail-title">{engram.concept || 'Untitled'}</h2>
        </div>
        <div className="detail-header-meta">
          <span className={`detail-status-badge ${statusBadgeClass}`}>{approvalStatus}</span>
          <span className={`engram-source source-${sourceType?.startsWith('desktop_') ? 'desktop' : 'cloud'}`}>
            {getSourceLabel(sourceType)}
          </span>
          {capturedAt && <span className="detail-date">{formatDate(capturedAt)}</span>}
        </div>
        <div className="detail-confidence-bar">
          <div className="detail-confidence-label">
            <span>Confidence</span>
            <span className={`confidence-badge ${confidenceClass}`}>{confidencePct}%</span>
          </div>
          <div className="confidence-track">
            <div className={`confidence-fill ${confidenceClass}`} style={{ width: `${confidencePct}%` }} />
          </div>
        </div>
      </div>

      {/* Full extraction summary */}
      <div className="detail-card">
        <div className="detail-section">
          <label>Extraction Summary</label>
          <p className="detail-summary">{summary}</p>
        </div>
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="detail-card">
          <div className="detail-section">
            <label>Tags</label>
            <div className="detail-tags">
              {tags.map((tag: string) => (
                <Link
                  key={tag}
                  to={`/search?q=tag:${encodeURIComponent(tag)}`}
                  className="tag tag-clickable"
                >
                  {tag}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sensitivity */}
      {sensitivityClassification && (
        <div className="detail-card">
          <div className="detail-section">
            <label>Sensitivity</label>
            <span className={`sensitivity-badge ${sensitivityClassification}`}>{sensitivityClassification}</span>
            {sensitivityReasoning && <p className="sensitivity-reason">{sensitivityReasoning}</p>}
          </div>
        </div>
      )}

      {/* Source metadata */}
      {Object.keys(sourceMetadata).length > 0 && (
        <div className="detail-card">
          <div className="detail-section">
            <label
              className="detail-section-toggle"
              onClick={() => setSourceExpanded(!sourceExpanded)}
            >
              Source Metadata {sourceExpanded ? '\u25B2' : '\u25BC'}
            </label>
            {sourceExpanded && (
              <div className="source-metadata-grid">
                {Object.entries(sourceMetadata).map(([key, value]) => (
                  <div key={key} className="source-meta-row">
                    <span className="source-meta-key">{key.replace(/_/g, ' ')}</span>
                    <span className="source-meta-value">
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Related engrams */}
      {relatedEngrams.length > 0 && (
        <div className="detail-card">
          <div className="detail-section">
            <label>Related Engrams</label>
            <div className="related-list">
              {relatedEngrams.map((rel: any) => (
                <Link key={rel.id} to={`/engram/${rel.id}`} className="related-engram-link">
                  <span className="related-concept">{rel.concept}</span>
                  <span className={`confidence-badge ${(rel.confidence ?? 0) >= 0.7 ? 'high' : (rel.confidence ?? 0) >= 0.4 ? 'medium' : 'low'}`}>
                    {Math.round((rel.confidence ?? 0) * 100)}%
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Knowledge graph mini-view */}
      {relatedEngrams.length > 0 && (
        <div className="detail-card">
          <div className="detail-section">
            <label>Knowledge Graph</label>
            <div className="mini-graph">
              {/* Center node */}
              <div className="graph-node graph-node-center" title={engram.concept || 'This engram'}>
                <span className="graph-node-dot center-dot" />
                <span className="graph-node-label">{(engram.concept || 'This').slice(0, 20)}</span>
              </div>
              {/* Related nodes positioned around center */}
              {relatedEngrams.slice(0, 5).map((rel: any, i: number) => {
                const angle = (i / Math.min(relatedEngrams.length, 5)) * 2 * Math.PI - Math.PI / 2;
                const rx = 38;
                const ry = 35;
                const left = 50 + rx * Math.cos(angle);
                const top = 50 + ry * Math.sin(angle);
                return (
                  <React.Fragment key={rel.id}>
                    <svg className="graph-line" viewBox="0 0 100 100" preserveAspectRatio="none">
                      <line x1="50" y1="50" x2={left} y2={top} stroke="var(--accent)" strokeWidth="0.5" strokeOpacity="0.4" />
                    </svg>
                    <Link
                      to={`/engram/${rel.id}`}
                      className="graph-node graph-node-related"
                      style={{ left: `${left}%`, top: `${top}%` }}
                      title={rel.concept}
                    >
                      <span className="graph-node-dot related-dot" />
                      <span className="graph-node-label">{(rel.concept || '').slice(0, 16)}</span>
                    </Link>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      {isPending && (
        <div className="detail-actions">
          <button
            className="btn-approve btn-action-lg"
            disabled={actionLoading}
            onClick={() => handleAction('approved')}
          >
            {actionLoading ? 'Processing...' : 'Approve'}
          </button>
          <button
            className="btn-dismiss btn-action-lg"
            disabled={actionLoading}
            onClick={() => handleAction('dismissed')}
          >
            {actionLoading ? 'Processing...' : 'Dismiss'}
          </button>
        </div>
      )}
    </div>
  );
}
