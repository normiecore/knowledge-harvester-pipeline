# Mycelium — Web Frontend Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Repo:** `knowledge-harvester-pipeline`
**Depends on:** Pipeline base implementation + hardening specs

## Overview

React/Vite web frontend served by the pipeline's Fastify server as static files. Provides a dashboard for reviewing, approving, searching, and monitoring knowledge engrams. Accessed via browser at the RunPod pod URL. Bundled into the same Docker container as the pipeline.

## Branding

**Name:** Mycelium
**Tagline:** Organisational knowledge, connected.

All references to "Knowledge Harvester" in the UI become "Mycelium."

## Architecture

```
frontend/                    # React/Vite app
├── src/
│   ├── App.tsx             # Router + layout (sidebar + content)
│   ├── main.tsx            # Entry point
│   ├── api.ts              # REST + WebSocket client
│   ├── auth.ts             # Token storage + auth header injection
│   ├── components/
│   │   ├── Sidebar.tsx     # Navigation sidebar
│   │   ├── EngramCard.tsx  # Engram card with inline expand
│   │   └── StatusBadge.tsx # Pipeline health indicator
│   ├── pages/
│   │   ├── Queue.tsx       # Pending engram review queue
│   │   ├── Approved.tsx    # Browse approved engrams
│   │   ├── Search.tsx      # Semantic search
│   │   └── Health.tsx      # Pipeline health + metrics
│   └── styles/
│       └── index.css       # Global styles (dark theme)
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json

# Build output → dist/ → copied to pipeline container
# Fastify serves from /app/frontend-dist/ as static files
```

## Decisions

1. **React 19 + Vite** — component-based, fast dev server, small production bundle
2. **No UI framework** — plain CSS with CSS variables for theming. Keeps bundle tiny.
3. **Sidebar layout** — nav on left, content on right
4. **Inline card expand** — click card to show full details in place
5. **Auto-insert via WebSocket** — new engrams appear at top with animation
6. **Dev token auth** — paste a JWT on login page. Azure AD OAuth deferred.
7. **Dark theme** — matches engineering tool aesthetics
8. **Single container** — Vite builds to static files, Fastify serves them

## Pages

### 1. Login

Simple token entry page. User pastes a dev JWT (generated via CLI: `node -e "require('jsonwebtoken').sign({oid:'user-1',preferred_username:'james@co.com'},'dev-secret')"`). Token stored in localStorage. Redirects to Queue.

### 2. Review Queue (default view)

Displays pending engrams as cards in a scrollable list.

**Card (collapsed):**
- Concept title (bold)
- Source icon + app name + timestamp + "2 min ago"
- Confidence badge (green >70%, yellow 40-70%, red <40%)

**Card (expanded — click to toggle):**
- Everything above, plus:
- Full summary text
- Source text (monospace, collapsible)
- Tags as pills
- Sensitivity classification + reasoning
- Approve / Dismiss buttons

**Real-time:** WebSocket pushes new cards to top with slide-in animation.

**Actions:**
- Approve → PATCH `/api/engrams/:id` with `{approval_status: 'approved', department: 'Engineering'}` → card moves to Approved
- Dismiss → PATCH with `{approval_status: 'dismissed'}` → card fades out

### 3. Approved

Browse approved engrams. Same card layout but read-only (no approve/dismiss buttons). Sorted by approval date descending.

### 4. Search

Text input at top. Fires semantic search via `GET /api/engrams?q=<query>`. Results as cards. Searches across MuninnDB recall.

### 5. Health

Displays `/api/health` response:
- Service status indicators (NATS, vLLM, MuninnDB) — green/red dots
- Pipeline metrics: processed, blocked, deduplicated, errors
- Uptime
- Last poll timestamp
- Auto-refreshes every 10 seconds

## Sidebar

```
┌──────────────────┐
│  🍄 Mycelium     │
│                  │
│  ● Queue    (42) │  ← badge count from API
│    Approved      │
│    Search        │
│    Health        │
│                  │
│  ──────────────  │
│  ● Pipeline OK   │  ← green/red dot
│  james@co.com    │  ← logged-in user
│  [Logout]        │
└──────────────────┘
```

Width: 220px fixed. Collapsible on mobile (hamburger menu).

## API Client

```typescript
// frontend/src/api.ts

const BASE_URL = ''; // same origin — Fastify serves both API and frontend

function getToken(): string { return localStorage.getItem('mycelium_token') || ''; }

async function fetchAPI(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...opts?.headers },
  });
  if (res.status === 401) { localStorage.removeItem('mycelium_token'); window.location.href = '/login'; }
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// WebSocket
function connectWebSocket(onEngram: (engram: any) => void) {
  const ws = new WebSocket(`ws://${window.location.host}/ws/engrams?token=${getToken()}`);
  ws.onmessage = (e) => { const data = JSON.parse(e.data); if (data.type === 'new_engram') onEngram(data); };
  ws.onclose = () => setTimeout(() => connectWebSocket(onEngram), 3000); // auto-reconnect
  return ws;
}
```

## Fastify Static File Serving

Add `@fastify/static` to serve the built frontend:

```typescript
// In src/api/server.ts
import fastifyStatic from '@fastify/static';

await app.register(fastifyStatic, {
  root: path.join(process.cwd(), 'frontend-dist'),
  prefix: '/',
  wildcard: false,
});

// SPA fallback — serve index.html for non-API routes
app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
    reply.code(404).send({ error: 'Not found' });
  } else {
    reply.sendFile('index.html');
  }
});
```

## Build Integration

**Vite config:**
```typescript
// frontend/vite.config.ts
export default defineConfig({
  build: { outDir: '../frontend-dist' },
  server: { proxy: { '/api': 'http://localhost:3001', '/ws': { target: 'ws://localhost:3001', ws: true } } },
});
```

**Docker:** Build frontend during Docker image build, copy `frontend-dist/` into runtime stage.

Updated Dockerfile stages:
1. Build pipeline TypeScript
2. Build frontend (npm ci + vite build in frontend/)
3. Copy both dist outputs to runtime image

## Color Scheme (CSS Variables)

```css
:root {
  --bg-primary: #0f0f1a;
  --bg-secondary: #1a1a2e;
  --bg-card: #1a1a3a;
  --bg-card-hover: #222244;
  --text-primary: #e0e0e0;
  --text-secondary: #888;
  --accent: #4a9eff;
  --success: #4eff4a;
  --danger: #ff4a4a;
  --warning: #ffaa4a;
  --border: #333;
  --tag-bg: #2a2a4a;
  --tag-text: #8af;
  --sidebar-width: 220px;
}
```

## Dependencies

**frontend/package.json:**
- `react`, `react-dom` — UI
- `react-router-dom` — client-side routing
- `vite`, `@vitejs/plugin-react` — build tool
- `typescript` — types

**Pipeline additions:**
- `@fastify/static` — serve frontend files

## Not In Scope

- Azure AD OAuth login flow (deferred — dev token for prototype)
- Department selection on approve (hardcode 'Engineering' for prototype)
- Tauri desktop wrapper (deferred to on-prem phase)
- Mobile responsive design (desktop-only for now)
- i18n / accessibility (future)
