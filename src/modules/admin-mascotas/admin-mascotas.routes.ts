import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { validar } from '../../middlewares/validar';
import { ROL_API } from '../../shared/roles';
import { motivoBodySchema } from '../admin-usuarios/admin-usuarios.dto';
import * as controller from './admin-mascotas.controller';

export const adminMascotasRouter = Router();

adminMascotasRouter.use(autenticar, requiereRol(ROL_API.ADMIN));

adminMascotasRouter.get('/mascotas', controller.listar);
adminMascotasRouter.get('/mascotas/:id', controller.obtener);
adminMascotasRouter.patch('/mascotas/:id/baja', validar(motivoBodySchema), controller.darDeBaja);
adminMascotasRouter.patch(
  '/mascotas/:id/reactivar',
  validar(motivoBodySchema),
  controller.reactivar,
);
