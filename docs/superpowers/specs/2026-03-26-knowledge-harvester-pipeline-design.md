# Knowledge Harvester Pipeline — Design Spec

**Date:** 2026-03-26
**Status:** Approved
**Repo:** `knowledge-harvester-pipeline`

## Overview

Server-side pipeline running on NVIDIA Jetson GB10 that ingests organisational data via Microsoft Graph API, extracts knowledge using a local LLM, applies sensitivity filtering, and stores layered engrams in MuninnDB. Part of a two-repo system — this repo handles all backend processing; `knowledge-harvester-desktop` (Phase 2) provides the Tauri desktop client.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  knowledge-harvester-pipeline  (GB10)                   │
│                                                         │
│  ┌──────────┐    ┌───────┐    ┌──────────────────────┐  │
│  │ Graph API │───>│ NATS  │───>│ Processing Pipeline  │  │
│  │ Poller   │    │       │    │  - Extraction (LLM)   │  │
│  └──────────┘    │       │    │  - Sensitivity Filter │  │
│                  │       │<───│  - Engram Builder     │  │
│                  └───┬───┘    └──────────────────────┘  │
│                      │                    │              │
│                      │              ┌─────▼─────┐       │
│                      │              │ MuninnDB   │       │
│                      │              └─────┬─────┘       │
│                      │                    │              │
│                  ┌───▼────────────────────▼───┐         │
│                  │  REST API (Engram Service)  │         │
│                  └────────────┬───────────────┘         │
└───────────────────────────────┼──────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │ knowledge-harvester-   │
                    │ desktop (Phase 2)      │
                    │  Tauri / System Tray   │
                    └────────────────────────┘
```

## Decisions

1. **Separate repos** — `knowledge-harvester-pipeline` (GB10) + `knowledge-harvester-desktop` (workstations)
2. **Hybrid approval UX** — low-priority cards queue silently, high-confidence get notification badge
3. **NATS message queue** — decouples ingestion from processing, handles backpressure
4. **System tray only** — minimal desktop presence, badge count for pending reviews
5. **Azure AD SSO** — tokens from Windows session, same app registration for Graph + auth
6. **Graph API first** — pilot with M365 data, desktop screenshot capture in Phase 2
7. **Pipeline-first build** — prove extraction + sensitivity before deploying to workstations
8. **Three-layer MuninnDB fidelity** — personal (full) > department (summary) > org (signal)
9. **Fastify REST API + WebSocket** — desktop client interface
10. **TypeScript throughout** — SGLang/TRT-LLM for LLM serving (separate process)

## Component Design

### 1. Graph API Ingestion

Centralized poller on GB10 pulling M365 data for all users.

**Data sources (pilot priority order):**
1. Outlook emails
2. Teams messages (channel + chat)
3. Calendar events
4. SharePoint/OneDrive documents
5. Planner tasks

**Polling strategy:**
- Delta queries (`/delta` endpoints) — only fetch changes since last poll
- 30-second polling interval per data source
- Per-user consent via Azure AD app registration with admin consent
- Exponential backoff for Graph rate limits (~10k req/10min)

**Message format published to NATS (`raw.captures`):**
```typescript
interface RawCapture {
  id: string;
  userId: string;
  userEmail: string;
  sourceType: 'graph_email' | 'graph_teams' | 'graph_calendar' | 'graph_document' | 'graph_task';
  sourceApp: string;
  capturedAt: string;
  rawContent: string;
  metadata: Record<string, any>;
}
```

### 2. Processing Pipeline

Consumes `RawCapture` from NATS, produces engrams.

**Stages:**
```
NATS (raw.captures)
    │
    ▼
[1] Sensitivity Pre-Filter (CPU only, <1ms)
    - Source exclusion list (HR portal URLs, banking domains)
    - Title/subject regex (salary, performance review)
    - Content regex (personal life events, medical)
    │  BLOCK → log + discard
    ▼  PASS
[2] LLM Extraction + Sensitivity (Llama 3.1 8B, single call)
    - Input: raw content + metadata
    - Output JSON:
      {
        "summary": "...",
        "tags": ["..."],
        "confidence": 0.85,
        "sensitivity": {
          "classification": "safe | review | block",
          "reasoning": "..."
        }
      }
    │  BLOCK → log + discard
    │  REVIEW → manual review queue
    ▼  SAFE
[3] Engram Builder
    - Combines LLM output with capture metadata
    - Deduplicates against recent engrams (semantic similarity)
    - Assigns priority: high-confidence → notification, low → silent queue
    │
    ▼
[4] MuninnDB Storage (three-layer write)
    - Personal vault: full fidelity
    - Department vault: summary + attribution, no raw text
    - Org vault: topic signal only, no individual attribution
    │
    ▼
