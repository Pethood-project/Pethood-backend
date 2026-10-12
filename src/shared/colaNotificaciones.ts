/**
 * Cola BullMQ para el envío de push y mail en segundo plano, con reintentos (spec 004,
 * entregable 2). Vive en `shared/` porque la definición de la cola (nombre, conexión,
 * opciones de reintento) es transversal — quien la PROCESA (el worker, con acceso al
 * repository para dar de baja dispositivos inválidos) vive en
 * `modules/notificaciones/notificaciones.worker.ts`, no acá, para no romper la regla de que
 * `shared/` no conoce módulos de negocio.
 *
 * El worker corre en el MISMO proceso que Express y los websockets (`server.ts`) — mismo
 * criterio que ya usa `websockets/index.ts`: no hace falta un segundo servicio, solo Redis.
 */
import { Queue } from 'bullmq';
import { redis } from './redis';

export const NOMBRE_COLA_NOTIFICACIONES = 'notificaciones';

export interface JobEnviarPush {
  /** Todos los tokens activos del destinatario: un solo job por notificación, no por dispositivo. */
  tokens: string[];
  titulo: string;
  cuerpo: string;
  datos?: Record<string, unknown>;
  silencioso?: boolean;
  /** Cantidad de no leídas, para el número en el ícono de la app. */
  badge?: number;
}

export interface JobEnviarMail {
  to: string;
  asunto: string;
  texto: string;
}

export const colaNotificaciones = new Queue(NOMBRE_COLA_NOTIFICACIONES, { connection: redis });

const OPCIONES_REINTENTO = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  // No hace falta guardar el historial de jobs completados/fallidos más de lo necesario
  // para debuguear: la fuente de verdad ya quedó escrita en `Notificacion`.
  removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
  removeOnFail: { age: 60 * 60 * 24 * 7 },
} as const;

export async function encolarEnvioPush(job: JobEnviarPush): Promise<void> {
  await colaNotificaciones.add('enviar-push', job, OPCIONES_REINTENTO);
}

export async function encolarEnvioMail(job: JobEnviarMail): Promise<void> {
  await colaNotificaciones.add('enviar-mail', job, OPCIONES_REINTENTO);
}
