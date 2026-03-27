import type { FastifyInstance } from 'fastify';
import { RawCaptureSchema } from '../../types.js';
import { TOPICS } from '../../queue/topics.js';
import type { NatsClient } from '../../queue/nats-client.js';

interface CaptureRoutesOpts {
  natsClient: NatsClient;
}

/**
 * POST /api/captures — accepts a RawCapture from the desktop agent
 * and publishes it to NATS for pipeline processing.
 */
export async function captureRoutes(
  app: FastifyInstance,
  opts: CaptureRoutesOpts,
): Promise<void> {
  const { natsClient } = opts;

  app.post('/api/captures', async (req, reply) => {
    const parseResult = RawCaptureSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'Invalid capture payload',
        details: parseResult.error.issues,
      });
    }

    const capture = parseResult.data;
    natsClient.publish(TOPICS.RAW_CAPTURES, capture);

    return reply.code(202).send({ accepted: true, id: capture.id });
  });
}