[5] Publish to NATS (engrams.pending.{userId})
```

**LLM serving:** SGLang + TensorRT-LLM, Llama 3.1 8B NVFP4, OpenAI-compatible HTTP API. Separate process on GB10, not part of this repo.

### 3. Layered Knowledge Architecture

Three visibility layers with decreasing fidelity:

| Field | Personal | Department | Org |
|-------|----------|------------|-----|
| Full summary | Yes | Yes | No — topic keywords only |
| Raw extracted text | Yes | No | No |
| Source app | Yes | Yes | No |
| Individual attribution | Yes | Yes — "James knows..." | No — "Engineering dept..." |
| Tags | Yes | Yes | Yes |
| Confidence score | Yes | No | No |
| Sensitivity reasoning | Yes | No | No |
| Linked engrams | Yes | Within dept only | No |

**Vault naming:**
- Personal: `knowledge-harvester-{userId}`
- Department: `knowledge-harvester-dept-{deptId}`
- Org: `knowledge-harvester-org`

**Engram lifecycle:**
1. Pipeline creates engram → personal vault, `approval_status: pending`
2. User approves → status updated, dept + org layers generated
3. Dismissed engrams kept 30 days, then purged
4. Only approved engrams visible in dept/org search

**Department mapping:** Azure AD user profiles (`department` field).

**Cross-department access:** Org layer shows "Engineering department has 12 engrams on pipe stress analysis" with option to request access to dept-level detail.

### 4. Engram Schema

```typescript
interface HarvesterEngram {
  // MuninnDB fields
  concept: string;
  content: string;

  // Harvester metadata
  source_type: string;
  source_app: string;
  user_id: string;
  user_email: string;
  captured_at: string;
  approved_at: string | null;
  approved_by: string | null;
  approval_status: 'pending' | 'approved' | 'dismissed';
  confidence: number;
  sensitivity_classification: string;
  tags: string[];
  raw_text: string;
}
```

### 5. REST API (Engram Service)

Fastify server with Azure AD Bearer token auth.

**Endpoints:**
```
GET    /api/engrams?status=pending&limit=20    # user's engram queue
GET    /api/engrams?status=approved&q=subsea    # search approved engrams
GET    /api/engrams/:id                         # single engram detail
PATCH  /api/engrams/:id                         # approve/dismiss
GET    /api/stats                               # user's capture stats
GET    /api/health                              # pipeline health check
WS     /ws/engrams                              # real-time notifications
```

**Behaviours:**
- Users only see their own engrams (scoped by Azure AD user ID)
- WebSocket pushes new pending engrams for hybrid approval flow
- Search hits MuninnDB recall capability
- Dept/org layer queries use separate endpoints (future)

### 6. NATS Topics

```
raw.captures                    # Graph API ingested data
pipeline.deadletter             # failed processing (for debugging)
engrams.pending.{userId}        # new engrams awaiting approval
engrams.approved                # approved engrams (downstream consumers)
```

## Project Structure

```
knowledge-harvester-pipeline/
├── src/
│   ├── ingestion/
│   │   ├── graph-poller.ts
│   │   └── graph-types.ts
│   ├── pipeline/
│   │   ├── sensitivity-filter.ts
│   │   ├── extractor.ts
│   │   ├── engram-builder.ts
│   │   ├── deduplicator.ts
│   │   └── fidelity-reducer.ts
│   ├── storage/
│   │   ├── muninndb-client.ts
│   │   └── vault-manager.ts
│   ├── api/
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   ├── engrams.ts
│   │   │   └── stats.ts
│   │   └── ws.ts
│   ├── queue/
│   │   ├── nats-client.ts
│   │   └── topics.ts
│   └── config/
│       ├── sensitivity-rules.ts
│       └── index.ts
├── prompts/
│   ├── extraction.txt
│   └── fidelity-reduction.txt
├── package.json
├── tsconfig.json
└── Dockerfile
```

## Dependencies

**Runtime:**
- `@microsoft/microsoft-graph-client` — Graph API
- `@azure/identity` — Azure AD tokens
- `nats` — message queue client
- `fastify` + `@fastify/websocket` — REST API
- `better-sqlite3` — local pipeline state (dedup hashes, poll cursors)

**LLM (separate process):**
- SGLang + TensorRT-LLM serving Llama 3.1 8B NVFP4
- OpenAI-compatible HTTP API

## Configuration

```
AZURE_TENANT_ID=<tenant>
AZURE_CLIENT_ID=<app-registration-id>
AZURE_CLIENT_SECRET=<secret>
NATS_URL=nats://localhost:4222
MUNINNDB_URL=http://localhost:3030
MUNINNDB_API_KEY=<key>
LLM_BASE_URL=http://localhost:8000/v1
LLM_MODEL=llama-3.1-8b-nvfp4
POLL_INTERVAL_MS=30000
MAX_CONCURRENT_EXTRACTIONS=8
```

## Azure AD App Registration

**Graph API permissions (application, admin consent):**
- `Mail.Read` — email content
- `Chat.Read.All` — Teams messages
- `Calendars.Read` — calendar events
- `Files.Read.All` — SharePoint/OneDrive
- `User.Read.All` — user profiles + department mapping
- `Tasks.Read.All` — Planner tasks

## Deployment

All services on GB10 as systemd units:
- `knowledge-harvester-pipeline.service` — main pipeline
- `nats-server.service` — NATS message queue
- `sglang-llm.service` — LLM serving (TRT-LLM backend)
- MuninnDB already running

## Pilot Scope

- 5-10 engineers
- Email + Teams only initially
- Calendar/SharePoint/Planner added incrementally
- Sensitivity rules tuned conservatively (over-block, relax later)
- Monitor: Hawthorne effect, approval fatigue, engineer trust

## Phase 2 (Future — Desktop Repo)

- Tauri app with system tray
- Engram review queue (consuming REST API + WebSocket)
- Screenshot capture (10s interval)
- Window polling + keystroke counting
- Local SQLite for hot data
- OCR/VLM pipeline additions on GB10
