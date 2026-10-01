import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import { idDeParametro } from '../../shared/responder';
import type { MotivoBody } from '../admin-usuarios/admin-usuarios.dto';
import {
  crearAvisoSchema,
  filtrosAvisosSchema,
  leerLinkMapaSchema,
  ubicarLugarSchema,
} from './animales-perdidos.dto';
import * as service from './animales-perdidos.service';

/** Traduce el primer issue de Zod al formato de error de la API. */
function parsearOFallar<T extends z.ZodTypeAny>(schema: T, datos: unknown): z.infer<T> {
  const resultado = schema.safeParse(datos);

  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
  }

  return resultado.data;
}

/**
 * HU-13.1. El formulario llega como multipart, así que el body no pasa por `validar`: primero
 * multer lo parsea y recién después se valida acá.
 */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const aviso = await service.crearAviso(parsearOFallar(crearAvisoSchema, req.body), {
      usuarioId: req.usuario!.usuarioId,
      archivos: Array.isArray(req.files) ? req.files : [],
    });

    res.status(201).json(aviso);
  } catch (err) {
    next(err);
  }
}

/** HU-13.1. El portal: 200 con lista vacía si no hay avisos, nunca 404. */
export async function listar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(
      await service.listarAvisos(
        parsearOFallar(filtrosAvisosSchema, req.query),
        req.usuario!.usuarioId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

/** Preview del lugar en el mapa, para verificarlo antes de publicar. */
export async function ubicarLugar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ lugar: await service.ubicarLugar(parsearOFallar(ubicarLugarSchema, req.body)) });
  } catch (err) {
    next(err);
  }
}

/** El punto de un link de Google Maps pegado a mano, para corregir el lugar antes de publicar. */
export async function leerLinkMapa(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { mapaUrl } = parsearOFallar(leerLinkMapaSchema, req.body);
    res.json({ lugar: await service.leerLinkMapa(mapaUrl) });
  } catch (err) {
    next(err);
  }
}

/** Opciones del filtro por lugar: provincias con avisos y sus localidades con avisos. */
export async function listarUbicaciones(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.listarUbicaciones());
  } catch (err) {
    next(err);
  }
}

/**
 * HU-13.2: reclamar el aviso y quedarse con la sala de reencuentro.
 *
 * 200 y no 201 porque es idempotente: el botón sigue visible después del primer reclamo y
 * volver a tocarlo devuelve la misma sala. El `nueva` del body distingue los dos casos.
 */
export async function reclamar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.reclamarAviso(idDeParametro(req), req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** HU-13.2: el reportante cierra el caso. Devuelve el aviso ya resuelto. */
export async function resolver(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.marcarResuelto(idDeParametro(req), req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

/** Baja de un aviso por el admin (spec 008, deuda #28). Devuelve 204. */
export async function darDeBajaPorAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { motivo } = req.body as MotivoBody;
    await service.darDeBajaPorAdmin(req.usuario!.usuarioId, idDeParametro(req), motivo);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
