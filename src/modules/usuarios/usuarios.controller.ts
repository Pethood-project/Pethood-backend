import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import type {
  ActualizarPerfilBody,
  ActualizarUbicacionBody,
  CambiarPasswordBody,
  PreviewUbicacionBody,
} from './usuarios.dto';
import * as service from './usuarios.service';

export async function obtenerMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.usuario) {
      throw new AppError('NO_AUTENTICADO', 'Falta el token de autenticación', 401);
    }
    const usuario = await service.obtenerPerfil(req.usuario.usuarioId, req.ambito!);
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
      req.ambito!,
      req.body as ActualizarPerfilBody,
      req.file,
    );
    res.json({ usuario });
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
    const { mapaUrl } = req.body as ActualizarUbicacionBody;
    const usuario = await service.actualizarUbicacion(req.usuario.usuarioId, req.ambito!, mapaUrl);
    res.json({ usuario });
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
    const ubicacion = await service.previewUbicacion(req.body as PreviewUbicacionBody);
    res.json({ ubicacion });
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
