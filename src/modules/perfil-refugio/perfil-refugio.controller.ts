import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import type {
  ActualizarPerfilRefugioBody,
  ActualizarUbicacionRefugioBody,
  PreviewUbicacionRefugioBody,
} from './perfil-refugio.dto';
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

export async function actualizarUbicacion(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError('NO_AUTENTICADO', 'Falta el token de autenticación', 401);
    }
    const { mapaUrl } = req.body as ActualizarUbicacionRefugioBody;
    const refugio = await service.actualizarUbicacion(req.usuario.usuarioId, mapaUrl);
    res.json({ refugio });
  } catch (error) {
    next(error);
  }
}

export async function previewUbicacion(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ubicacion = await service.previewUbicacion(req.body as PreviewUbicacionRefugioBody);
    res.json({ ubicacion });
  } catch (error) {
    next(error);
  }
}
