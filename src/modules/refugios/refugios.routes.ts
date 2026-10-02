import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import * as controller from './refugios.controller';

export const refugiosRouter = Router();

// Perfil público de un refugio: lo ve cualquier sesión, desde cualquier perfil.
refugiosRouter.get('/:id', autenticar, controller.obtenerPerfilPublico);
