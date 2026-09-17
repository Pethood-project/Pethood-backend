import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import * as service from './catalogos.service';

export async function listarEspecies(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.listarEspecies());
  } catch (err) {
    next(err);
  }
}

export async function listarRazasDeEspecie(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const especieId = Number(req.params.especieId);
    if (!Number.isInteger(especieId) || especieId <= 0) {
      throw new AppError('VALIDACION', 'El id de especie no es válido', 400);
    }

    res.json(await service.listarRazasDeEspecie(especieId));
  } catch (err) {
    next(err);
  }
}

export async function listarEstadosMascota(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.listarEstadosMascota());
  } catch (err) {
    next(err);
  }
}
