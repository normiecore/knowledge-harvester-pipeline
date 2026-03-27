import { logger } from '../config/logger.js';
import {
  connect,
  type NatsConnection,
  type Subscription,
  StringCodec,
} from 'nats';

const sc = StringCodec();

export class NatsClient {
  private connection: NatsConnection | null = null;

  async connect(url: string): Promise<void> {
    this.connection = await connect({
      servers: url,
      reconnect: true,
      maxReconnectAttempts: -1, // unlimited
      reconnectTimeWait: 2000,  // 2s between attempts
    });

    // Log reconnect events
    (async () => {
      if (!this.connection) return;
      for await (const status of this.connection.status()) {
        switch (status.type) {
          case 'reconnecting':
            logger.warn('NATS reconnecting...');
            break;
          case 'reconnect':
            logger.info('NATS reconnected');
            break;
          case 'disconnect':
            logger.warn('NATS disconnected');
            break;
        }
      }
    })();
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.drain();
      this.connection = null;
    }
  }

  publish(topic: string, data: unknown): void {
    if (!this.connection) {
      throw new Error('NATS client is not connected');
    }
    this.connection.publish(topic, sc.encode(JSON.stringify(data)));
  }

  subscribe(
    topic: string,
    handler: (data: unknown) => void | Promise<void>,
  ): Subscription {
    if (!this.connection) {
      throw new Error('NATS client is not connected');
    }
    const sub = this.connection.subscribe(topic);
    (async () => {
      for await (const msg of sub) {
        try {
          const parsed: unknown = JSON.parse(sc.decode(msg.data));
          await handler(parsed);
        } catch (err) {
          logger.error({ topic, err }, 'Error processing NATS message');
        }
      }
    })();
    return sub;
  }

  isConnected(): boolean {
    return this.connection !== null;
  }
}
