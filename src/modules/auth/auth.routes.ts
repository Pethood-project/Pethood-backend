import { Router } from 'express';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { uploadImagenOpcional } from '../../middlewares/uploadImagen';
import { validar } from '../../middlewares/validar';
import * as authController from './auth.controller';
import {
  googleIdTokenBodySchema,
  loginBodySchema,
  recuperarBodySchema,
  registroBodySchema,
  resetearBodySchema,
} from './auth.dto';

export const authRouter = Router();

authRouter.post(
  '/registro',
  uploadImagenOpcional('imagen'),
  comprimirImagen,
  validar(registroBodySchema),
  authController.registro,
);
authRouter.post('/login', validar(loginBodySchema), authController.login);
authRouter.post('/logout', autenticar, authController.logout);
authRouter.post('/recuperar', validar(recuperarBodySchema), authController.recuperar);
authRouter.post('/resetear', validar(resetearBodySchema), authController.resetear);

authRouter.post('/google', validar(googleIdTokenBodySchema), authController.loginGoogleIdToken);
authRouter.get('/google', authController.iniciarGoogle);
authRouter.get('/google/callback', authController.callbackGoogle);
