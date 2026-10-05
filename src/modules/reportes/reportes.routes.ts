import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { validar } from '../../middlewares/validar';
import { ROL_API } from '../../shared/roles';
import * as controller from './reportes.controller';
import { crearReporteSchema, resolverReporteSchema } from './reportes.dto';

/** `/reportes`: cualquier sesión puede reportar (HU-3.1 a 3.3). */
export const reportesRouter = Router();

reportesRouter.post('/', autenticar, validar(crearReporteSchema), controller.crear);

/** `/admin/reportes`: solo administradores (HU-3.6 y 3.7). */
export const adminReportesRouter = Router();

adminReportesRouter.use(autenticar, requiereRol(ROL_API.ADMIN));

adminReportesRouter.get('/reportes', controller.listar);
adminReportesRouter.get('/reportes/:id', controller.obtener);
adminReportesRouter.patch(
  '/reportes/:id/resolver',
  validar(resolverReporteSchema),
  controller.resolver,
);
