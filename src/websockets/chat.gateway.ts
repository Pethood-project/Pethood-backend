/**
 * Eventos de la sala de chat (HU-5.2).
 *
 * Acá NO se escribe nada: enviar un mensaje es un POST REST. El socket es un canal de
 * entrega —server → cliente— más los dos eventos de control que necesita para saber a qué
 * sala mandar. Eso deja una sola ruta de escritura, con una sola validación, un solo manejo
 * de errores y sin duplicar el pipeline de multipart.
 *
 * La autorización de `chat:unirse` es la MISMA función que usan los endpoints REST
 * (`exigirParticipante`): un usuario no puede escuchar una sala en la que no participa, y la
 * regla no puede divergir entre los dos canales porque es una sola.
 */
import type { Server, Socket } from 'socket.io';
import { AppError } from '../middlewares/errorHandler';
import { exigirParticipante } from '../modules/chats/chats.service';
import type { DatosSocket } from './auth';
import { programarVencimiento } from './auth';
import { EVENTOS, salaChat, salaUsuario } from './eventos';
import * as emisor from './emisor';
import { registrarConexion, registrarDesconexion } from './presencia';

/**
 * Respuesta de los eventos cliente → server.
 *
 * El socket no tiene códigos HTTP, así que el error viaja por el ack —correlacionado con el
 * pedido que lo causó, a diferencia de un evento suelto— y con la MISMA forma
 * `{ error: { codigo, mensaje } }` que devuelve la API REST. El cliente reusa su parser de
 * errores y el `mensaje` se muestra tal cual, igual que en un toast de REST.
 */
export type Ack<T> =
  { ok: true; datos: T } | { ok: false; error: { codigo: string; mensaje: string } };

function aError(err: unknown): { codigo: string; mensaje: string } {
  if (err instanceof AppError) {
    return { codigo: err.codigo, mensaje: err.mensaje };
  }

  console.error('Error no controlado en websocket:', err);
  return { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado' };
}

/** El ack es opcional del lado del cliente: si no mandó callback, no se responde. */
function responder<T>(ack: unknown, respuesta: Ack<T>): void {
  if (typeof ack === 'function') (ack as (r: Ack<T>) => void)(respuesta);
}

function chatIdValido(valor: unknown): number | null {
  const chatId = Number((valor as { chatId?: unknown })?.chatId);
  return Number.isInteger(chatId) && chatId > 0 ? chatId : null;
}

/** Salas de chat a las que pertenece este socket (descarta la propia y la personal). */
function salasDeChat(socket: Socket): number[] {
  return [...socket.rooms]
    .filter((sala) => sala.startsWith('chat:'))
    .map((sala) => Number(sala.slice('chat:'.length)))
    .filter((chatId) => Number.isInteger(chatId));
}

function alConectar(socket: Socket): void {
  const { usuarioId } = socket.data as DatosSocket;

  programarVencimiento(socket);

  // La sala personal es lo que permite avisarle a alguien que llegó un mensaje aunque no
  // tenga esa conversación abierta. Se une siempre, apenas se autentica.
  void socket.join(salaUsuario(usuarioId));
  registrarConexion(usuarioId, socket.id);

  socket.on(EVENTOS.UNIRSE, (carga: unknown, ack?: unknown) => {
    const chatId = chatIdValido(carga);

    if (chatId === null) {
      responder(ack, {
        ok: false,
        error: { codigo: 'VALIDACION', mensaje: 'La conversación no es válida' },
      });
      return;
    }

    // Verificar ANTES de unir: si se uniera primero, el socket ya estaría recibiendo
    // mensajes de la sala mientras se resuelve la promesa.
    exigirParticipante(usuarioId, chatId)
      .then(async () => {
        await socket.join(salaChat(chatId));

        // Avisarle a quien ya está en la sala que este usuario está en línea. Es acá y no al
        // conectar porque al conectar el socket todavía no pertenece a ninguna sala, así que
        // no habría a quién avisarle.
        emisor.emitirPresencia(chatId, usuarioId, true);

        responder(ack, { ok: true, datos: { chatId } });
      })
      .catch((err) => responder(ack, { ok: false, error: aError(err) }));
  });

  socket.on(EVENTOS.SALIR, (carga: unknown, ack?: unknown) => {
    const chatId = chatIdValido(carga);

    if (chatId === null) {
      responder(ack, {
        ok: false,
        error: { codigo: 'VALIDACION', mensaje: 'La conversación no es válida' },
      });
      return;
    }

    // Sin evento de presencia: cerrar la conversación no es desconectarse de la app.
    void socket.leave(salaChat(chatId));
    responder(ack, { ok: true, datos: { chatId } });
  });

  // `disconnecting` y no `disconnect`: en `disconnect` el socket ya salió de todas sus
  // salas y no quedaría a quién avisarle.
  socket.on('disconnecting', () => {
    const salas = salasDeChat(socket);

    if (!registrarDesconexion(usuarioId, socket.id)) return;

    // Recién cuando cae el ÚLTIMO socket el usuario está fuera de línea: con el celular y la
    // web abiertos, cerrar una de las dos no lo desconecta.
    for (const chatId of salas) {
      emisor.emitirPresencia(chatId, usuarioId, false);
    }
  });
}

export function instalarGatewayDeChat(io: Server): void {
  io.on('connection', alConectar);
}
