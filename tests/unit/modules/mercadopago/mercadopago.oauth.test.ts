import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import {
  firmarEstado,
  generarPkce,
  leerEstado,
} from '../../../../src/modules/mercadopago/mercadopago.oauth';

const SECRETO = 'secreto-de-prueba-largo';
const CLAVE = randomBytes(32).toString('base64');

describe('generarPkce', () => {
  it('el desafío es el SHA-256 del verificador en base64url', () => {
    const { verificador, desafio } = generarPkce();
    expect(verificador.length).toBeGreaterThanOrEqual(43);
    expect(desafio).toBe(createHash('sha256').update(verificador).digest('base64url'));
  });
});

describe('state firmado', () => {
  it('ida y vuelta, sin el verificador en claro', () => {
    const state = firmarEstado(
      { refugioId: 3, usuarioId: 7, verificador: 'v'.repeat(64) },
      SECRETO,
      CLAVE,
    );
    expect(state).not.toContain('v'.repeat(20));
    expect(leerEstado(state, SECRETO, CLAVE)).toEqual({
      refugioId: 3,
      usuarioId: 7,
      verificador: 'v'.repeat(64),
    });
  });

  it('alterado o firmado con otro secreto, tira', () => {
    const state = firmarEstado({ refugioId: 3, usuarioId: 7, verificador: 'v' }, SECRETO, CLAVE);
    expect(() => leerEstado(`${state}x`, SECRETO, CLAVE)).toThrow();
    expect(() => leerEstado(state, 'otro-secreto-largo', CLAVE)).toThrow();
  });

  it('vencido, tira', () => {
    const vencido = jwt.sign(
      { r: 3, u: 7, v: 'x', exp: Math.floor(Date.now() / 1000) - 10 },
      SECRETO,
      {
        audience: 'mp-vinculacion',
      },
    );
    expect(() => leerEstado(vencido, SECRETO, CLAVE)).toThrow();
  });
});
