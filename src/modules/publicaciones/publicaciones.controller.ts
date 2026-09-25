import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { parsearId } from '../../shared/validation/numbers';
import {
  crearPublicacionSchema,
  filtrosFeedSchema,
  filtrosMisPublicacionesSchema,
} from './publicaciones.dto';
import * as service from './publicaciones.service';

/**
 * El formulario llega como multipart, así que la validación se hace acá: primero tiene
 * que correr multer para que el body esté parseado.
 */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resultado = crearPublicacionSchema.safeParse(req.body);

    if (!resultado.success) {
      const primero = resultado.error.issues[0];
      throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
    }

    const publicacion = await service.crearPublicacion(resultado.data, {
      usuarioId: req.usuario!.usuarioId,
      ambito: req.ambito!,
      archivos: Array.isArray(req.files) ? req.files : [],
    });

    res.status(201).json(publicacion);
  } catch (err) {
    next(err);
  }
}

/** Feed de adopción. Los filtros viajan en la query string. */
export async function listar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resultado = filtrosFeedSchema.safeParse(req.query);

    if (!resultado.success) {
      const primero = resultado.error.issues[0];
      throw new AppError('VALIDACION', primero?.message ?? 'Filtros inválidos', 400);
    }

    res.json(await service.listarFeed(req.usuario!.usuarioId, resultado.data));
  } catch (err) {
    next(err);
  }
}

/**
 * "Mis publicaciones": las del perfil activo (personal o del refugio). `?estados=1,3` filtra
 * por estado de la publicación; sin el parámetro, todas.
 */
export async function listarMias(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const resultado = filtrosMisPublicacionesSchema.safeParse(req.query);

    if (!resultado.success) {
      const primero = resultado.error.issues[0];
      throw new AppError('VALIDACION', primero?.message ?? 'Filtros inválidos', 400);
    }

    res.json(
      await service.listarMisPublicaciones(req.usuario!.usuarioId, req.ambito!, resultado.data),
    );
  } catch (err) {
    next(err);
  }
}

/** Ficha completa de una publicación. */
export async function obtener(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parsearId(req.params.id);
    if (id === null) throw new AppError('VALIDACION', 'La publicación no es válida', 400);

    res.json(await service.obtenerPublicacion(id, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}
