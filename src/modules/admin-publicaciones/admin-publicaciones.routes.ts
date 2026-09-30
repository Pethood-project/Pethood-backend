import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { validar } from '../../middlewares/validar';
import { ROL_API } from '../../shared/roles';
import { motivoBodySchema } from '../admin-usuarios/admin-usuarios.dto';
import * as controller from './admin-publicaciones.controller';
import { estadoBodySchema } from './admin-publicaciones.dto';

export const adminPublicacionesRouter = Router();

adminPublicacionesRouter.use(autenticar, requiereRol(ROL_API.ADMIN));

adminPublicacionesRouter.get('/publicaciones', controller.listar);
adminPublicacionesRouter.get('/publicaciones/:id', controller.obtener);
adminPublicacionesRouter.patch(
  '/publicaciones/:id/estado',
  validar(estadoBodySchema),
  controller.cambiarEstado,
);
adminPublicacionesRouter.patch(
  '/publicaciones/:id/baja',
  validar(motivoBodySchema),
  controller.darDeBaja,
);
adminPublicacionesRouter.patch('/publicaciones/:id/reactivar', controller.reactivar);
