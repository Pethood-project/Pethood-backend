import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import { parsearId } from '../../shared/validation/numbers';
import { crearMascotaSchema, editarMascotaSchema } from './mascotas.dto';
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
 * puesto desde el ámbito del pedido: un miembro de refugio en su perfil personal carga una
 * mascota personal, y en la vista de refugio una del refugio. `autenticar` ya garantizó que
 * el ámbito REFUGIO solo llega de alguien que pertenece a uno.
 */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const actor = req.ambito === 'REFUGIO' ? 'REFUGIO' : 'ADOPTANTE';

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
      { usuarioId: req.usuario!.usuarioId, ambito: req.ambito!, archivo: req.file },
    );

    res.json(mascota);
  } catch (err) {
    next(err);
  }
}

/** HU-6.3. Baja lógica; devuelve cuántas publicaciones se retiraron junto con la mascota. */
export async function eliminar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.eliminarMascota(idDeRuta(req), req.usuario!.usuarioId, req.ambito!));
  } catch (err) {
    next(err);
  }
}

export async function listarMias(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listarMisMascotas(req.usuario!.usuarioId, req.ambito!));
  } catch (err) {
    next(err);
  }
}

/** HU-6.4. Ficha individual de una mascota del perfil con el que se consulta. */
export async function obtener(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.obtenerMascota(idDeRuta(req), req.usuario!.usuarioId, req.ambito!));
  } catch (err) {
    next(err);
  }
}
