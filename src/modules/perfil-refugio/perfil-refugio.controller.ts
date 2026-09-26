import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import type { ActualizarPerfilRefugioBody } from './perfil-refugio.dto';
import * as service from './perfil-refugio.service';

export async function obtener(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError('NO_AUTENTICADO', 'Falta el token de autenticación', 401);
    }
    const refugio = await service.obtenerPerfil(req.usuario.usuarioId);
    res.json({ refugio });
  } catch (error) {
    next(error);
  }
}

export async function actualizar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError('NO_AUTENTICADO', 'Falta el token de autenticación', 401);
    }
    const refugio = await service.actualizarPerfil(
      req.usuario.usuarioId,
      req.body as ActualizarPerfilRefugioBody,
      req.file,
    );
    res.json({ refugio });
  } catch (error) {
    next(error);
  }
}
