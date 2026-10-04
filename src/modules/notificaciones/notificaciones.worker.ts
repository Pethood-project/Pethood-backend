/**
 * Procesa la cola de envío de push y mail (spec 004). La definición de la cola vive en
 * `shared/colaNotificaciones.ts` (transversal); el procesamiento vive acá porque necesita el
 * repository del módulo (dar de baja un dispositivo cuando Expo lo marca como inválido).
 *
 * Se arranca una sola vez, junto a los websockets (`server.ts`) — mismo proceso, misma
 * filosofía de despliegue que ya usa el chat.
 */
import { Worker, type Job } from 'bullmq';
import type { JobEnviarMail, JobEnviarPush } from '../../shared/colaNotificaciones';
import { NOMBRE_COLA_NOTIFICACIONES } from '../../shared/colaNotificaciones';
import { enviarMail } from '../../shared/mail';
import { enviarPush } from '../../shared/push';
import { redis } from '../../shared/redis';
import * as repo from './notificaciones.repository';

async function procesarPush(job: Job<JobEnviarPush>): Promise<void> {
  const { tokensInvalidos } = await enviarPush(job.data);

  await Promise.all(tokensInvalidos.map((token) => repo.darDeBajaDispositivoPorToken(token)));
}

async function procesarMail(job: Job<JobEnviarMail>): Promise<void> {
  await enviarMail(job.data);
}

let worker: Worker | null = null;

export function iniciarWorkerNotificaciones(): Worker {
  worker = new Worker(
    NOMBRE_COLA_NOTIFICACIONES,
    async (job) => {
      if (job.name === 'enviar-push') return procesarPush(job as Job<JobEnviarPush>);
      if (job.name === 'enviar-mail') return procesarMail(job as Job<JobEnviarMail>);

      throw new Error(`Job desconocido en la cola de notificaciones: ${job.name}`);
    },
    { connection: redis },
  );

  worker.on('failed', (job, err) => {
    console.error(`❌ Job de notificaciones "${job?.name}" (${job?.id}) falló:`, err);
  });

  return worker;
}

export async function detenerWorkerNotificaciones(): Promise<void> {
  await worker?.close();
  worker = null;
}
