import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { parsearId } from '../../shared/validation/numbers';
import type { AgregarFavoritoDto } from './favoritos.dto';
import * as service from './favoritos.service';

/** El id viaja en la URL, así que no lo cubre ningún schema de body. */
function mascotaIdDeRuta(req: Request): number {
  const id = parsearId(req.params.mascotaId);

  if (id === null) {
    throw new AppError('VALIDACION', 'El id de la mascota no es válido', 400);
  }

  return id;
}

/** HU-7.2. 201 si se guardó recién, 200 si ya estaba: las dos son un final correcto. */
export async function agregar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { mascotaId } = req.body as AgregarFavoritoDto;

    const { favorito, yaEstaba } = await service.agregarFavorito(mascotaId, req.usuario!.usuarioId);

    res.status(yaEstaba ? 200 : 201).json(favorito);
  } catch (err) {
    next(err);
  }
}

/** Baja lógica. 204 aunque no estuviera guardada: el pedido es idempotente. */
export async function quitar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.quitarFavorito(mascotaIdDeRuta(req), req.usuario!.usuarioId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/** HU-6.6. Devuelve el total para el contador del header además de la grilla. */
export async function listar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listarFavoritos(req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}
