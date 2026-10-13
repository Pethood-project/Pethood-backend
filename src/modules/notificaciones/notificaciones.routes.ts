import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { validar } from '../../middlewares/validar';
import * as controller from './notificaciones.controller';
import { registrarDispositivoSchema } from './notificaciones.dto';

export const notificacionesRouter = Router();

// Bandeja: siempre las del usuario autenticado, nunca de otro (regla 8). Sin distinción de
// ámbito refugio/adoptante — a diferencia de mascotas o solicitudes, una notificación es del
// USUARIO, no del perfil con el que está mirando la app en ese momento.
notificacionesRouter.use(autenticar);

notificacionesRouter.get('/', controller.listar);
notificacionesRouter.get('/no-leidas/contador', controller.contador);
notificacionesRouter.post('/leidas', controller.marcarTodasLeidas);
notificacionesRouter.post('/:id/leida', controller.marcarLeida);
notificacionesRouter.delete('/:id', controller.eliminar);

notificacionesRouter.post(
  '/dispositivos',
  validar(registrarDispositivoSchema),
  controller.registrarDispositivo,
);
notificacionesRouter.delete('/dispositivos/:expoPushToken', controller.eliminarDispositivo);
