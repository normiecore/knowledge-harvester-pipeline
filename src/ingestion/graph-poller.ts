import { randomUUID } from 'node:crypto';
import type { Client } from '@microsoft/microsoft-graph-client';
import type { RawCapture } from '../types.js';
import type { DeltaStore } from './delta-store.js';
import type {
  GraphDeltaResponse,
  GraphMessage,
  GraphChatMessage,
} from './graph-types.js';

export type PublishFn = (capture: RawCapture) => void;

export class GraphPoller {
  constructor(
    private graphClient: Client,
    private deltaStore: DeltaStore,
    private publish: PublishFn,
  ) {}

  async pollMail(userId: string, userEmail: string): Promise<void> {
    const existing = this.deltaStore.getDeltaLink(userId, 'mail');
    const url =
      existing ?? `/users/${userId}/mailFolders/inbox/messages/delta`;

    const response: GraphDeltaResponse<GraphMessage> =
      await this.graphClient.api(url).get();

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

    if (response['@odata.deltaLink']) {
      this.deltaStore.setDeltaLink(userId, 'mail', response['@odata.deltaLink']);
    }
  }

  async pollTeamsChat(userId: string, userEmail: string): Promise<void> {
    const existing = this.deltaStore.getDeltaLink(userId, 'teams');
    const url =
      existing ?? `/users/${userId}/chats/getAllMessages/delta`;

    const response: GraphDeltaResponse<GraphChatMessage> =
      await this.graphClient.api(url).get();

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

    if (response['@odata.deltaLink']) {
      this.deltaStore.setDeltaLink(userId, 'teams', response['@odata.deltaLink']);
    }
  }
}
