import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { validar } from '../../middlewares/validar';
import { ROL_API } from '../../shared/roles';
import { motivoBodySchema } from '../admin-usuarios/admin-usuarios.dto';
import * as controller from './animales-perdidos.controller';

/** `/admin/animales-perdidos`: moderación de avisos de mascota perdida (spec 008). */
export const adminAnimalesPerdidosRouter = Router();

adminAnimalesPerdidosRouter.use(autenticar, requiereRol(ROL_API.ADMIN));

adminAnimalesPerdidosRouter.patch(
  '/animales-perdidos/:id/baja',
  validar(motivoBodySchema),
  controller.darDeBajaPorAdmin,
);
