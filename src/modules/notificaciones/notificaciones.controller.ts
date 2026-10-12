import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import { parsearId } from '../../shared/validation/numbers';
import {
  listarNotificacionesQuerySchema,
  type RegistrarDispositivoDto,
} from './notificaciones.dto';
import * as service from './notificaciones.service';

/** Traduce el primer issue de Zod al formato de error de la API (mismo patrón que animales-perdidos). */
function parsearOFallar<T extends z.ZodTypeAny>(schema: T, datos: unknown): z.infer<T> {
  const resultado = schema.safeParse(datos);

  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
  }

  return resultado.data;
}

function idDeRuta(req: Request): number {
  const id = parsearId(req.params.id);

  if (id === null) {
    throw new AppError('VALIDACION', 'El id de la notificación no es válido', 400);
  }

  return id;
}

/** Bandeja paginada por cursor, más recientes primero. */
export async function listar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { cursor, limite } = parsearOFallar(listarNotificacionesQuerySchema, req.query);
    res.json(await service.listarBandeja(req.usuario!.usuarioId, limite, cursor));
  } catch (err) {
    next(err);
  }
}

export async function contador(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.contarNoLeidas(req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

export async function marcarLeida(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.marcarLeida(req.usuario!.usuarioId, idDeRuta(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function marcarTodasLeidas(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await service.marcarTodasLeidas(req.usuario!.usuarioId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function eliminar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.eliminar(req.usuario!.usuarioId, idDeRuta(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function registrarDispositivo(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dto = req.body as RegistrarDispositivoDto;
    await service.registrarDispositivo(req.usuario!.usuarioId, dto);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function eliminarDispositivo(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await service.eliminarDispositivo(req.usuario!.usuarioId, req.params.expoPushToken!);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
