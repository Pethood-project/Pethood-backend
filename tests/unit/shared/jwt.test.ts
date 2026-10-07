import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { env } from '../../../src/config/env';
import { firmarToken, refrescarToken, verificarToken } from '../../../src/shared/jwt';

describe('jwt', () => {
  it('firma y verifica un token, devolviendo el mismo payload', () => {
    const token = firmarToken({ usuarioId: 5, roles: ['Adoptante'] });
    const payload = verificarToken(token);

    expect(payload.usuarioId).toBe(5);
    expect(payload.roles).toEqual(['Adoptante']);
  });

  it('verificarToken no acepta otro JWT firmado con el mismo secreto (con audience, sin usuario)', () => {
    // Ej. el state de la vinculación con Mercado Pago: usado como Bearer dejaba usuarioId en
    // undefined y los filtros por usuario desaparecían (hallazgo de la revisión de la spec 027).
    const conAudiencia = jwt.sign({ r: 3, u: 7, v: 'x' }, env.JWT_SECRET, {
      audience: 'mp-vinculacion',
    });
    const sinUsuario = jwt.sign({ roles: [] }, env.JWT_SECRET);
    const sinRoles = jwt.sign({ usuarioId: 1 }, env.JWT_SECRET);

    expect(() => verificarToken(conAudiencia)).toThrow();
    expect(() => verificarToken(sinUsuario)).toThrow();
    expect(() => verificarToken(sinRoles)).toThrow();
  });

  it('verificarToken tira si el token está corrompido', () => {
    expect(() => verificarToken('esto-no-es-un-jwt')).toThrow();
  });

  it('verificarToken tira si el token expiró', () => {
    const vencido = jwt.sign(
      { usuarioId: 1, roles: [], exp: Math.floor(Date.now() / 1000) - 10 },
      env.JWT_SECRET,
    );

    expect(() => verificarToken(vencido)).toThrow();
  });

  it('verificarToken tira si el token fue firmado con otro secreto', () => {
    const tokenAjeno = jwt.sign({ usuarioId: 1, roles: [] }, 'otro-secreto-cualquiera');

    expect(() => verificarToken(tokenAjeno)).toThrow();
  });

  it('refrescarToken devuelve un token válido con el mismo payload', () => {
    // Nota: si se llama en el mismo segundo que la firma original, el JWT resultante
    // puede ser byte-a-byte idéntico (mismo header+payload+iat+secret) — es determinístico
    // por diseño, no un bug. Lo que importa es que siga siendo válido y preserve el payload.
    const original = firmarToken({ usuarioId: 9, roles: ['Refugio', 'Adoptante'] });
    const refrescado = refrescarToken(original);

    const payload = verificarToken(refrescado);
    expect(payload.usuarioId).toBe(9);
    expect(payload.roles).toEqual(['Refugio', 'Adoptante']);
  });
});
