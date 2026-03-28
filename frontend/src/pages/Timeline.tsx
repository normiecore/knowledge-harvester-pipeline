import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTimeline } from '../api';

interface TimelineEngram {
  id: string;
  concept: string;
  capturedAt: string;
  sourceType: string;
  sourceApp: string;
  confidence: number;
  appCategory: string;
  durationSeconds: number;
  documentName: string;
  tags: string;
}

interface TimelineBlock {
  startTime: string;
  endTime: string;
  engrams: TimelineEngram[];
  appCategory: string;
  totalDuration: number;
}

interface TimelineSummary {
  totalActiveSeconds: number;
  totalEngrams: number;
  topApps: Array<{ app: string; seconds: number }>;
}

interface TimelineData {
  date: string;
  blocks: TimelineBlock[];
  summary: TimelineSummary;
}

const CATEGORY_COLORS: Record<string, string> = {
  editor: '#4a9eff',
  browser: '#ff8c3a',
  communication: '#a855f7',
  document: '#4eff4a',
  terminal: '#888888',
  other: '#555555',
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Convert ISO time to fractional hours (0-24) in UTC */
function timeToHours(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

export default function Timeline() {
  const navigate = useNavigate();
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hoveredEngram, setHoveredEngram] = useState<TimelineEngram | null>(null);

  const load = (targetDate: string) => {
    setLoading(true);
    setError(null);
    getTimeline(targetDate)
      .then((d) => setData(d))
      .catch((err) => setError(err?.message || 'Failed to load timeline'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(date);
  }, [date]);

  const shiftDate = (days: number) => {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  // Determine visible hour range from engram data
  const { hourStart, hourEnd } = useMemo(() => {
    if (!data || data.blocks.length === 0) return { hourStart: 8, hourEnd: 18 };
    let min = 24;
    let max = 0;
    for (const block of data.blocks) {
      const s = timeToHours(block.startTime);
      const e = timeToHours(block.endTime);
      if (s < min) min = s;
      if (e > max) max = e;
    }
    return {
      hourStart: Math.max(0, Math.floor(min) - 1),
      hourEnd: Math.min(24, Math.ceil(max) + 1),
    };
  }, [data]);

  const totalHours = hourEnd - hourStart;

  if (loading) {
    return (
      <div className="page page-loading">
        <div className="spinner" />
        <span>Loading timeline...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-retry" onClick={() => load(date)}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page timeline-page">
      <h2>Timeline</h2>
      <p className="page-subtitle">Daily activity reconstructed from engram metadata</p>

      {/* Date navigation */}
      <div className="timeline-date-nav">
        <button className="timeline-nav-btn" onClick={() => shiftDate(-1)} aria-label="Previous day">&larr;</button>
        <input
          type="date"
          className="timeline-date-input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button className="timeline-nav-btn" onClick={() => shiftDate(1)} aria-label="Next day">&rarr;</button>
        <button className="timeline-today-btn" onClick={() => setDate(new Date().toISOString().slice(0, 10))}>
          Today
        </button>
      </div>

      {/* Summary */}
      {data && (
        <div className="timeline-summary">
          <div className="timeline-stat">
            <span className="timeline-stat-value">{formatDuration(data.summary.totalActiveSeconds)}</span>
            <span className="timeline-stat-label">Active Time</span>
          </div>
          <div className="timeline-stat">
            <span className="timeline-stat-value">{data.summary.totalEngrams}</span>
            <span className="timeline-stat-label">Engrams</span>
          </div>
          {data.summary.topApps.map((app) => (
            <div className="timeline-stat" key={app.app}>
              <span className="timeline-stat-value">{formatDuration(app.seconds)}</span>
              <span className="timeline-stat-label">{app.app}</span>
            </div>
          ))}
        </div>
      )}

      {/* Category legend */}
      <div className="timeline-legend">
        {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
          <span className="timeline-legend-item" key={cat}>
            <span className="timeline-legend-dot" style={{ background: color }} />
            {cat}
          </span>
        ))}
      </div>

      {/* Horizontal timeline chart */}
      {data && data.blocks.length === 0 ? (
        <div className="empty-state">No activity recorded for this day</div>
      ) : data ? (
        <div className="timeline-chart-container">
          {/* Hour labels */}
          <div className="timeline-hour-labels">
            {Array.from({ length: totalHours + 1 }, (_, i) => {
              const h = hourStart + i;
              return (
                <span
                  key={h}
                  className="timeline-hour-label"
                  style={{ left: `${(i / totalHours) * 100}%` }}
                >
                  {h.toString().padStart(2, '0')}:00
                </span>
              );
            })}
          </div>

          {/* Timeline bar area */}
          <div className="timeline-bar-area">
            {/* Grid lines */}
            {Array.from({ length: totalHours + 1 }, (_, i) => (
              <div
                key={i}
                className="timeline-grid-line"
                style={{ left: `${(i / totalHours) * 100}%` }}
              />
            ))}

            {/* Engram bars - render each engram individually */}
            {data.blocks.flatMap((block) =>
              block.engrams.map((engram) => {
                const startH = timeToHours(engram.capturedAt) - hourStart;
                const durationH = (engram.durationSeconds || 60) / 3600; // min 1 minute for visibility
                const leftPct = (startH / totalHours) * 100;
                const widthPct = Math.max((durationH / totalHours) * 100, 0.3); // min 0.3% for visibility

                return (
                  <div
                    key={engram.id}
                    className={`timeline-bar ${hoveredEngram?.id === engram.id ? 'timeline-bar-hovered' : ''}`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      backgroundColor: getCategoryColor(engram.appCategory),
                    }}
                    onClick={() => navigate(`/engram/${engram.id}`)}
                    onMouseEnter={() => setHoveredEngram(engram)}
                    onMouseLeave={() => setHoveredEngram(null)}
                    title={`${engram.sourceApp} - ${engram.concept}\n${formatTime(engram.capturedAt)} (${formatDuration(engram.durationSeconds)})`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/engram/${engram.id}`);
                    }}
                    aria-label={`${engram.sourceApp}: ${engram.concept}, ${formatDuration(engram.durationSeconds)}`}
                  />
                );
              }),
            )}
          </div>

          {/* Hover tooltip */}
          {hoveredEngram && (
            <div className="timeline-tooltip">
              <strong>{hoveredEngram.sourceApp}</strong>
              <span className="timeline-tooltip-concept">{hoveredEngram.concept}</span>
              {hoveredEngram.documentName && (
                <span className="timeline-tooltip-doc">{hoveredEngram.documentName}</span>
              )}
              <span className="timeline-tooltip-time">
                {formatTime(hoveredEngram.capturedAt)} &middot; {formatDuration(hoveredEngram.durationSeconds)}
              </span>
              <span
                className="timeline-tooltip-cat"
                style={{ color: getCategoryColor(hoveredEngram.appCategory) }}
              >
                {hoveredEngram.appCategory}
              </span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
