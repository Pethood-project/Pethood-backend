/**
 * Envío de mail transaccional (spec 004) vía Resend — elegido por ser gratis (3000/mes) y
 * tener un SDK de Node de una sola función. Se reserva para cuenta, seguridad, decisiones
 * sobre solicitudes y vencimientos (regla 2 del documento de notificaciones); el resto de
 * los canales (push, bandeja) no pasan por acá.
 *
 * Mismo criterio que R2 (`shared/r2.ts`): sin `RESEND_API_KEY` configurada, no se rompe nada,
 * solo se loguea y no se envía. Así el server arranca en cualquier ambiente sin la key.
 */
import { Resend } from 'resend';
import { env } from '../config/env';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export interface MailAEnviar {
  to: string;
  asunto: string;
  texto: string;
}

export async function enviarMail(mail: MailAEnviar): Promise<void> {
  if (!resend) {
    console.warn(`✉️  RESEND_API_KEY no configurada — no se envía mail a ${mail.to}: ${mail.asunto}`);
    return;
  }

  const { error } = await resend.emails.send({
    from: env.MAIL_FROM,
    to: mail.to,
    subject: mail.asunto,
    text: mail.texto,
  });

  // Resend no tira excepción en un fallo de la API: lo devuelve en `error`. Se traduce a
  // excepción acá para que el job de BullMQ que lo llama pueda reintentar.
  if (error) {
    throw new Error(`Resend: ${error.name} — ${error.message}`);
  }
}
