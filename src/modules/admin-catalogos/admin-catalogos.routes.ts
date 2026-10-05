import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { ROL_API } from '../../shared/roles';
import * as controller from './admin-catalogos.controller';

export const adminCatalogosRouter = Router();

adminCatalogosRouter.use(autenticar, requiereRol(ROL_API.ADMIN));

adminCatalogosRouter.get('/catalogos/:catalogo', controller.listar);
adminCatalogosRouter.post('/catalogos/:catalogo', controller.crear);
adminCatalogosRouter.put('/catalogos/:catalogo/:id', controller.editar);
adminCatalogosRouter.patch('/catalogos/:catalogo/:id/baja', controller.darDeBaja);
adminCatalogosRouter.patch('/catalogos/:catalogo/:id/reactivar', controller.reactivar);
