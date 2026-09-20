import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { uploadImagenesOpcional } from '../../middlewares/uploadImagen';
import { validar } from '../../middlewares/validar';
import { LIMITES } from '../../shared/validation/limits';
import * as controller from './chats.controller';
import { enviarMensajeSchema } from './chats.dto';

export const chatsRouter = Router();

// Sin middleware de roles en todo el módulo, a propósito: cualquier usuario autenticado
// puede ver SUS conversaciones, y quién participa de cada sala lo define UsuarioChat, no el
// rol. La autorización de las rutas de sala es `exigirParticipante` en el service.
chatsRouter.use(autenticar);

// HU-5.1: listado de GUI-08 / GUI-31, ordenado por fecha del último mensaje descendente.
//
// Sin `validar(...)`: el endpoint no recibe body ni query params. Cuando HU-5.3 sume la
// búsqueda por nombre de contacto, el schema se compone en chats.dto.ts y se engancha acá.
chatsRouter.get('/', controller.listar);

// HU-5.2: cabecera de la sala (GUI-14). Existe para que abrir el chat desde una notificación
// o un deep link no dependa de haber pasado por el listado.
chatsRouter.get('/:chatId', controller.obtenerCabecera);

// HU-5.2: historial paginado por cursor. La query se valida en el controller — `validar` es
// de body.
chatsRouter.get('/:chatId/mensajes', controller.listarMensajes);

// HU-5.2: envío. Acepta multipart (texto y/o fotos) y JSON (sólo texto), en ese orden:
// multer tiene que poblar `req.body` antes de que Zod lo valide, y las fotos se comprimen
// antes de que el service las persista. Mismo pipeline que el alta de mascota (HU-6.1).
//
// El campo sigue llamándose `foto` aunque ahora acepte varias: es el nombre que ya usa el
// cliente y multipart admite repetirlo sin cambiar nada de su lado.
chatsRouter.post(
  '/:chatId/mensajes',
  uploadImagenesOpcional('foto', LIMITES.mensaje.fotos.maximo),
  comprimirImagen,
  validar(enviarMensajeSchema),
  controller.enviarMensaje,
);

// HU-5.2: marcar la conversación como leída. Es POST y no PATCH porque no se edita un
// recurso identificado: se ejecuta la acción "leí esta sala" sobre un conjunto de mensajes.
chatsRouter.post('/:chatId/leidos', controller.marcarLeidos);

// HU-5.2: acusar que los mensajes LLEGARON, aunque no se haya abierto la conversación. Es
// el segundo tilde, y va por REST por lo mismo que el envío: el socket no escribe.
chatsRouter.post('/:chatId/entregados', controller.marcarEntregados);
