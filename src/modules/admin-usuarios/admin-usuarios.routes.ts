import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { validar } from '../../middlewares/validar';
import { ROL_API } from '../../shared/roles';
import * as controller from './admin-usuarios.controller';
import { altaRefugioBodySchema, motivoBodySchema, rolesBodySchema } from './admin-usuarios.dto';

export const adminUsuariosRouter = Router();

adminUsuariosRouter.use(autenticar, requiereRol(ROL_API.ADMIN));

adminUsuariosRouter.get('/usuarios', controller.listarUsuarios);
adminUsuariosRouter.patch('/usuarios/:id/verificar', controller.verificarUsuario);
adminUsuariosRouter.patch(
  '/usuarios/:id/suspender',
  validar(motivoBodySchema),
  controller.suspenderUsuario,
);
adminUsuariosRouter.patch('/usuarios/:id/reactivar', controller.reactivarUsuario);
adminUsuariosRouter.patch('/usuarios/:id/baja', validar(motivoBodySchema), controller.bajaUsuario);
adminUsuariosRouter.patch(
  '/usuarios/:id/roles',
  validar(rolesBodySchema),
  controller.gestionarRoles,
);

adminUsuariosRouter.post('/refugios', validar(altaRefugioBodySchema), controller.altaRefugio);
adminUsuariosRouter.get('/refugios', controller.listarRefugios);
adminUsuariosRouter.get('/refugios/:id', controller.obtenerRefugio);
adminUsuariosRouter.patch('/refugios/:id/verificar', controller.verificarRefugio);
adminUsuariosRouter.patch(
  '/refugios/:id/suspender',
  validar(motivoBodySchema),
  controller.suspenderRefugio,
);
adminUsuariosRouter.patch('/refugios/:id/reactivar', controller.reactivarRefugio);
adminUsuariosRouter.patch('/refugios/:id/baja', validar(motivoBodySchema), controller.bajaRefugio);
