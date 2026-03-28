import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphPoller } from '../../src/ingestion/graph-poller.js';
import type { RawCapture } from '../../src/types.js';
import type { GraphDeltaResponse, GraphMessage, GraphChatMessage, GraphCalendarEvent, GraphDriveItem, GraphTodoTask, GraphTodoTaskList } from '../../src/ingestion/graph-types.js';

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

  it('polls calendar events and publishes captures', async () => {
    const calClient = makeMockGraphClient({
      '/users/user-1/events/delta': {
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=cal',
        value: [
          {
            id: 'evt-1',
            subject: 'Sprint Planning',
            bodyPreview: 'Discuss sprint goals',
            start: { dateTime: '2026-03-27T09:00:00', timeZone: 'UTC' },
            end: { dateTime: '2026-03-27T10:00:00', timeZone: 'UTC' },
            location: { displayName: 'Room A' },
            organizer: { emailAddress: { name: 'Alice', address: 'alice@co.com' } },
            attendees: [{ emailAddress: { name: 'Bob', address: 'bob@co.com' }, type: 'required' }],
          },
        ],
      } satisfies GraphDeltaResponse<GraphCalendarEvent>,
    });
    const calDelta = makeMockDeltaStore();
    const calPublished: RawCapture[] = [];
    const calPoller = new GraphPoller(calClient as any, calDelta as any, (c) => { calPublished.push(c); });

    await calPoller.pollCalendar('user-1', 'user1@co.com');

    expect(calPublished).toHaveLength(1);
    expect(calPublished[0].sourceType).toBe('graph_calendar');
    expect(calPublished[0].rawContent).toContain('Sprint Planning');
    expect(calPublished[0].rawContent).toContain('Room A');
    expect(calDelta.setDeltaLink).toHaveBeenCalledWith('user-1', 'calendar', expect.any(String));
  });

  it('polls OneDrive file changes and skips folders', async () => {
    const driveClient = makeMockGraphClient({
      '/users/user-1/drive/root/delta': {
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=drive',
        value: [
          {
            id: 'file-1',
            name: 'specs.docx',
            webUrl: 'https://sharepoint.com/specs.docx',
            lastModifiedDateTime: '2026-03-27T08:00:00Z',
            lastModifiedBy: { user: { displayName: 'Alice', id: 'u1' } },
            parentReference: { driveId: 'd1', path: '/root:/Documents' },
            file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
            size: 24000,
          },
          {
            id: 'folder-1',
            name: 'Documents',
            webUrl: 'https://sharepoint.com/Documents',
            lastModifiedDateTime: '2026-03-27T07:00:00Z',
            folder: { childCount: 5 },
          },
        ],
      } satisfies GraphDeltaResponse<GraphDriveItem>,
    });
    const driveDelta = makeMockDeltaStore();
    const drivePublished: RawCapture[] = [];
    const drivePoller = new GraphPoller(driveClient as any, driveDelta as any, (c) => { drivePublished.push(c); });

    await drivePoller.pollOneDrive('user-1', 'user1@co.com');

    expect(drivePublished).toHaveLength(1); // folder skipped
    expect(drivePublished[0].sourceType).toBe('graph_document');
    expect(drivePublished[0].rawContent).toContain('specs.docx');
    expect(driveDelta.setDeltaLink).toHaveBeenCalledWith('user-1', 'onedrive', expect.any(String));
  });

  it('follows @odata.nextLink for pagination', async () => {
    const paginatedClient = makeMockGraphClient({
      '/users/user-1/mailFolders/inbox/messages/delta': {
        '@odata.nextLink': 'https://graph.microsoft.com/delta?page=2',
        value: [
          {
            id: 'msg-page1',
            subject: 'Page 1 message',
            bodyPreview: 'First page content.',
            from: { emailAddress: { name: 'Alice', address: 'alice@co.com' } },
            receivedDateTime: '2026-03-26T10:00:00Z',
          },
        ],
      } satisfies GraphDeltaResponse<GraphMessage>,
      'https://graph.microsoft.com/delta?page=2': {
        '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=final',
        value: [
          {
            id: 'msg-page2',
            subject: 'Page 2 message',
            bodyPreview: 'Second page content.',
            from: { emailAddress: { name: 'Bob', address: 'bob@co.com' } },
            receivedDateTime: '2026-03-26T11:00:00Z',
          },
        ],
      } satisfies GraphDeltaResponse<GraphMessage>,
    });
    const paginatedDeltaStore = makeMockDeltaStore();
    const paginatedPublished: RawCapture[] = [];
    const paginatedPoller = new GraphPoller(
      paginatedClient as any,
      paginatedDeltaStore as any,
      (capture) => { paginatedPublished.push(capture); },
    );

    await paginatedPoller.pollMail('user-1', 'user1@co.com');

    expect(paginatedPublished).toHaveLength(2);
    expect(paginatedPublished[0].rawContent).toContain('Page 1 message');
    expect(paginatedPublished[1].rawContent).toContain('Page 2 message');
    expect(paginatedDeltaStore.setDeltaLink).toHaveBeenCalledWith(
      'user-1',
      'mail',
      'https://graph.microsoft.com/delta?token=final',
    );
  });

  it('polls To-Do tasks and publishes captures', async () => {
    const todoClient = makeMockGraphClient({
      '/users/user-1/todo/lists': {
        value: [{ id: 'list-1', displayName: 'Work Tasks' }] satisfies GraphTodoTaskList[],
      },
      '/users/user-1/todo/lists/list-1/tasks?$filter=lastModifiedDateTime gt 1970-01-01T00:00:00Z&$orderby=lastModifiedDateTime desc&$top=50': {
        value: [
          {
            id: 'task-1',
            title: 'Review subsea connector specs',
            body: { content: 'Check pressure ratings', contentType: 'text' },
            status: 'notStarted',
            importance: 'high',
            createdDateTime: '2026-03-27T08:00:00Z',
            lastModifiedDateTime: '2026-03-27T09:00:00Z',
            dueDateTime: { dateTime: '2026-03-28T17:00:00', timeZone: 'UTC' },
          },
        ] satisfies GraphTodoTask[],
      },
    });
    const todoDelta = makeMockDeltaStore();
    const todoPublished: RawCapture[] = [];
    const todoPoller = new GraphPoller(todoClient as any, todoDelta as any, (c) => { todoPublished.push(c); });

    await todoPoller.pollTodoTasks('user-1', 'user1@co.com');

    expect(todoPublished).toHaveLength(1);
    expect(todoPublished[0].sourceType).toBe('graph_task');
    expect(todoPublished[0].rawContent).toContain('Review subsea connector specs');
    expect(todoPublished[0].rawContent).toContain('Work Tasks');
    expect(todoDelta.setDeltaLink).toHaveBeenCalledWith('user-1', 'todo', expect.any(String));
  });

  it('follows @odata.nextLink pagination in pollTodoTasks', async () => {
    const tasksPage1Url = '/users/user-1/todo/lists/list-1/tasks?$filter=lastModifiedDateTime gt 1970-01-01T00:00:00Z&$orderby=lastModifiedDateTime desc&$top=50';
    const tasksPage2Url = 'https://graph.microsoft.com/v1.0/todo/tasks?page=2';

    const todoClient = makeMockGraphClient({
      '/users/user-1/todo/lists': {
        value: [{ id: 'list-1', displayName: 'Work Tasks' }] satisfies GraphTodoTaskList[],
      },
      [tasksPage1Url]: {
        '@odata.nextLink': tasksPage2Url,
        value: [
          {
            id: 'task-1',
            title: 'First page task',
            body: { content: 'Task on page 1', contentType: 'text' },
            status: 'notStarted',
            importance: 'normal',
            createdDateTime: '2026-03-27T08:00:00Z',
            lastModifiedDateTime: '2026-03-27T09:00:00Z',
          },
        ] satisfies GraphTodoTask[],
      },
      [tasksPage2Url]: {
        value: [
          {
            id: 'task-2',
            title: 'Second page task',
            body: { content: 'Task on page 2', contentType: 'text' },
            status: 'completed',
            importance: 'high',
            createdDateTime: '2026-03-27T10:00:00Z',
            lastModifiedDateTime: '2026-03-27T11:00:00Z',
          },
        ] satisfies GraphTodoTask[],
      },
    });
    const todoDelta = makeMockDeltaStore();
    const todoPublished: RawCapture[] = [];
    const todoPoller = new GraphPoller(todoClient as any, todoDelta as any, (c) => { todoPublished.push(c); });

    await todoPoller.pollTodoTasks('user-1', 'user1@co.com');

    expect(todoPublished).toHaveLength(2);
    expect(todoPublished[0].rawContent).toContain('First page task');
    expect(todoPublished[1].rawContent).toContain('Second page task');
    // Verify both pages were fetched
    expect(todoClient.api).toHaveBeenCalledWith(tasksPage1Url);
    expect(todoClient.api).toHaveBeenCalledWith(tasksPage2Url);
  });
});
