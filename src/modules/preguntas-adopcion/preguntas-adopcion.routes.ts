import { Router } from 'express';
import { requiereAmbito } from '../../middlewares/ambito';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { ROL_API } from '../../shared/roles';
import * as controller from './preguntas-adopcion.controller';

export const preguntasAdopcionRouter = Router();

// Son del refugio: desde el perfil personal no se ven ni se tocan.
const soloRefugio = [autenticar, requiereRol(ROL_API.MIEMBRO_REFUGIO), requiereAmbito('REFUGIO')];

preguntasAdopcionRouter.get('/', soloRefugio, controller.listar);
preguntasAdopcionRouter.post('/', soloRefugio, controller.crear);

// Antes de `/:id`: es una ruta fija y ese parámetro la capturaría.
preguntasAdopcionRouter.put('/orden', soloRefugio, controller.reordenar);

preguntasAdopcionRouter.patch('/:id', soloRefugio, controller.actualizar);
preguntasAdopcionRouter.delete('/:id', soloRefugio, controller.eliminar);
