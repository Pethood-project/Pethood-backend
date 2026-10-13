/**
 * Envío de push vía Expo Push Notifications (spec 004) — nativo del stack (Expo SDK 57), sin
 * credenciales de FCM/APNs propias que administrar.
 *
 * El texto NUNCA lleva datos sensibles (regla 6: se ve en pantalla bloqueada) — eso lo
 * garantiza quien arma el `mensaje` en `notificaciones.service.ts`, no este archivo.
 */
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { env } from '../config/env';

const expo = new Expo({ accessToken: env.EXPO_ACCESS_TOKEN });

export interface PushAEnviar {
  tokens: string[];
  titulo: string;
  cuerpo: string;
  /** Para navegar al tocarla (mismo `entidadTipo`/`entidadId` que la fila de bandeja). */
  datos?: Record<string, unknown>;
  /** Regla 7: avisos no urgentes no suenan de noche — se entregan igual, sin sonido. */
  silencioso?: boolean;
  /** Número que se muestra en el ícono de la app (no leídas). */
  badge?: number;
}

export interface ResultadoEnvioPush {
  /** Tokens que Expo marcó como inválidos (`DeviceNotRegistered`) — dar de baja el dispositivo. */
  tokensInvalidos: string[];
}

/**
 * Manda a todos los tokens de una sola tanda de dispositivos (ya se asume que son de UN
 * usuario, filtrados por quien llama). Expo arma sus propios chunks de a 100 mensajes.
 *
 * Solo se detectan acá los tokens inválidos que Expo reporta EN EL TICKET (sincrónico). La
 * otra vía —los "recibos", que se piden un rato después con
 * `getPushNotificationReceiptsAsync`— cubriría además el caso de una desinstalación detectada
 * más tarde; se deja fuera a propósito por ahora (no rompe nada, solo esa baja tarda hasta
 * el próximo push fallido en lugar de ser inmediata).
 */
export async function enviarPush(pedido: PushAEnviar): Promise<ResultadoEnvioPush> {
  const mensajes: ExpoPushMessage[] = pedido.tokens
    .filter((token) => Expo.isExpoPushToken(token))
    .map((token) => ({
      to: token,
      title: pedido.titulo,
      body: pedido.cuerpo,
      data: pedido.datos,
      sound: pedido.silencioso ? undefined : 'default',
      badge: pedido.badge,
      priority: 'default',
    }));

  if (mensajes.length === 0) return { tokensInvalidos: [] };

  const chunks = expo.chunkPushNotifications(mensajes);
  const tickets: ExpoPushTicket[] = [];

  for (const chunk of chunks) {
    tickets.push(...(await expo.sendPushNotificationsAsync(chunk)));
  }

  const tokensInvalidos: string[] = [];
  tickets.forEach((ticket, indice) => {
    if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
      tokensInvalidos.push(mensajes[indice]!.to as string);
    }
  });

  return { tokensInvalidos };
}
