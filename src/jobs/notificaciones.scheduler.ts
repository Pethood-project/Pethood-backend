/**
 * Tareas programadas de la spec 004 (entregable 4): a diferencia de
 * `cancelar-solicitudes-vencidas.job.ts` (CLI + cron del sistema operativo, pensado para
 * cuando NO hay ningún proceso de fondo corriendo), estas usan los *repeatable jobs* de
 * BullMQ — el mismo worker que ya hace falta levantar para la cola de push/mail
 * (`notificaciones.worker.ts`) corre estas corridas periódicas, sin sumar un segundo
 * mecanismo de "background work". Arranca junto al servidor HTTP, mismo proceso
 * (`server.ts`), mismo criterio que los websockets.
 *
 * Todas las tareas de acá son idempotentes (recorren datos y usan `notificarUnaVez` o su
 * propia marca de "ya avisé"): correrlas de más nunca duplica un aviso.
 */
import { Queue, Worker } from 'bullmq';
import { redis } from '../shared/redis';
import { sincronizarTodasLasActivas } from '../modules/seguimiento/seguimiento.service';
import {
  avisarPendientesHaceMucho,
  avisarTransitosProgramados,
} from '../modules/solicitudes/solicitudes.service';
import { avisarPerfilesIncompletos } from '../modules/usuarios/usuarios.service';

const NOMBRE_COLA = 'jobs-programados';

const TAREAS: Record<string, () => Promise<void>> = {
  'sincronizar-seguimientos': () => sincronizarTodasLasActivas(),
  'solicitudes-pendientes-hace-mucho': () => avisarPendientesHaceMucho(),
  'transitos-programados': () => avisarTransitosProgramados(),
  'perfiles-incompletos': () => avisarPerfilesIncompletos(),
};

/** Nombre de tarea → patrón cron. Horarios de la madrugada/mañana para no competir con las
 * horas pico de la API, salvo el de seguimientos, que es horario porque los plazos son de horas. */
const PROGRAMACION: Record<keyof typeof TAREAS, string> = {
  'sincronizar-seguimientos': '0 * * * *',
  'solicitudes-pendientes-hace-mucho': '0 9 * * *',
  'transitos-programados': '0 8 * * *',
  'perfiles-incompletos': '0 10 * * *',
};

const cola = new Queue(NOMBRE_COLA, { connection: redis });
let worker: Worker | null = null;

export async function iniciarJobsProgramados(): Promise<void> {
  for (const [nombre, patron] of Object.entries(PROGRAMACION)) {
    // `upsertJobScheduler`: agregar el mismo scheduler en cada arranque del server actualiza
    // el existente en vez de duplicarlo (BullMQ >= 5.16, reemplaza el viejo `repeat` de `add`).
    await cola.upsertJobScheduler(nombre, { pattern: patron }, { name: nombre });
  }

  worker = new Worker(
    NOMBRE_COLA,
    async (job) => {
      const tarea = TAREAS[job.name];
      if (!tarea) throw new Error(`Job programado desconocido: ${job.name}`);
      await tarea();
    },
    { connection: redis },
  );

  worker.on('failed', (job, err) => {
    console.error(`❌ Job programado "${job?.name}" falló:`, err);
  });
}

export async function detenerJobsProgramados(): Promise<void> {
  await worker?.close();
  worker = null;
}
