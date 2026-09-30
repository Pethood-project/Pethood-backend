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

function especieDeRuta(req: Request): number {
  const especieId = Number(req.params.especieId);
  if (!Number.isInteger(especieId) || especieId <= 0) {
    throw new AppError('VALIDACION', 'El id de especie no es válido', 400);
  }

  return especieId;
}

export async function listarRazasDeEspecie(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.listarRazasDeEspecie(especieDeRuta(req)));
  } catch (err) {
    next(err);
  }
}

export async function listarVacunasDeEspecie(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.listarVacunasDeEspecie(especieDeRuta(req)));
  } catch (err) {
    next(err);
  }
}

export async function listarEstadosPublicacion(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.listarEstadosPublicacion());
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

export async function listarEstadosCampania(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.listarEstadosCampania());
  } catch (err) {
    next(err);
  }
}

export async function listarEstadosAnimalPerdido(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.listarEstadosAnimalPerdido());
  } catch (err) {
    next(err);
  }
}
