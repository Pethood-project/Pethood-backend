import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface PayloadToken {
  usuarioId: number;
  email?: string;
  roles: string[];
}

export function firmarToken(payload: PayloadToken): string {
  return jwt.sign(
    {
      usuarioId: payload.usuarioId,
      // Alias para el decode del frontend (web-admin lee `id` del payload).
      id: payload.usuarioId,
      email: payload.email,
      roles: payload.roles,
    },
    env.JWT_SECRET,
    {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    },
  );
}

export function verificarToken(token: string): PayloadToken {
  const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload & Partial<PayloadToken>;

  // Sólo un token de sesión autentica. Cualquier otro JWT firmado con el mismo secreto (con
  // audience, o sin usuario o roles) dejaría `usuarioId` en undefined, y Prisma ignora los
  // filtros `{ id: undefined }`: se verían datos de otros usuarios.
  if (
    payload.aud !== undefined ||
    !Number.isInteger(payload.usuarioId) ||
    !Array.isArray(payload.roles)
  ) {
    throw new jwt.JsonWebTokenError('No es un token de sesión');
  }

  return payload as PayloadToken;
}

/**
 * "Refresh" en un esquema stateless (CONSTITUTION.md §4: sin sesiones server-side):
 * re-firma el mismo payload con una expiración nueva. No hay tabla de refresh-tokens.
 */
export function refrescarToken(token: string): string {
  const { usuarioId, email, roles } = verificarToken(token);
  return firmarToken({ usuarioId, email, roles });
}
