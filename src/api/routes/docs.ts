import type { FastifyInstance } from 'fastify';

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Knowledge Harvester Pipeline API',
    description: 'Backend API for the Mycelium Knowledge Harvester — ingestion, review, analytics, and vault management.',
    version: '2.0.0',
  },
  servers: [{ url: '/', description: 'Current host' }],
  tags: [
    { name: 'Health', description: 'System health and readiness' },
    { name: 'Engrams', description: 'Knowledge engram CRUD and review workflows' },
    { name: 'Analytics', description: 'Dashboard analytics and aggregations' },
    { name: 'Users', description: 'User management and department assignment' },
    { name: 'Audit', description: 'Audit log queries' },
    { name: 'Dead Letters', description: 'Failed pipeline items' },
    { name: 'Settings', description: 'Per-user settings' },
    { name: 'Vaults', description: 'MuninnDB vault browser' },
    { name: 'Digest', description: 'Periodic knowledge digest generation' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http' as const,
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Error: {
        type: 'object' as const,
        properties: {
          error: { type: 'string' as const },
        },
      },
      EngramIndexRow: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const },
          userId: { type: 'string' as const },
          concept: { type: 'string' as const },
          approvalStatus: { type: 'string' as const, enum: ['pending', 'approved', 'dismissed'] },
          capturedAt: { type: 'string' as const, format: 'date-time' },
          sourceType: { type: 'string' as const },
          confidence: { type: 'number' as const, minimum: 0, maximum: 1 },
          department: { type: 'string' as const },
        },
      },
      PaginatedEngrams: {
        type: 'object' as const,
        properties: {
          engrams: { type: 'array' as const, items: { $ref: '#/components/schemas/EngramIndexRow' } },
          total: { type: 'integer' as const },
          limit: { type: 'integer' as const },
          offset: { type: 'integer' as const },
        },
      },
      Digest: {
        type: 'object' as const,
        properties: {
          period: { type: 'string' as const, enum: ['daily', 'weekly'] },
          from: { type: 'string' as const, format: 'date-time' },
          to: { type: 'string' as const, format: 'date-time' },
          newEngrams: { type: 'integer' as const },
          topTags: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: { tag: { type: 'string' as const }, count: { type: 'integer' as const } },
            },
          },
          highlights: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                concept: { type: 'string' as const },
                confidence: { type: 'number' as const },
                sourceType: { type: 'string' as const },
                capturedAt: { type: 'string' as const, format: 'date-time' },
              },
            },
          },
          sourcesBreakdown: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: { source: { type: 'string' as const }, count: { type: 'integer' as const } },
            },
          },
        },
      },
      VaultInfo: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          type: { type: 'string' as const, enum: ['personal', 'department', 'org'] },
          owner: { type: 'string' as const },
          engramCount: { type: 'integer' as const },
        },
      },
      VaultStats: {
        type: 'object' as const,
        properties: {
          count: { type: 'integer' as const },
          topTags: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: { tag: { type: 'string' as const }, count: { type: 'integer' as const } },
            },
          },
          dateRange: {
            type: 'object' as const,
            properties: {
              earliest: { type: 'string' as const, format: 'date-time' },
              latest: { type: 'string' as const, format: 'date-time' },
            },
          },
        },
      },
      HealthCheck: {
        type: 'object' as const,
        properties: {
          status: { type: 'string' as const, enum: ['ok', 'degraded'] },
          timestamp: { type: 'string' as const, format: 'date-time' },
          checks: { type: 'object' as const },
          metrics: { type: 'object' as const, nullable: true },
        },
      },
      AnalyticsOverview: {
        type: 'object' as const,
        properties: {
          totalEngrams: { type: 'integer' as const },
          byStatus: {
            type: 'object' as const,
            properties: {
              pending: { type: 'integer' as const },
              approved: { type: 'integer' as const },
              dismissed: { type: 'integer' as const },
            },
          },
          captures: {
            type: 'object' as const,
            properties: {
              today: { type: 'integer' as const },
              week: { type: 'integer' as const },
              month: { type: 'integer' as const },
            },
          },
          avgConfidence: { type: 'number' as const },
          pipeline: { type: 'object' as const },
        },
      },
      UserSettings: {
        type: 'object' as const,
        properties: {
          userId: { type: 'string' as const },
          notificationNewEngram: { type: 'integer' as const },
          notificationSound: { type: 'integer' as const },
          autoApproveConfidence: { type: 'number' as const },
          theme: { type: 'string' as const },
          itemsPerPage: { type: 'integer' as const },
          updatedAt: { type: 'string' as const, format: 'date-time' },
        },
      },
      AuditRecord: {
        type: 'object' as const,
        properties: {
          id: { type: 'integer' as const },
          timestamp: { type: 'string' as const, format: 'date-time' },
          userId: { type: 'string' as const },
          action: { type: 'string' as const },
          resourceType: { type: 'string' as const },
          resourceId: { type: 'string' as const, nullable: true },
          details: { type: 'string' as const, nullable: true },
          ipAddress: { type: 'string' as const, nullable: true },
        },
      },
      DeadLetterRecord: {
        type: 'object' as const,
        properties: {
          id: { type: 'integer' as const },
          captureId: { type: 'string' as const },
          error: { type: 'string' as const },
          attempts: { type: 'integer' as const },
          payload: { type: 'string' as const },
          createdAt: { type: 'string' as const, format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'System health check',
        security: [],
        responses: {
          '200': {
            description: 'Health status with dependency checks',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthCheck' } } },
          },
        },
      },
    },
    '/api/engrams': {
      get: {
        tags: ['Engrams'],
        summary: 'List or search engrams',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'dismissed'] }, description: 'Filter by approval status' },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Full-text search query' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 }, description: 'Max results' },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 }, description: 'Pagination offset' },
          { name: 'source', in: 'query', schema: { type: 'string' }, description: 'Filter by source type' },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Start date (inclusive)' },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: 'End date (inclusive)' },
          { name: 'confidence_min', in: 'query', schema: { type: 'number' }, description: 'Minimum confidence score' },
          { name: 'confidence_max', in: 'query', schema: { type: 'number' }, description: 'Maximum confidence score' },
          { name: 'department', in: 'query', schema: { type: 'string' }, description: 'Filter by department' },
        ],
        responses: {
          '200': {
            description: 'Paginated engram list',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedEngrams' } } },
          },
        },
      },
    },
    '/api/engrams/export': {
      get: {
        tags: ['Engrams'],
        summary: 'Export engrams as JSON or CSV',
        parameters: [
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'], default: 'json' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Exported engrams in requested format' },
        },
      },
    },
    '/api/engrams/{id}': {
      get: {
        tags: ['Engrams'],
        summary: 'Get engram detail with related engrams',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Engram detail with related engrams and source metadata',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
      patch: {
        tags: ['Engrams'],
        summary: 'Approve or dismiss an engram',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['approval_status'],
                properties: {
                  approval_status: { type: 'string', enum: ['approved', 'dismissed'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated status',
            content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, approval_status: { type: 'string' } } } } },
          },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/engrams/bulk': {
      post: {
        tags: ['Engrams'],
        summary: 'Bulk approve or dismiss engrams',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['ids', 'action'],
                properties: {
                  ids: { type: 'array', items: { type: 'string' } },
                  action: { type: 'string', enum: ['approve', 'dismiss'] },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Bulk operation result',
            content: { 'application/json': { schema: { type: 'object', properties: { processed: { type: 'integer' }, failed: { type: 'integer' } } } } },
          },
        },
      },
    },
    '/api/captures': {
      post: {
        tags: ['Engrams'],
        summary: 'Submit a raw capture for pipeline processing',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['id', 'userId', 'userEmail', 'sourceType', 'sourceApp', 'capturedAt', 'rawContent', 'metadata'],
                properties: {
                  id: { type: 'string' },
                  userId: { type: 'string' },
                  userEmail: { type: 'string' },
                  sourceType: { type: 'string', enum: ['graph_email', 'graph_teams', 'graph_calendar', 'graph_document', 'graph_task', 'desktop_screenshot', 'desktop_window'] },
                  sourceApp: { type: 'string' },
                  capturedAt: { type: 'string', format: 'date-time' },
                  rawContent: { type: 'string' },
                  metadata: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          '202': {
            description: 'Capture accepted for processing',
            content: { 'application/json': { schema: { type: 'object', properties: { accepted: { type: 'boolean' }, id: { type: 'string' } } } } },
          },
          '400': { description: 'Invalid payload', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/stats': {
      get: {
        tags: ['Analytics'],
        summary: 'Basic stats for current user',
        responses: {
          '200': {
            description: 'User stats',
            content: { 'application/json': { schema: { type: 'object', properties: { totalEngrams: { type: 'integer' }, userId: { type: 'string' } } } } },
          },
        },
      },
    },
    '/api/analytics/overview': {
      get: {
        tags: ['Analytics'],
        summary: 'Dashboard analytics overview',
        responses: {
          '200': {
            description: 'Overview statistics',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AnalyticsOverview' } } },
          },
        },
      },
    },
    '/api/analytics/volume': {
      get: {
        tags: ['Analytics'],
        summary: 'Capture volume time series',
        parameters: [
          { name: 'period', in: 'query', schema: { type: 'string', enum: ['day', 'week', 'month'] }, description: 'Aggregation period' },
        ],
        responses: {
          '200': {
            description: 'Volume data by date',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    period: { type: 'string' },
                    days: { type: 'integer' },
                    volume: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          date: { type: 'string' },
                          count: { type: 'integer' },
                          approved: { type: 'integer' },
                          dismissed: { type: 'integer' },
                          pending: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/analytics/sources': {
      get: {
        tags: ['Analytics'],
        summary: 'Engram source breakdown',
        responses: {
          '200': {
            description: 'Source type distribution',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sources: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          source: { type: 'string' },
                          count: { type: 'integer' },
                          percentage: { type: 'number' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/analytics/top-tags': {
      get: {
        tags: ['Analytics'],
        summary: 'Most frequent tags',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 }, description: 'Max tags to return' },
        ],
        responses: {
          '200': {
            description: 'Tag frequency list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    tags: {
                      type: 'array',
                      items: { type: 'object', properties: { tag: { type: 'string' }, count: { type: 'integer' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/analytics/confidence': {
      get: {
        tags: ['Analytics'],
        summary: 'Confidence score distribution',
        responses: {
          '200': {
            description: 'Confidence histogram buckets',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    distribution: {
                      type: 'array',
                      items: { type: 'object', properties: { range: { type: 'string' }, count: { type: 'integer' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/users': {
      get: {
        tags: ['Users'],
        summary: 'List users with stats',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'department', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search by name or email' },
        ],
        responses: {
          '200': {
            description: 'Paginated user list',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
    '/api/users/departments': {
      get: {
        tags: ['Users'],
        summary: 'List all departments with user counts',
        responses: {
          '200': {
            description: 'Department list',
            content: { 'application/json': { schema: { type: 'object', properties: { departments: { type: 'array', items: { type: 'object' } } } } } },
          },
        },
      },
    },
    '/api/users/{id}': {
      get: {
        tags: ['Users'],
        summary: 'Get single user detail with stats',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'User detail', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      patch: {
        tags: ['Users'],
        summary: 'Update user department, role, or harvesting status',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  department: { type: 'string' },
                  role: { type: 'string', enum: ['user', 'admin'] },
                  harvestingEnabled: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated user', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': { description: 'User not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/users/{id}/sync-stats': {
      post: {
        tags: ['Users'],
        summary: 'Recalculate user stats from engram index',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Recalculated stats', content: { 'application/json': { schema: { type: 'object' } } } },
          '404': { description: 'User not found' },
        },
      },
    },
    '/api/audit': {
      get: {
        tags: ['Audit'],
        summary: 'Query audit log (admin only)',
        parameters: [
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'resourceType', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          '200': {
            description: 'Paginated audit entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    entries: { type: 'array', items: { $ref: '#/components/schemas/AuditRecord' } },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
          '403': { description: 'Admin access required' },
        },
      },
    },
    '/api/audit/actions': {
      get: {
        tags: ['Audit'],
        summary: 'List distinct audit action types',
        responses: {
          '200': {
            description: 'Action type list',
            content: { 'application/json': { schema: { type: 'object', properties: { actions: { type: 'array', items: { type: 'string' } } } } } },
          },
        },
      },
    },
    '/api/dead-letters': {
      get: {
        tags: ['Dead Letters'],
        summary: 'List dead letter items',
        responses: {
          '200': {
            description: 'Dead letter list with count',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer' },
                    items: { type: 'array', items: { $ref: '#/components/schemas/DeadLetterRecord' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/dead-letters/{id}': {
      delete: {
        tags: ['Dead Letters'],
        summary: 'Delete a dead letter item',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { deleted: { type: 'boolean' } } } } } },
          '400': { description: 'Invalid ID' },
        },
      },
    },
    '/api/dead-letters/{id}/retry': {
      post: {
        tags: ['Dead Letters'],
        summary: 'Retry a dead letter by re-publishing to NATS',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: {
          '200': { description: 'Requeued', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' } } } } } },
          '404': { description: 'Dead letter not found' },
          '503': { description: 'NATS unavailable' },
        },
      },
    },
    '/api/settings': {
      get: {
        tags: ['Settings'],
        summary: 'Get current user settings',
        responses: {
          '200': {
            description: 'User settings',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserSettings' } } },
          },
        },
      },
      patch: {
        tags: ['Settings'],
        summary: 'Update user settings',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  notificationNewEngram: { type: 'integer' },
                  notificationSound: { type: 'integer' },
                  autoApproveConfidence: { type: 'number' },
                  theme: { type: 'string' },
                  itemsPerPage: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Updated settings',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UserSettings' } } },
          },
        },
      },
    },
    '/api/vaults': {
      get: {
        tags: ['Vaults'],
        summary: 'List known vault prefixes with engram counts',
        responses: {
          '200': {
            description: 'Grouped vault list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    personal: { type: 'array', items: { $ref: '#/components/schemas/VaultInfo' } },
                    department: { type: 'array', items: { $ref: '#/components/schemas/VaultInfo' } },
                    org: { type: 'array', items: { $ref: '#/components/schemas/VaultInfo' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/vaults/{name}/engrams': {
      get: {
        tags: ['Vaults'],
        summary: 'List engrams from a specific vault',
        parameters: [
          { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search within vault' },
        ],
        responses: {
          '200': {
            description: 'Paginated engrams for the vault',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedEngrams' } } },
          },
        },
      },
    },
    '/api/vaults/{name}/stats': {
      get: {
        tags: ['Vaults'],
        summary: 'Vault statistics: count, top tags, date range',
        parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Vault stats',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/VaultStats' } } },
          },
        },
      },
    },
    '/api/digest': {
      get: {
        tags: ['Digest'],
        summary: 'Generate digest for current user',
        parameters: [
          { name: 'period', in: 'query', required: true, schema: { type: 'string', enum: ['daily', 'weekly'] } },
        ],
        responses: {
          '200': {
            description: 'Generated digest',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Digest' } } },
          },
        },
      },
    },
  },
};

const SWAGGER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Knowledge Harvester API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #1a1a2e; }
    #swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [
        SwaggerUIBundle.presets.apis,
        SwaggerUIBundle.SwaggerUIStandalonePreset,
      ],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`;

export async function docsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/docs.json', async (_req, reply) => {
    reply.header('Content-Type', 'application/json');
    return openApiSpec;
  });

  app.get('/api/docs', async (_req, reply) => {
    reply.header('Content-Type', 'text/html');
    return SWAGGER_HTML;
  });
}
