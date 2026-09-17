import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { ROL_API } from '../../shared/roles';
import * as controller from './dashboard-refugio.controller';

export const dashboardRefugioRouter = Router();

dashboardRefugioRouter.get(
  '/dashboard',
  autenticar,
  requiereRol(ROL_API.MIEMBRO_REFUGIO),
  controller.obtener,
);

dashboardRefugioRouter.get(
  '/dashboard/exportar/:entidad',
  autenticar,
  requiereRol(ROL_API.MIEMBRO_REFUGIO),
  controller.exportar,
);
