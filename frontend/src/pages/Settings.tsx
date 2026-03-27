import React, { useEffect, useState, useCallback } from 'react';
import { getSettings, updateSettings, getToken } from '../api';
import type { UserSettings } from '../api';
import { useToast } from '../components/Toast';

const THEME_KEY = 'harvester-theme';

function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

export default function Settings() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { addToast } = useToast();

  // Local form state
  const [notifNew, setNotifNew] = useState(1);
  const [notifSound, setNotifSound] = useState(0);
  const [autoApprove, setAutoApprove] = useState(0);
  const [theme, setTheme] = useState('dark');
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await getSettings();
      setSettings(data);
      setNotifNew(data.notificationNewEngram);
      setNotifSound(data.notificationSound);
      setAutoApprove(data.autoApproveConfidence);
      setTheme(data.theme);
      setItemsPerPage(data.itemsPerPage);
    } catch {
      setError('Failed to load settings.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateSettings({
        notificationNewEngram: notifNew,
        notificationSound: notifSound,
        autoApproveConfidence: autoApprove,
        theme,
        itemsPerPage,
      });
      setSettings(updated);
      applyTheme(theme);
      addToast('success', 'Settings saved', 'Your preferences have been updated.');
    } catch {
      addToast('error', 'Save failed', 'Could not save settings. Try again.');
    }
    setSaving(false);
  };

  const exportUrl = `/api/engrams/export?format=json`;

  if (loading) {
    return (
      <div className="page settings-page">
        <h2>Settings</h2>
        <p className="page-subtitle">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page settings-page">
        <h2>Settings</h2>
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-retry" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page settings-page">
      <h2>Settings</h2>
      <p className="page-subtitle">Manage your notification, display, and pipeline preferences</p>

      {/* Notifications */}
      <div className="settings-section">
        <h3 className="settings-section-title">Notifications</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">New engram notifications</span>
            <span className="settings-row-desc">Get notified when new knowledge items arrive</span>
          </div>
          <button
            className={`settings-toggle ${notifNew ? 'on' : 'off'}`}
            onClick={() => setNotifNew(notifNew ? 0 : 1)}
            aria-pressed={!!notifNew}
            aria-label="Toggle new engram notifications"
          >
            {notifNew ? 'On' : 'Off'}
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Notification sound</span>
            <span className="settings-row-desc">Play a sound when notifications arrive</span>
          </div>
          <button
            className={`settings-toggle ${notifSound ? 'on' : 'off'}`}
            onClick={() => setNotifSound(notifSound ? 0 : 1)}
            aria-pressed={!!notifSound}
            aria-label="Toggle notification sound"
          >
            {notifSound ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      {/* Auto-approve */}
      <div className="settings-section">
        <h3 className="settings-section-title">Auto-Approve</h3>
        <div className="settings-row settings-row-col">
          <div className="settings-row-info">
            <span className="settings-row-label">
              Confidence threshold: <strong>{autoApprove === 0 ? 'Disabled' : `${Math.round(autoApprove * 100)}%`}</strong>
            </span>
            <span className="settings-row-desc">
              {autoApprove === 0
                ? 'All engrams require manual review'
                : `Engrams with confidence >= ${Math.round(autoApprove * 100)}% will be auto-approved`}
            </span>
          </div>
          <div className="settings-slider-wrap">
            <span className="settings-slider-label">0%</span>
            <input
              type="range"
              className="settings-slider"
              min={0}
              max={1}
              step={0.05}
              value={autoApprove}
              onChange={(e) => setAutoApprove(parseFloat(e.target.value))}
              aria-label="Auto-approve confidence threshold"
            />
            <span className="settings-slider-label">100%</span>
          </div>
        </div>
      </div>

      {/* Display */}
      <div className="settings-section">
        <h3 className="settings-section-title">Display</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Theme</span>
            <span className="settings-row-desc">Choose your preferred color scheme</span>
          </div>
          <select
            className="settings-select"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            aria-label="Theme"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Items per page</span>
            <span className="settings-row-desc">Number of items shown in lists</span>
          </div>
          <select
            className="settings-select"
            value={itemsPerPage}
            onChange={(e) => setItemsPerPage(parseInt(e.target.value, 10))}
            aria-label="Items per page"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {/* Data */}
      <div className="settings-section">
        <h3 className="settings-section-title">Data</h3>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">Export my engrams</span>
            <span className="settings-row-desc">Download all your engrams as JSON</span>
          </div>
          <a
            className="settings-export-btn"
            href={exportUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              // Fetch with auth token
              fetch(exportUrl, {
                headers: { Authorization: `Bearer ${getToken()}` },
              })
                .then((res) => res.blob())
                .then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'engrams-export.json';
                  a.click();
                  URL.revokeObjectURL(url);
                  addToast('success', 'Export started', 'Your engrams are being downloaded.');
                })
                .catch(() => addToast('error', 'Export failed', 'Could not download engrams.'));
            }}
          >
            Export JSON
          </a>
        </div>
      </div>

      {/* Save */}
      <div className="settings-actions">
        <button
          className="settings-save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
