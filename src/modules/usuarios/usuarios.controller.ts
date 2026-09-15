import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import type { ActualizarPerfilBody, CambiarPasswordBody } from './usuarios.dto';
import * as service from './usuarios.service';

export async function obtenerMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError('NO_AUTENTICADO', 'Falta el token de autenticación', 401);
    }
    const usuario = await service.obtenerPerfil(req.usuario.usuarioId);
    res.json({ usuario });
  } catch (error) {
    next(error);
  }
}

export async function actualizarMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError('NO_AUTENTICADO', 'Falta el token de autenticación', 401);
    }
    const usuario = await service.actualizarPerfil(
      req.usuario.usuarioId,
      req.body as ActualizarPerfilBody,
      req.file,
    );
    res.json({ usuario });
  } catch (error) {
    next(error);
  }
}

export async function cambiarPassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError('NO_AUTENTICADO', 'Falta el token de autenticación', 401);
    }
    await service.cambiarPassword(req.usuario.usuarioId, req.body as CambiarPasswordBody);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function darDeBajaMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError('NO_AUTENTICADO', 'Falta el token de autenticación', 401);
    }
    await service.darDeBajaCuenta(req.usuario.usuarioId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
