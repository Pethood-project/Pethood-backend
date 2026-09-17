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
import { EVENTOS, salaChat, salaUsuario } from './eventos';

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
 * Avisa a la sala que alguien leyó la conversación (doble check del emisor).
 *
 * Va a la sala del chat y no a las personales porque sólo le importa a quien tiene la
 * pantalla abierta: el que no la tiene abierta ve el estado correcto cuando entra.
 */
export function emitirLeido(chatId: number, usuarioId: number): void {
  io?.to(salaChat(chatId)).emit(EVENTOS.LEIDO, { chatId, usuarioId });
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
