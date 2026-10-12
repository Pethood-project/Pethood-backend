/**
 * Conexión Redis compartida para BullMQ (spec 004).
 *
 * BullMQ exige `maxRetriesPerRequest: null` en la conexión que le pasás — si no, ioredis
 * corta los comandos bloqueantes que la librería necesita para esperar jobs nuevos. Ver
 * https://docs.bullmq.io/guide/connections.
 *
 * Una sola instancia para toda la app (queue + worker + los que quieran usarla), igual
 * criterio que `shared/prisma.ts`.
 */
import IORedis from 'ioredis';
import { env } from '../config/env';

export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
