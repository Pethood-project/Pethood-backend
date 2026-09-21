import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { parsearId } from '../../shared/validation/numbers';
import type { CategoriaBody, CategoriaPatch, ConsultaBody, FaqBody, FaqPatch } from './soporte.dto';
import { filtrosConsultasSchema } from './soporte.dto';
import * as service from './soporte.service';

function idDeParametro(req: Request): number {
  const id = parsearId(req.params.id);
  if (id === null) throw new AppError('VALIDACION', 'El id no es válido', 400);
  return id;
}

/** Evita repetir el try/catch → next(err) en cada handler. */
function manejar(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

const adminId = (req: Request): number => req.usuario!.usuarioId;

// ─────────────── Públicos ───────────────

export const listarFaqs = manejar(async (_req, res) => {
  res.json(await service.listarFaqsPublicas());
});

export const enviarConsulta = manejar(async (req, res) => {
  res.status(201).json(await service.enviarConsulta(req.body as ConsultaBody));
});

// ─────────────── Admin: consultas ───────────────

export const listarConsultas = manejar(async (req, res) => {
  const filtros = filtrosConsultasSchema.safeParse(req.query);
  if (!filtros.success) {
    throw new AppError('VALIDACION', filtros.error.issues[0]?.message ?? 'Filtros inválidos', 400);
  }
  res.json(await service.listarConsultas(filtros.data));
});

export const resolverConsulta = manejar(async (req, res) => {
  res.json(await service.resolverConsulta(adminId(req), idDeParametro(req)));
});

export const bajaConsulta = manejar(async (req, res) => {
  await service.darDeBajaConsulta(adminId(req), idDeParametro(req));
  res.status(204).end();
});

// ─────────────── Admin: categorías ───────────────

export const listarCategorias = manejar(async (_req, res) => {
  res.json(await service.listarCategorias());
});

export const crearCategoria = manejar(async (req, res) => {
  res.status(201).json(await service.crearCategoria(adminId(req), req.body as CategoriaBody));
});

export const editarCategoria = manejar(async (req, res) => {
  res.json(
    await service.editarCategoria(adminId(req), idDeParametro(req), req.body as CategoriaPatch),
  );
});

export const bajaCategoria = manejar(async (req, res) => {
  await service.darDeBajaCategoria(adminId(req), idDeParametro(req));
  res.status(204).end();
});

// ─────────────── Admin: FAQs ───────────────

export const crearFaq = manejar(async (req, res) => {
  res.status(201).json(await service.crearFaq(adminId(req), req.body as FaqBody));
});

export const editarFaq = manejar(async (req, res) => {
  res.json(await service.editarFaq(adminId(req), idDeParametro(req), req.body as FaqPatch));
});

export const bajaFaq = manejar(async (req, res) => {
  await service.darDeBajaFaq(adminId(req), idDeParametro(req));
  res.status(204).end();
});
