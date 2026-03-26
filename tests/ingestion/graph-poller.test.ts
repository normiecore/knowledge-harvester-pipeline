import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphPoller } from '../../src/ingestion/graph-poller.js';
import type { RawCapture } from '../../src/types.js';
import type { GraphDeltaResponse, GraphMessage, GraphChatMessage } from '../../src/ingestion/graph-types.js';

function makeMockGraphClient(responses: Record<string, unknown>) {
  return {
    api: vi.fn((url: string) => ({
      get: vi.fn(async () => responses[url] ?? { value: [] }),
    })),
  };
}

function makeMockDeltaStore() {
  const links = new Map<string, string>();
  return {
    getDeltaLink: vi.fn((userId: string, source: string) =>
      links.get(`${userId}:${source}`) ?? null,
    ),
    setDeltaLink: vi.fn((userId: string, source: string, link: string) => {
      links.set(`${userId}:${source}`, link);
    }),
  };
}

describe('GraphPoller', () => {
  let poller: GraphPoller;
  let graphClient: ReturnType<typeof makeMockGraphClient>;
  let deltaStore: ReturnType<typeof makeMockDeltaStore>;
  let published: RawCapture[];

  beforeEach(() => {
    published = [];
    graphClient = makeMockGraphClient({
      '/users/user-1/mailFolders/inbox/messages/delta': {
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=new-mail',
        value: [
          {
            id: 'msg-1',
            subject: 'Project update',
            bodyPreview: 'Here is the update on the subsea project.',
            from: { emailAddress: { name: 'Alice', address: 'alice@co.com' } },
            receivedDateTime: '2026-03-26T10:00:00Z',
          },
        ],
      } satisfies GraphDeltaResponse<GraphMessage>,
      'https://existing-delta-link': {
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=updated',
        value: [
          {
            id: 'msg-2',
            subject: 'Follow up',
            bodyPreview: 'Follow up on the previous email.',
            from: { emailAddress: { name: 'Bob', address: 'bob@co.com' } },
            receivedDateTime: '2026-03-26T11:00:00Z',
          },
        ],
      } satisfies GraphDeltaResponse<GraphMessage>,
    });
    deltaStore = makeMockDeltaStore();
    poller = new GraphPoller(
      graphClient as any,
      deltaStore as any,
      (capture) => { published.push(capture); },
    );
  });

  it('polls mail and publishes a RawCapture', async () => {
    await poller.pollMail('user-1', 'user1@co.com');

    expect(published).toHaveLength(1);
    expect(published[0].sourceType).toBe('graph_email');
    expect(published[0].userId).toBe('user-1');
    expect(published[0].rawContent).toContain('Project update');
  });

  it('saves delta link after polling', async () => {
    await poller.pollMail('user-1', 'user1@co.com');

    expect(deltaStore.setDeltaLink).toHaveBeenCalledWith(
      'user-1',
      'mail',
      'https://graph.microsoft.com/delta?token=new-mail',
    );
  });

  it('uses existing delta link when available', async () => {
    deltaStore.setDeltaLink('user-1', 'mail', 'https://existing-delta-link');

    await poller.pollMail('user-1', 'user1@co.com');

    expect(graphClient.api).toHaveBeenCalledWith('https://existing-delta-link');
    expect(published).toHaveLength(1);
    expect(published[0].rawContent).toContain('Follow up');
  });
});
