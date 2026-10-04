/**
 * Única puerta por la que el resto del backend emite eventos de tiempo real.
 *
 * Existe para que `chats.service.ts` NUNCA importe socket.io. Si el service dependiera del
 * servidor de sockets, testearlo exigiría levantar uno; así se mockea igual que el
 * repository y la regla de capas del proyecto se mantiene.
 *
 * Con el servidor sin registrar todas las funciones son no-op. No es un caso raro: pasa en
 * los tests, en los cron jobs y en cualquier script que importe el service sin levantar el
 * HTTP. Emitir es una notificación best-effort — la fuente de verdad es la base, y el
 * cliente que no recibió el evento se entera igual al refetchear.
 */
import type { Server } from 'socket.io';
import type { MensajeDto } from '../modules/chats/chats.dto';
import type { NotificacionItemDto } from '../modules/notificaciones/notificaciones.dto';
import { EVENTOS, salaChat, salaUsuario } from './eventos';
import { socketsDe } from './presencia';

let io: Server | null = null;

export function registrarServidorSocket(servidor: Server): void {
  io = servidor;
}

/** Para tests y para el apagado ordenado del proceso. */
export function desregistrarServidorSocket(): void {
  io = null;
}

/**
 * Avisa a TODOS los participantes activos que llegó un mensaje, incluido el emisor.
 *
 * Va a las salas PERSONALES y no a la sala del chat: así lo recibe también quien tiene la
 * app abierta en el listado sin la conversación abierta, que es justo el que necesita
 * actualizar el badge y el preview de HU-5.1. Encadenar `.to()` hace que socket.io
 * deduplique — un socket que está en varias de esas salas recibe el evento UNA vez.
 *
 * El emisor lo recibe por diseño: el POST es REST y el server no tiene forma de saber qué
 * socket lo originó, y además el emisor puede tener otros dispositivos que sí lo necesitan.
 * El cliente deduplica por `mensaje.id`, cosa que tiene que hacer igual al reconectar.
 */
export function emitirMensajeNuevo(mensaje: MensajeDto, participantesIds: number[]): void {
  if (!io || participantesIds.length === 0) return;

  const destino = participantesIds.reduce(
    (canal, usuarioId) => canal.to(salaUsuario(usuarioId)),
    io.to(salaUsuario(participantesIds[0]!)),
  );

  destino.emit(EVENTOS.MENSAJE_NUEVO, mensaje);
}

/**
 * Avisa a la sala que alguien leyó la conversación (doble tilde pintado del emisor).
 *
 * Va a la sala del chat y no a las personales porque sólo le importa a quien tiene la
 * pantalla abierta: el que no la tiene abierta ve el estado correcto cuando entra.
 *
 * `hasta` es la fecha del último mensaje que quedó cubierto: con él, el cliente sabe qué
 * burbujas pintar sin tener que asumir que la lectura alcanzó a toda la sala.
 */
export function emitirLeido(chatId: number, usuarioId: number, hasta: string): void {
  io?.to(salaChat(chatId)).emit(EVENTOS.LEIDO, { chatId, usuarioId, hasta });
}

/**
 * Avisa a la sala que a alguien LE LLEGARON los mensajes: el segundo tilde.
 *
 * Misma sala y mismo payload que `emitirLeido`, porque es el mismo hecho contado un paso
 * antes. Se emite aunque el destinatario no tenga la conversación abierta —de eso se trata
 * la entrega—, pero sólo lo escucha quien está mirando la sala, que es el único que tiene
 * burbujas que actualizar.
 */
export function emitirEntregado(chatId: number, usuarioId: number, hasta: string): void {
  io?.to(salaChat(chatId)).emit(EVENTOS.ENTREGADO, { chatId, usuarioId, hasta });
}

/**
 * Baja el badge de una conversación en los OTROS dispositivos de quien leyó.
 *
 * A la sala personal: es información sobre el contador de un usuario, no sobre la
 * conversación. El dispositivo que disparó el marcado ya tiene el dato en la respuesta HTTP.
 */
export function emitirNoLeidos(usuarioId: number, chatId: number, noLeidos: number): void {
  io?.to(salaUsuario(usuarioId)).emit(EVENTOS.NO_LEIDOS, { chatId, noLeidos });
}

/** Cambio de presencia de un participante, para el subtítulo del header de la sala. */
export function emitirPresencia(chatId: number, usuarioId: number, enLinea: boolean): void {
  io?.to(salaChat(chatId)).emit(EVENTOS.PRESENCIA, { chatId, usuarioId, enLinea });
}

/**
 * ¿Alguno de los sockets ABIERTOS de este usuario está, ahora mismo, adentro de la sala de
 * ESTE chat puntual? Es más fino que `estaEnLinea` (presencia.ts): un usuario puede tener la
 * app abierta en otra pantalla y no estar "viendo" esta conversación (spec 004, regla 4).
 *
 * Sin servidor registrado (tests, jobs, scripts) da `false` — mismo criterio best-effort que
 * el resto de este archivo: sin socket no hay a quién preguntarle, así que se asume que no
 * la tiene abierta y se notifica igual.
 */
export function estaEnSalaChat(usuarioId: number, chatId: number): boolean {
  if (!io) return false;

  const socketsDeLaSala = io.sockets.adapter.rooms.get(salaChat(chatId));
  if (!socketsDeLaSala) return false;

  for (const socketId of socketsDe(usuarioId)) {
    if (socketsDeLaSala.has(socketId)) return true;
  }

  return false;
}

/** Notificación nueva de bandeja, a todos los dispositivos abiertos del destinatario. */
export function emitirNotificacionNueva(usuarioId: number, notificacion: NotificacionItemDto): void {
  io?.to(salaUsuario(usuarioId)).emit(EVENTOS.NOTIFICACION_NUEVA, notificacion);
}

/** Contador de no leídas de la campana, recalculado — para no hacerle sumar al cliente. */
export function emitirContadorNotificaciones(usuarioId: number, contador: number): void {
  io?.to(salaUsuario(usuarioId)).emit(EVENTOS.NOTIFICACION_CONTADOR, { contador });
}
