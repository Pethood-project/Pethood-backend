import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { ROL_API } from '../../shared/roles';
import * as controller from './admin-solicitudes.controller';

export const adminSolicitudesRouter = Router();

adminSolicitudesRouter.use(autenticar, requiereRol(ROL_API.ADMIN));

adminSolicitudesRouter.get('/solicitudes', controller.listar);
adminSolicitudesRouter.get('/solicitudes/:id', controller.obtener);
