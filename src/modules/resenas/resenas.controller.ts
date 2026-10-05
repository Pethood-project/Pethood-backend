import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { parsearId } from '../../shared/validation/numbers';
import type { CrearResenaDto } from './resenas.dto';
import * as service from './resenas.service';

/** Los ids de las FK viajan en la URL, así que no los cubre ningún schema de body. */
function idDeRuta(req: Request, campo: string): number {
  const id = parsearId(req.params[campo]);

  if (id === null) {
    throw new AppError('VALIDACION', 'El id no es válido', 400);
  }

  return id;
}

/** HU-10.1: el usuario registra la reseña de una transacción concretada. */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const datos = req.body as CrearResenaDto;
    res.status(201).json(await service.crearResena(datos, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** HU-10.5: historial y promedio de una persona. */
export async function deUsuario(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listarDeUsuario(idDeRuta(req, 'usuarioId')));
  } catch (err) {
    next(err);
  }
}

/** HU-10.5: historial y promedio de un refugio. */
export async function deRefugio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listarDeRefugio(idDeRuta(req, 'refugioId')));
  } catch (err) {
    next(err);
  }
}

/** Transacciones concretadas que el usuario todavía no reseñó, según el perfil activo. */
export async function elegibles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listarElegibles(req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** HU-10.6: baja lógica de una reseña (solo administradores). */
export async function darDeBaja(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.darDeBaja(idDeRuta(req, 'id'), req.usuario!.usuarioId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
