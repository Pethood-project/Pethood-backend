import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { ROL_API } from '../../shared/roles';
import * as controller from './admin-campanas.controller';

export const adminCampanasRouter = Router();

adminCampanasRouter.use(autenticar, requiereRol(ROL_API.ADMIN));

adminCampanasRouter.get('/campanas', controller.listar);
adminCampanasRouter.get('/campanas/:id', controller.obtener);
