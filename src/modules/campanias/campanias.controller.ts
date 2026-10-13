import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import { idSchema } from '../../shared/validation/schemas';
import {
  cambiarEstadoCampaniaSchema,
  crearCampaniaSchema,
  donarSchema,
  filtrosDonacionesSchema,
  filtrosMisCampaniasSchema,
  paginaCampaniasSchema,
  resolverDonacionSchema,
} from './campanias.dto';
import * as service from './campanias.service';

/** Traduce el primer issue de Zod al formato de error de la API. */
function parsearOFallar<T extends z.ZodTypeAny>(schema: T, datos: unknown): z.infer<T> {
  const resultado = schema.safeParse(datos);

  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
  }

  return resultado.data;
}

const idCampania = (req: Request): number => parsearOFallar(idSchema('La campaña'), req.params.id);

// ─────────────── ADOPTANTE ───────────────

/** HU-12.2: 200 con lista vacía si no hay campañas activas, nunca 404. */
export async function listarPortal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listarPortal(parsearOFallar(paginaCampaniasSchema, req.query)));
  } catch (err) {
    next(err);
  }
}

export async function obtener(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.obtenerCampania(idCampania(req)));
  } catch (err) {
    next(err);
  }
}

/** HU-12.3: «Terminar donación». */
export async function donar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const donacion = await service.donar(
      idCampania(req),
      parsearOFallar(donarSchema, req.body),
      req.usuario!.usuarioId,
    );
    res.status(201).json(donacion);
  } catch (err) {
    next(err);
  }
}

// ─────────────── REFUGIO ───────────────

export async function listarDelRefugio(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await service.listarCampaniasDelRefugio(
        parsearOFallar(filtrosMisCampaniasSchema, req.query),
        req.usuario!.usuarioId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

/**
 * HU-12.1. Llega como multipart: multer lo parsea y comprimirImagen procesa la imagen antes
 * de validar el resto acá.
 */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const campania = await service.crearCampania(parsearOFallar(crearCampaniaSchema, req.body), {
      usuarioId: req.usuario!.usuarioId,
      archivo: req.file,
    });
    res.status(201).json(campania);
  } catch (err) {
    next(err);
  }
}

/** HU-12.5 / HU-12.6. */
export async function cambiarEstado(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { estado } = parsearOFallar(cambiarEstadoCampaniaSchema, req.body);
    res.json(await service.cambiarEstadoCampania(idCampania(req), estado, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

export async function listarDonaciones(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await service.listarDonaciones(
        idCampania(req),
        parsearOFallar(filtrosDonacionesSchema, req.query),
        req.usuario!.usuarioId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

/** HU-12.3: aplicar o rechazar. */
export async function resolverDonacion(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await service.resolverDonacion(
        parsearOFallar(idSchema('La donación'), req.params.id),
        parsearOFallar(resolverDonacionSchema, req.body),
        req.usuario!.usuarioId,
      ),
    );
  } catch (err) {
    next(err);
  }
}
