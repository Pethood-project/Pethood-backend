import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/errorHandler';
import * as authGoogle from './auth.google';
import type {
  GoogleIdTokenBody,
  LoginBody,
  RecuperarBody,
  RegistroBody,
  ResetearBody,
} from './auth.dto';
import * as authService from './auth.service';

function redirectLogin(res: Response, error: string): void {
  const url = new URL('/login', env.FRONTEND_WEB_URL);
  url.searchParams.set('error', error);
  res.redirect(url.toString());
}

export async function registro(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resultado = await authService.registrar(req.body as RegistroBody, req.file);
    res.status(201).json(resultado);
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resultado = await authService.login(req.body as LoginBody);
    res.json(resultado);
  } catch (error) {
    next(error);
  }
}

export async function logout(_req: Request, res: Response): Promise<void> {
  res.status(204).send();
}

export async function recuperar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resultado = await authService.solicitarRecuperacion(req.body as RecuperarBody);
    res.json(resultado);
  } catch (error) {
    next(error);
  }
}

export async function resetear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await authService.resetearPassword(req.body as ResetearBody);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function loginGoogleIdToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { idToken } = req.body as GoogleIdTokenBody;
    const perfil = await authGoogle.verificarIdTokenGoogle(idToken);
    const resultado = await authService.loginConGoogle(perfil);
    res.json(resultado);
  } catch (error) {
    next(error);
  }
}

export function iniciarGoogle(_req: Request, res: Response, next: NextFunction): void {
  try {
    const url = authGoogle.crearUrlAutorizacionGoogle();
    res.redirect(url);
  } catch (error) {
    if (error instanceof AppError) {
      redirectLogin(res, error.codigo.toLowerCase());
      return;
    }
    next(error);
  }
}

export async function callbackGoogle(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  try {
    const errorGoogle = typeof req.query.error === 'string' ? req.query.error : undefined;
    if (errorGoogle) {
      redirectLogin(res, 'google_cancelado');
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;

    if (!code) {
      throw new AppError('VALIDACION', 'Falta el código de Google.', 400);
    }

    authGoogle.validarStateOAuth(state);
    const perfil = await authGoogle.intercambiarCodigoGoogle(code);
    const resultado = await authService.loginConGoogle(perfil);

    const destino = new URL('/auth/callback', env.FRONTEND_WEB_URL);
    destino.searchParams.set('token', resultado.token);
    res.redirect(destino.toString());
  } catch (error) {
    const codigo = error instanceof AppError ? error.codigo.toLowerCase() : 'google_error';
    redirectLogin(res, codigo);
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError('NO_AUTENTICADO', 'Falta el token de autenticación', 401);
    }
    const usuario = await authService.perfilPropio(req.usuario.usuarioId);
    res.json({ usuario });
  } catch (error) {
    next(error);
  }
}
