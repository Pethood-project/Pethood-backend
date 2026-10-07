import { Router } from 'express';
import { requiereAmbito } from '../../middlewares/ambito';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { ROL_API } from '../../shared/roles';
import * as controller from './mercadopago.controller';

/** Del refugio (spec 027). Se monta en `/refugio`: middlewares por ruta, no con `use`. */
export const mercadopagoRefugioRouter = Router();

const soloRefugio = [autenticar, requiereRol(ROL_API.MIEMBRO_REFUGIO), requiereAmbito('REFUGIO')];

mercadopagoRefugioRouter.get('/mercadopago', ...soloRefugio, controller.estado);
mercadopagoRefugioRouter.post('/mercadopago/vinculacion', ...soloRefugio, controller.iniciar);
mercadopagoRefugioRouter.delete('/mercadopago', ...soloRefugio, controller.desvincular);

/** Público: lo llama el navegador al volver de Mercado Pago. La identidad viaja en el `state`. */
export const mercadopagoRouter = Router();

mercadopagoRouter.get('/oauth/callback', controller.callback);
