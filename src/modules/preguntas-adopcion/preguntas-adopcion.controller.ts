import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import {
  actualizarPreguntaSchema,
  crearPreguntaSchema,
  idPreguntaSchema,
  reordenarPreguntasSchema,
} from './preguntas-adopcion.dto';
import * as service from './preguntas-adopcion.service';

/** Traduce el primer issue de Zod al formato de error de la API (igual que solicitudes). */
function parsearOFallar<T extends z.ZodTypeAny>(schema: T, datos: unknown): z.infer<T> {
  const resultado = schema.safeParse(datos);

  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
  }

  return resultado.data;
}

function idDeRuta(req: Request): number {
  return parsearOFallar(idPreguntaSchema, req.params.id);
}

export async function listar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ preguntas: await service.listar(req.usuario!.usuarioId) });
  } catch (err) {
    next(err);
  }
}

export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const datos = parsearOFallar(crearPreguntaSchema, req.body);
    res.status(201).json(await service.crear(datos, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

export async function actualizar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const datos = parsearOFallar(actualizarPreguntaSchema, req.body);
    res.json(await service.actualizar(idDeRuta(req), datos, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

export async function eliminar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.eliminar(idDeRuta(req), req.usuario!.usuarioId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function reordenar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const datos = parsearOFallar(reordenarPreguntasSchema, req.body);
    res.json({ preguntas: await service.reordenar(datos, req.usuario!.usuarioId) });
  } catch (err) {
    next(err);
  }
}
