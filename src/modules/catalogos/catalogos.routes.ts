import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import * as controller from './catalogos.controller';

/**
 * Catálogos de referencia que alimentan los selectores de los formularios. Se montan en
 * la raíz de /api/v1 porque son recursos de primer nivel, no de un módulo de negocio.
 */
export const catalogosRouter = Router();

catalogosRouter.get('/especies', autenticar, controller.listarEspecies);
catalogosRouter.get('/especies/:especieId/razas', autenticar, controller.listarRazasDeEspecie);
catalogosRouter.get('/estados-mascota', autenticar, controller.listarEstadosMascota);
