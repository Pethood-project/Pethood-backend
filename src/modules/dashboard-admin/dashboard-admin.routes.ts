import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { ROL_API } from '../../shared/roles';
import * as controller from './dashboard-admin.controller';

export const dashboardAdminRouter = Router();

dashboardAdminRouter.get('/dashboard', autenticar, requiereRol(ROL_API.ADMIN), controller.obtener);

dashboardAdminRouter.get(
  '/dashboard/exportar/:entidad',
  autenticar,
  requiereRol(ROL_API.ADMIN),
  controller.exportar,
);
