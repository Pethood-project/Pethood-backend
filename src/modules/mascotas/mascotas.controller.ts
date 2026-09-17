import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import { ROL_API } from '../../shared/roles';
import { parsearId } from '../../shared/validation/numbers';
import { ambitoMascotasSchema, crearMascotaSchema, editarMascotaSchema } from './mascotas.dto';
import * as service from './mascotas.service';

/** Traduce el primer issue de Zod al formato de error de la API. */
function parsearOFallar<T extends z.ZodTypeAny>(schema: T, datos: unknown): z.infer<T> {
  const resultado = schema.safeParse(datos);

  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
  }

  return resultado.data;
}

/** El id viaja en la URL, así que no lo cubre ningún schema de body. */
function idDeRuta(req: Request): number {
  const id = parsearId(req.params.id);

  if (id === null) {
    throw new AppError('VALIDACION', 'El id de la mascota no es válido', 400);
  }

  return id;
}

/**
 * El formulario llega como multipart, así que el body no pasa por validarBody: primero
 * hay que dejar que multer lo parsee. La validación se hace acá, ya con el `actor`
 * puesto desde el token para que el cliente no pueda elegirlo.
 */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const roles = req.usuario?.roles ?? [];
    const actor = roles.includes(ROL_API.MIEMBRO_REFUGIO) ? 'REFUGIO' : 'ADOPTANTE';

    const mascota = await service.crearMascota(
      parsearOFallar(crearMascotaSchema, { ...req.body, actor }),
      { usuarioId: req.usuario!.usuarioId, archivo: req.file },
    );

    res.status(201).json(mascota);
  } catch (err) {
    next(err);
  }
}

/** HU-6.2. Multipart igual que el alta, pero acá la foto es opcional. */
export async function editar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const mascota = await service.editarMascota(
      idDeRuta(req),
      parsearOFallar(editarMascotaSchema, req.body),
      { usuarioId: req.usuario!.usuarioId, archivo: req.file },
    );

    res.json(mascota);
  } catch (err) {
    next(err);
  }
}

/** HU-6.3. Baja lógica; devuelve cuántas publicaciones se retiraron junto con la mascota. */
export async function eliminar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.eliminarMascota(idDeRuta(req), req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

export async function listarMias(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ambito = parsearOFallar(ambitoMascotasSchema, req.query.ambito);
    res.json(await service.listarMisMascotas(req.usuario!.usuarioId, ambito));
  } catch (err) {
    next(err);
  }
}
