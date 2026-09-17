import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import { parsearId } from '../../shared/validation/numbers';
import { subirActualizacionSchema } from './seguimiento.dto';
import * as service from './seguimiento.service';

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
 * `etiqueta` viaja con su preposición ya contraída ("del seguimiento", "de la solicitud"):
 * armarla acá a partir del sustantivo daría "de el seguimiento" en los masculinos.
 */
function idDeParametro(valor: unknown, etiqueta: string): number {
  const id = parsearId(valor);

  if (id === null) {
    throw new AppError('VALIDACION', `El id ${etiqueta} no es válido`, 400);
  }

  return id;
}

/** HU-9.2. Todo lo que el usuario tiene en seguimiento, como adoptante o como publicador. */
export async function listarMios(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listarMisSeguimientos(req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** HU-9.2. Historial de una solicitud puntual (GUI-21). */
export async function listarDeSolicitud(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const solicitudId = idDeParametro(req.params.solicitudId, 'de la solicitud');

    res.json(await service.obtenerSeguimientosDeSolicitud(solicitudId, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** HU-9.3. Una actualización puntual, abierta desde el expediente o desde una notificación. */
export async function obtenerActualizacion(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = idDeParametro(req.params.id, 'del seguimiento');

    res.json(await service.obtenerActualizacion(id, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** HU-9.1. Multipart: el body pasa por Zod recién acá, luego de que multer lo parsee. */
export async function subirActualizacion(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = idDeParametro(req.params.id, 'del seguimiento');

    const resultado = await service.subirActualizacion(
      id,
      parsearOFallar(subirActualizacionSchema, req.body),
      { usuarioId: req.usuario!.usuarioId, archivo: req.file },
    );

    res.status(201).json(resultado);
  } catch (err) {
    next(err);
  }
}
