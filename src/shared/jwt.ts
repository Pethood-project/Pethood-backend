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
  return jwt.verify(token, env.JWT_SECRET) as PayloadToken;
}

/**
 * "Refresh" en un esquema stateless (CONSTITUTION.md §4: sin sesiones server-side):
 * re-firma el mismo payload con una expiración nueva. No hay tabla de refresh-tokens.
 */
export function refrescarToken(token: string): string {
  const { usuarioId, email, roles } = verificarToken(token);
  return firmarToken({ usuarioId, email, roles });
}
