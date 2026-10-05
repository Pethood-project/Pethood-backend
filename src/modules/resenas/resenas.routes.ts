import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { validar } from '../../middlewares/validar';
import { ROL_API } from '../../shared/roles';
import * as controller from './resenas.controller';
import { crearResenaSchema } from './resenas.dto';

export const resenasRouter = Router();

// Reputación (Módulo 10). La lectura del historial la usa tanto el perfil personal como el
// de refugio, así que no se restringe por ámbito. La baja es exclusiva del administrador
// (HU-10.6): ni el autor ni el reportado pueden borrar una reseña.
resenasRouter.get('/elegibles', autenticar, controller.elegibles);
resenasRouter.get('/usuario/:usuarioId', autenticar, controller.deUsuario);
resenasRouter.get('/refugio/:refugioId', autenticar, controller.deRefugio);

resenasRouter.post('/', autenticar, validar(crearResenaSchema), controller.crear);

resenasRouter.delete('/:id', autenticar, requiereRol(ROL_API.ADMIN), controller.darDeBaja);
