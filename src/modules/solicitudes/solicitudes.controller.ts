import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import {
  crearSolicitudSchema,
  filtrosElegibilidadSchema,
  filtrosMiasSchema,
  filtrosRecibidasSchema,
  idSolicitudSchema,
  resolverSolicitudSchema,
} from './solicitudes.dto';
import * as service from './solicitudes.service';

/** Traduce el primer issue de Zod al formato de error de la API (igual que mascotas.controller.ts). */
function parsearOFallar<T extends z.ZodTypeAny>(schema: T, datos: unknown): z.infer<T> {
  const resultado = schema.safeParse(datos);

  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
  }

  return resultado.data;
}

function idDeRuta(req: Request): number {
  return parsearOFallar(idSolicitudSchema, req.params.id);
}

/** HU-7.1: si puede abrir el formulario, y si no, con qué cartel se lo frena. */
export async function elegibilidad(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { publicacionId } = parsearOFallar(filtrosElegibilidadSchema, req.query);
    res.json(await service.obtenerElegibilidad(req.usuario!.usuarioId, publicacionId));
  } catch (err) {
    next(err);
  }
}

/** HU-7.1: el adoptante crea la solicitud. */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const datos = parsearOFallar(crearSolicitudSchema, req.body);
    res.status(201).json(await service.crearSolicitud(datos, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** HU-7.3: historial de lo que el propio usuario solicitó. */
export async function listarMias(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const filtros = parsearOFallar(filtrosMiasSchema, req.query);
    res.json(await service.listarMias(req.usuario!.usuarioId, filtros));
  } catch (err) {
    next(err);
  }
}

/** HU-7.5 (listado). */
export async function listarRecibidas(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const filtros = parsearOFallar(filtrosRecibidasSchema, req.query);
    res.json(await service.listarRecibidas(req.usuario!.usuarioId, req.ambito!, filtros));
  } catch (err) {
    next(err);
  }
}

/** HU-7.5 (detalle + historial). */
export async function obtenerDetalle(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.obtenerDetalle(idDeRuta(req), req.usuario!.usuarioId, req.ambito!));
  } catch (err) {
    next(err);
  }
}

/** HU-7.4: el refugio acepta o rechaza. */
export async function resolver(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const datos = parsearOFallar(resolverSolicitudSchema, req.body);
    res.json(
      await service.resolverSolicitud(idDeRuta(req), datos, req.usuario!.usuarioId, req.ambito!),
    );
  } catch (err) {
    next(err);
  }
}
