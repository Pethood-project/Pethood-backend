import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { historialQuerySchema } from './chats.dto';
import * as service from './chats.service';

/**
 * El `:chatId` de la URL. Un id no numérico es 404 y no 400: `/chats/hola/mensajes` no es
 * una conversación mal pedida, es una ruta que no identifica ningún recurso.
 */
function exigirChatId(req: Request): number {
  const chatId = Number(req.params.chatId);

  if (!Number.isInteger(chatId) || chatId <= 0) {
    throw new AppError('NO_ENCONTRADO', 'La conversación no existe', 404);
  }

  return chatId;
}

/**
 * HU-5.1. Devuelve el total además del listado, para el badge de la pestaña Chat.
 *
 * No recibe nada: el único dato de entrada es quién pregunta, y sale del token. Un usuario
 * sin conversaciones recibe 200 con la lista vacía — el empty state es un estado normal de
 * la pantalla, no un error.
 */
export async function listar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listarConversaciones(req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** HU-5.2. Cabecera de GUI-14: contacto ya resuelto y presencia, sin pasar por el listado. */
export async function obtenerCabecera(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chatId = exigirChatId(req);
    res.json(await service.obtenerCabecera(req.usuario!.usuarioId, chatId));
  } catch (err) {
    next(err);
  }
}

/**
 * HU-5.2. Historial paginado por cursor.
 *
 * La query se valida acá y no con `validar(...)` porque ese middleware es de body. Mismo
 * criterio que los listados de admin-usuarios.
 */
export async function listarMensajes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chatId = exigirChatId(req);
    const resultado = historialQuerySchema.safeParse(req.query);

    if (!resultado.success) {
      const primero = resultado.error.issues[0];
      throw new AppError('VALIDACION', primero?.message ?? 'Parámetros inválidos', 400);
    }

    res.json(await service.listarHistorial(req.usuario!.usuarioId, chatId, resultado.data));
  } catch (err) {
    next(err);
  }
}

/**
 * HU-5.2. Envío. 201 con el mensaje ya persistido: cuando el cliente lo recibe, el id y la
 * fecha son los definitivos y el broadcast a la sala ya salió.
 */
export async function enviarMensaje(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const chatId = exigirChatId(req);

    const mensaje = await service.enviarMensaje(req.body, {
      usuarioId: req.usuario!.usuarioId,
      chatId,
      archivo: req.file,
    });

    res.status(201).json(mensaje);
  } catch (err) {
    next(err);
  }
}

/** HU-5.2. Marca leída la conversación al abrirla. Devuelve el contador para HU-5.1. */
export async function marcarLeidos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const chatId = exigirChatId(req);
    res.json(await service.marcarLeidos(req.usuario!.usuarioId, chatId));
  } catch (err) {
    next(err);
  }
}
