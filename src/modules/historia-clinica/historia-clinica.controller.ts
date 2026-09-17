import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import { parsearId } from '../../shared/validation/numbers';
import { crearHistoriaClinicaSchema, editarHistoriaClinicaSchema } from './historia-clinica.dto';
import * as service from './historia-clinica.service';

/** Traduce el primer issue de Zod al formato de error de la API. */
function parsearOFallar<T extends z.ZodTypeAny>(schema: T, datos: unknown): z.infer<T> {
  const resultado = schema.safeParse(datos);

  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
  }

  return resultado.data;
}

function idDeParametro(valor: unknown, etiqueta: string): number {
  const id = parsearId(valor);

  if (id === null) {
    throw new AppError('VALIDACION', `El id de ${etiqueta} no es válido`, 400);
  }

  return id;
}

/** HU-8.1. Multipart: el body pasa por Zod recién acá, luego de que multer lo parsee. */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const mascotaId = idDeParametro(req.params.mascotaId, 'la mascota');

    const registro = await service.crearHistoriaClinica(
      mascotaId,
      parsearOFallar(crearHistoriaClinicaSchema, req.body),
      { usuarioId: req.usuario!.usuarioId, archivo: req.file },
    );

    res.status(201).json(registro);
  } catch (err) {
    next(err);
  }
}

/** HU-8.2. Historial completo de una mascota. */
export async function listar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const mascotaId = idDeParametro(req.params.mascotaId, 'la mascota');

    res.json(await service.listarHistorial(mascotaId, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** HU-8.2. Detalle de un registro puntual. */
export async function obtener(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = idDeParametro(req.params.id, 'la historia clínica');

    res.json(await service.obtenerHistoriaClinica(id, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** HU-8.3. "Modificar" nunca actualiza: da de baja el registro viejo y crea uno nuevo. */
export async function editar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = idDeParametro(req.params.id, 'la historia clínica');

    const registro = await service.editarHistoriaClinica(
      id,
      parsearOFallar(editarHistoriaClinicaSchema, req.body),
      { usuarioId: req.usuario!.usuarioId, archivo: req.file },
    );

    res.json(registro);
  } catch (err) {
    next(err);
  }
}

/** HU-8.4. Baja lógica simple; el modal de confirmación es responsabilidad del front. */
export async function eliminar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = idDeParametro(req.params.id, 'la historia clínica');

    res.json(await service.eliminarHistoriaClinica(id, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}
