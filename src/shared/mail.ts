/**
 * Envío de mail transaccional (spec 004) por SMTP con nodemailer — hoy contra una cuenta de
 * Gmail (contraseña de aplicación), que entrega a cualquier destinatario sin dominio propio.
 * Se reserva para cuenta, seguridad, decisiones sobre solicitudes y vencimientos (regla 2
 * del documento de notificaciones); el resto de los canales (push, bandeja) no pasan por acá.
 *
 * Mismo criterio que R2 (`shared/r2.ts`): sin `SMTP_USER`/`SMTP_PASS` configurados, no se
 * rompe nada, solo se loguea y no se envía. Así el server arranca en cualquier ambiente.
 */
import nodemailer from 'nodemailer';
import { env } from '../config/env';

const transporter =
  env.SMTP_USER && env.SMTP_PASS
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      })
    : null;

export interface MailAEnviar {
  to: string;
  asunto: string;
  texto: string;
}

export async function enviarMail(mail: MailAEnviar): Promise<void> {
  if (!transporter) {
    console.warn(`✉️  SMTP no configurado — no se envía mail a ${mail.to}: ${mail.asunto}`);
    return;
  }

  // Si falla, nodemailer tira excepción: el job de BullMQ que lo llama reintenta.
  await transporter.sendMail({
    from: env.MAIL_FROM ?? `PetHood <${env.SMTP_USER}>`,
    to: mail.to,
    subject: mail.asunto,
    text: mail.texto,
  });
}
