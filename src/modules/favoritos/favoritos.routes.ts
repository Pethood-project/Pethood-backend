import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { validar } from '../../middlewares/validar';
import * as controller from './favoritos.controller';
import { agregarFavoritoSchema } from './favoritos.dto';

export const favoritosRouter = Router();

// HU-6.6: listado de GUI-12, ordenado por fecha de guardado descendente.
favoritosRouter.get('/', autenticar, controller.listar);

// HU-7.2: alta, disparada por el swipe de HU-6.5.
favoritosRouter.post('/', autenticar, validar(agregarFavoritoSchema), controller.agregar);

// Baja lógica. Va por `mascotaId` y no por el id del favorito: el swipe conoce la mascota
// y obligarlo a un GET previo sólo para averiguar el id sería un round-trip de más.
favoritosRouter.delete('/:mascotaId', autenticar, controller.quitar);
