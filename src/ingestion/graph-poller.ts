import { randomUUID } from 'node:crypto';
import type { Client } from '@microsoft/microsoft-graph-client';
import type { RawCapture } from '../types.js';
import type { DeltaStore } from './delta-store.js';
import type {
  GraphDeltaResponse,
  GraphMessage,
  GraphChatMessage,
  GraphCalendarEvent,
  GraphDriveItem,
} from './graph-types.js';
import { retryWithBackoff, RetryableError } from './graph-retry.js';

export type PublishFn = (capture: RawCapture) => void;

const RETRY_OPTS = { maxRetries: 3, baseDelayMs: 1000 };

export class GraphPoller {
  constructor(
    private graphClient: Client,
    private deltaStore: DeltaStore,
    private publish: PublishFn,
  ) {}

  private async fetchWithRetry<T>(url: string): Promise<T> {
    return retryWithBackoff(
      async () => {
        try {
          return await this.graphClient.api(url).get();
        } catch (err: any) {
          if (err.statusCode === 429 || err.statusCode === 503) {
            const retryAfter = err.headers?.['retry-after']
              ? Number(err.headers['retry-after'])
              : undefined;
            throw new RetryableError(err.statusCode, err.message, retryAfter);
          }
          throw err;
        }
      },
      RETRY_OPTS,
    );
  }

  async pollMail(userId: string, userEmail: string): Promise<void> {
    let url: string | undefined =
      this.deltaStore.getDeltaLink(userId, 'mail') ??
      `/users/${userId}/mailFolders/inbox/messages/delta`;
    let deltaLink: string | undefined;

    while (url) {
      const response: GraphDeltaResponse<GraphMessage> =
        await this.fetchWithRetry(url);

      for (const msg of response.value) {
        const capture: RawCapture = {
          id: randomUUID(),
          userId,
          userEmail,
          sourceType: 'graph_email',
          sourceApp: 'outlook',
          capturedAt: msg.receivedDateTime,
          rawContent: JSON.stringify({
            subject: msg.subject,
            bodyPreview: msg.bodyPreview,
            from: msg.from?.emailAddress,
          }),
          metadata: { messageId: msg.id },
        };
        this.publish(capture);
      }

      deltaLink = response['@odata.deltaLink'];
      url = response['@odata.nextLink'];
    }

    if (deltaLink) {
      this.deltaStore.setDeltaLink(userId, 'mail', deltaLink);
    }
  }

  async pollTeamsChat(userId: string, userEmail: string): Promise<void> {
    let url: string | undefined =
      this.deltaStore.getDeltaLink(userId, 'teams') ??
      `/users/${userId}/chats/getAllMessages/delta`;
    let deltaLink: string | undefined;

    while (url) {
      const response: GraphDeltaResponse<GraphChatMessage> =
        await this.fetchWithRetry(url);

      for (const msg of response.value) {
        if (msg.messageType !== 'message') continue;

        const capture: RawCapture = {
          id: randomUUID(),
          userId,
          userEmail,
          sourceType: 'graph_teams',
          sourceApp: 'teams',
          capturedAt: msg.createdDateTime,
          rawContent: JSON.stringify({
            body: msg.body?.content,
            from: msg.from?.user?.displayName,
            chatId: msg.chatId,
          }),
          metadata: { messageId: msg.id },
        };
        this.publish(capture);
      }

      deltaLink = response['@odata.deltaLink'];
      url = response['@odata.nextLink'];
    }

    if (deltaLink) {
      this.deltaStore.setDeltaLink(userId, 'teams', deltaLink);
    }
  }

  async pollCalendar(userId: string, userEmail: string): Promise<void> {
    let url: string | undefined =
      this.deltaStore.getDeltaLink(userId, 'calendar') ??
      `/users/${userId}/events/delta`;
    let deltaLink: string | undefined;

    while (url) {
      const response: GraphDeltaResponse<GraphCalendarEvent> =
        await this.fetchWithRetry(url);

      for (const event of response.value) {
        const capture: RawCapture = {
          id: randomUUID(),
          userId,
          userEmail,
          sourceType: 'graph_calendar',
          sourceApp: 'outlook_calendar',
          capturedAt: event.start.dateTime,
          rawContent: JSON.stringify({
            subject: event.subject,
            bodyPreview: event.bodyPreview,
            start: event.start,
            end: event.end,
            location: event.location?.displayName,
            organizer: event.organizer?.emailAddress,
            attendees: event.attendees?.map((a) => a.emailAddress.name),
            isAllDay: event.isAllDay,
          }),
          metadata: { eventId: event.id },
        };
        this.publish(capture);
      }

      deltaLink = response['@odata.deltaLink'];
      url = response['@odata.nextLink'];
    }

    if (deltaLink) {
      this.deltaStore.setDeltaLink(userId, 'calendar', deltaLink);
    }
  }

  async pollOneDrive(userId: string, userEmail: string): Promise<void> {
    let url: string | undefined =
      this.deltaStore.getDeltaLink(userId, 'onedrive') ??
      `/users/${userId}/drive/root/delta`;
    let deltaLink: string | undefined;

    while (url) {
      const response: GraphDeltaResponse<GraphDriveItem> =
        await this.fetchWithRetry(url);

      for (const item of response.value) {
        // Skip folders — only capture file changes
        if (item.folder) continue;

        const capture: RawCapture = {
          id: randomUUID(),
          userId,
          userEmail,
          sourceType: 'graph_document',
          sourceApp: 'onedrive',
          capturedAt: item.lastModifiedDateTime,
          rawContent: JSON.stringify({
            name: item.name,
            webUrl: item.webUrl,
            path: item.parentReference?.path,
            mimeType: item.file?.mimeType,
            size: item.size,
            lastModifiedBy: item.lastModifiedBy?.user?.displayName,
          }),
          metadata: {
            driveItemId: item.id,
            driveId: item.parentReference?.driveId,
          },
        };
        this.publish(capture);
      }

      deltaLink = response['@odata.deltaLink'];
      url = response['@odata.nextLink'];
    }

    if (deltaLink) {
      this.deltaStore.setDeltaLink(userId, 'onedrive', deltaLink);
    }
  }
}
