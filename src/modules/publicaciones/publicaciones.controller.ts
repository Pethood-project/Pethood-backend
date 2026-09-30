import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { parsearId } from '../../shared/validation/numbers';
import {
  cambiarEstadoPublicacionSchema,
  crearPublicacionSchema,
  editarPublicacionSchema,
  filtrosDetallePublicacionSchema,
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

/** Ficha completa de una publicación. Con `?latitud=&longitud=` devuelve además la distancia. */
export async function obtener(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parsearId(req.params.id);
    if (id === null) throw new AppError('VALIDACION', 'La publicación no es válida', 400);

    const resultado = filtrosDetallePublicacionSchema.safeParse(req.query);
    if (!resultado.success) {
      const primero = resultado.error.issues[0];
      throw new AppError('VALIDACION', primero?.message ?? 'Filtros inválidos', 400);
    }

    const { latitud, longitud } = resultado.data;
    const coordenadas =
      latitud !== undefined && longitud !== undefined ? { latitud, longitud } : undefined;

    res.json(await service.obtenerPublicacion(id, req.usuario!.usuarioId, req.ambito!, coordenadas));
  } catch (err) {
    next(err);
  }
}

/**
 * Edición de los datos de la publicación. Multipart, igual que el alta: la validación va
 * acá, después de multer. Responde la ficha actualizada.
 */
export async function editar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parsearId(req.params.id);
    if (id === null) throw new AppError('VALIDACION', 'La publicación no es válida', 400);

    const resultado = editarPublicacionSchema.safeParse(req.body);

    if (!resultado.success) {
      const primero = resultado.error.issues[0];
      throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
    }

    const publicacion = await service.editarPublicacion(id, resultado.data, {
      usuarioId: req.usuario!.usuarioId,
      ambito: req.ambito!,
      archivos: Array.isArray(req.files) ? req.files : [],
    });

    res.json(publicacion);
  } catch (err) {
    next(err);
  }
}

/** Pausar, reactivar o finalizar a mano. Responde la ficha con el estado nuevo. */
export async function cambiarEstado(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = parsearId(req.params.id);
    if (id === null) throw new AppError('VALIDACION', 'La publicación no es válida', 400);

    const resultado = cambiarEstadoPublicacionSchema.safeParse(req.body);

    if (!resultado.success) {
      const primero = resultado.error.issues[0];
      throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
    }

    res.json(
      await service.cambiarEstadoPublicacion(
        id,
        resultado.data.accion,
        req.usuario!.usuarioId,
        req.ambito!,
      ),
    );
  } catch (err) {
    next(err);
  }
}
