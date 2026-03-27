import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { clearToken, getHealth } from '../api';

const THEME_KEY = 'harvester-theme';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '\u2302' },
  { to: '/queue', label: 'Queue', icon: '\u2709' },
  { to: '/approved', label: 'Approved', icon: '\u2713' },
  { to: '/search', label: 'Search', icon: '\u2315' },
  { to: '/health', label: 'Health', icon: '\u2665' },
  { to: '/users', label: 'Users', icon: '\u263A' },
  { to: '/dead-letters', label: 'Dead Letters', icon: '\u26A0' },
  { to: '/audit', label: 'Audit Log', icon: '\u2691' },
];

function getStoredTheme(): string {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

// Apply saved theme immediately on module load so there is no flash
applyTheme(getStoredTheme());

export default function Sidebar() {
  const navigate = useNavigate();
  const [health, setHealth] = useState<any>(null);
  const [theme, setTheme] = useState(getStoredTheme);
  const [mobileExpanded, setMobileExpanded] = useState(false);

  useEffect(() => {
    const check = () => getHealth().then(setHealth).catch(() => setHealth(null));
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  const closeMobile = () => setMobileExpanded(false);

  const pipelineOk = health?.status === 'ok';

  return (
    <>
      <button
        className="hamburger-btn"
        onClick={() => setMobileExpanded(!mobileExpanded)}
        aria-label="Toggle sidebar"
      >
        {mobileExpanded ? '\u2715' : '\u2630'}
      </button>

      {mobileExpanded && (
        <div className="sidebar-overlay visible" onClick={closeMobile} />
      )}

      <aside className={`sidebar${mobileExpanded ? ' sidebar-expanded' : ''}`} role="navigation" aria-label="Main navigation">
        <div className="sidebar-brand">
          <span className="sidebar-logo">{'\uD83C\uDF44'}</span>
          <span className="sidebar-title">Mycelium</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={closeMobile}
            >
              <span className="sidebar-link-icon">{item.icon}</span>
              <span className="sidebar-link-text">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-row">
            <div className="sidebar-status">
              <span className={`status-dot ${pipelineOk ? 'green' : 'red'}`} />
              <span>{pipelineOk ? 'Pipeline OK' : 'Pipeline Down'}</span>
            </div>
            <button
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? '\u2600' : '\u263D'}
            </button>
          </div>
          <button className="sidebar-logout" onClick={() => { clearToken(); navigate('/login'); }} aria-label="Logout">
            Logout
          </button>
        </div>
      </aside>
    </>
  );
}
