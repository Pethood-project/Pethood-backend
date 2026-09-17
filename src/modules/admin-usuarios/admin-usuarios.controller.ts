import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import { parsearId } from '../../shared/validation/numbers';
import { filtrosRefugiosSchema, filtrosUsuariosSchema } from './admin-usuarios.dto';
import type { AltaRefugioBody, MotivoBody, RolesBody } from './admin-usuarios.dto';
import * as service from './admin-usuarios.service';

function idDeParametro(req: Request): number {
  const id = parsearId(req.params.id);
  if (id === null) throw new AppError('VALIDACION', 'El id no es válido', 400);
  return id;
}

// ─────────────── Usuarios ───────────────

export async function listarUsuarios(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const resultado = filtrosUsuariosSchema.safeParse(req.query);
    if (!resultado.success) {
      throw new AppError(
        'VALIDACION',
        resultado.error.issues[0]?.message ?? 'Filtros inválidos',
        400,
      );
    }
    res.json(await service.listarUsuarios(resultado.data));
  } catch (err) {
    next(err);
  }
}

export async function verificarUsuario(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const usuario = await service.verificarUsuario(req.usuario!.usuarioId, idDeParametro(req));
    res.json({ mensaje: 'Usuario verificado.', usuario });
  } catch (err) {
    next(err);
  }
}

export async function suspenderUsuario(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { motivo } = req.body as MotivoBody;
    const usuario = await service.suspenderUsuario(
      req.usuario!.usuarioId,
      idDeParametro(req),
      motivo,
    );
    res.json({ mensaje: 'Usuario suspendido.', usuario });
  } catch (err) {
    next(err);
  }
}

export async function reactivarUsuario(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const usuario = await service.reactivarUsuario(req.usuario!.usuarioId, idDeParametro(req));
    res.json({ mensaje: 'Usuario reactivado.', usuario });
  } catch (err) {
    next(err);
  }
}

export async function bajaUsuario(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { motivo } = req.body as MotivoBody;
    const usuario = await service.bajaUsuario(req.usuario!.usuarioId, idDeParametro(req), motivo);
    res.json({ mensaje: 'Usuario dado de baja.', usuario });
  } catch (err) {
    next(err);
  }
}

export async function gestionarRoles(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const resultado = await service.gestionarRoles(
      req.usuario!.usuarioId,
      idDeParametro(req),
      req.body as RolesBody,
    );
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

// ─────────────── Refugios ───────────────

export async function listarRefugios(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const resultado = filtrosRefugiosSchema.safeParse(req.query);
    if (!resultado.success) {
      throw new AppError(
        'VALIDACION',
        resultado.error.issues[0]?.message ?? 'Filtros inválidos',
        400,
      );
    }
    res.json(await service.listarRefugios(resultado.data));
  } catch (err) {
    next(err);
  }
}

export async function obtenerRefugio(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.obtenerDetalleRefugio(idDeParametro(req)));
  } catch (err) {
    next(err);
  }
}

export async function altaRefugio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refugio = await service.altaRefugio(req.usuario!.usuarioId, req.body as AltaRefugioBody);
    res.status(201).json({ mensaje: 'Refugio creado.', refugio });
  } catch (err) {
    next(err);
  }
}

export async function verificarRefugio(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const refugio = await service.verificarRefugio(req.usuario!.usuarioId, idDeParametro(req));
    res.json({ mensaje: 'Refugio verificado.', refugio });
  } catch (err) {
    next(err);
  }
}

export async function suspenderRefugio(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { motivo } = req.body as MotivoBody;
    const refugio = await service.suspenderRefugio(
      req.usuario!.usuarioId,
      idDeParametro(req),
      motivo,
    );
    res.json({ mensaje: 'Refugio suspendido.', refugio });
  } catch (err) {
    next(err);
  }
}

export async function reactivarRefugio(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const refugio = await service.reactivarRefugio(req.usuario!.usuarioId, idDeParametro(req));
    res.json({ mensaje: 'Refugio reactivado.', refugio });
  } catch (err) {
    next(err);
  }
}

export async function bajaRefugio(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { motivo } = req.body as MotivoBody;
    const refugio = await service.bajaRefugio(req.usuario!.usuarioId, idDeParametro(req), motivo);
    res.json({ mensaje: 'Refugio dado de baja.', refugio });
  } catch (err) {
    next(err);
  }
}
