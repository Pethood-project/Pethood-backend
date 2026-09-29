import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import { crearAvisoSchema, filtrosAvisosSchema } from './animales-perdidos.dto';
import * as service from './animales-perdidos.service';

/** Traduce el primer issue de Zod al formato de error de la API. */
function parsearOFallar<T extends z.ZodTypeAny>(schema: T, datos: unknown): z.infer<T> {
  const resultado = schema.safeParse(datos);

  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
  }

  return resultado.data;
}

/**
 * HU-13.1. El formulario llega como multipart, así que el body no pasa por `validar`: primero
 * multer lo parsea y recién después se valida acá.
 */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const aviso = await service.crearAviso(parsearOFallar(crearAvisoSchema, req.body), {
      usuarioId: req.usuario!.usuarioId,
      archivos: Array.isArray(req.files) ? req.files : [],
    });

    res.status(201).json(aviso);
  } catch (err) {
    next(err);
  }
}

/** HU-13.1. El portal: 200 con lista vacía si no hay avisos, nunca 404. */
export async function listar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(
      await service.listarAvisos(
        parsearOFallar(filtrosAvisosSchema, req.query),
        req.usuario!.usuarioId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

/** Opciones del filtro por ubicación (texto libre, provisorio). */
export async function listarUbicaciones(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.listarUbicaciones());
  } catch (err) {
    next(err);
  }
}
