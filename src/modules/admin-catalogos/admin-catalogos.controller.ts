import type { Request } from 'express';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import { idDeParametro, responder } from '../../shared/responder';
import {
  catalogoSchema,
  filtrosCatalogoSchema,
  schemaAlta,
  schemaEdicion,
  type DatosCatalogo,
  type NombreCatalogo,
} from './admin-catalogos.dto';
import * as service from './admin-catalogos.service';

function catalogoDeParametro(req: Request): NombreCatalogo {
  const r = catalogoSchema.safeParse(req.params.catalogo);
  if (!r.success) throw new AppError('CATALOGO_NO_ENCONTRADO', r.error.issues[0]!.message, 404);
  return r.data;
}

function parsearBody(
  schema: ZodType<DatosCatalogo, ZodTypeDef, unknown> | undefined,
  body: unknown,
): DatosCatalogo {
  if (!schema) {
    throw new AppError('OPERACION_NO_PERMITIDA', 'Este catálogo no admite esa operación.', 403);
  }
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new AppError('VALIDACION', r.error.issues[0]?.message ?? 'Datos inválidos', 400);
  }
  return r.data;
}

export const listar = responder(async (req) => {
  const r = filtrosCatalogoSchema.safeParse(req.query);
  if (!r.success) {
    throw new AppError('VALIDACION', r.error.issues[0]?.message ?? 'Filtros inválidos', 400);
  }
  return service.listar(catalogoDeParametro(req), r.data);
});

export const crear = responder(async (req) => {
  const catalogo = catalogoDeParametro(req);
  const datos = parsearBody(schemaAlta(catalogo), req.body);
  return service.crear(req.usuario!.usuarioId, catalogo, datos);
});

export const editar = responder(async (req) => {
  const catalogo = catalogoDeParametro(req);
  const datos = parsearBody(schemaEdicion(catalogo), req.body);
  return service.editar(req.usuario!.usuarioId, catalogo, idDeParametro(req), datos);
});

export const darDeBaja = responder(async (req) =>
  service.darDeBaja(req.usuario!.usuarioId, catalogoDeParametro(req), idDeParametro(req)),
);

export const reactivar = responder(async (req) =>
  service.reactivar(req.usuario!.usuarioId, catalogoDeParametro(req), idDeParametro(req)),
);
