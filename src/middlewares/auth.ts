import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errorHandler';
import { CABECERA_AMBITO, resolverAmbito } from '../shared/ambito';
import { verificarToken } from '../shared/jwt';
import { buscarEstadoRefugioDeUsuario } from '../modules/auth/auth.repository';

/** Nombre del estado del catálogo EstadoRefugio (prisma/seed/catalogos.ts). */
const ESTADO_REFUGIO_ACTIVO = 'Activo';

/**
 * Middleware de autenticación: exige Authorization: Bearer <token>, cuelga el payload en
 * req.usuario y el perfil con el que actúa (cabecera X-Ambito) en req.ambito.
 *
 * El perfil de refugio solo se puede usar con el refugio Activo: pendiente de verificación,
 * suspendido o dado de baja, el miembro sigue entrando pero únicamente como adoptante.
 */
export async function autenticar(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    next(new AppError('NO_AUTENTICADO', 'Falta el token de autenticación', 401));
    return;
  }

  try {
    req.usuario = verificarToken(token);
  } catch {
    next(new AppError('NO_AUTENTICADO', 'Token inválido o expirado', 401));
    return;
  }

  const ambito = resolverAmbito(req.headers[CABECERA_AMBITO], req.usuario.roles ?? []);

  if (!ambito.ok) {
    next(
      ambito.motivo === 'SIN_REFUGIO'
        ? new AppError('SIN_REFUGIO', 'Tu usuario no está asociado a ningún refugio', 403)
        : new AppError('VALIDACION', 'El ámbito no es válido', 400),
    );
    return;
  }

  if (ambito.ambito === 'REFUGIO') {
    try {
      const estado = await buscarEstadoRefugioDeUsuario(req.usuario.usuarioId);
      if (estado !== ESTADO_REFUGIO_ACTIVO) {
        next(
          new AppError(
            'REFUGIO_NO_VERIFICADO',
            'Tu refugio todavía no está verificado o no está activo. Mientras tanto podés usar la app como adoptante.',
            403,
          ),
        );
        return;
      }
    } catch (error) {
      next(error);
      return;
    }
  }

  req.ambito = ambito.ambito;
  next();
}
