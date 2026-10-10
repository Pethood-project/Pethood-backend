import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cifrar, descifrar } from '../../../src/shared/cifrado';

const CLAVE = randomBytes(32).toString('base64');

describe('cifrar / descifrar', () => {
  it('ida y vuelta', () => {
    expect(descifrar(cifrar('APP_USR-secreto', CLAVE), CLAVE)).toBe('APP_USR-secreto');
  });

  it('el mismo texto cifra distinto cada vez (IV aleatorio) y no contiene el texto', () => {
    const a = cifrar('APP_USR-secreto', CLAVE);
    expect(a).not.toBe(cifrar('APP_USR-secreto', CLAVE));
    expect(a).not.toContain('APP_USR');
  });

  it('un texto alterado no se descifra', () => {
    const [v, iv, tag, datos] = cifrar('APP_USR-secreto', CLAVE).split(':');
    const alterado = [v, iv, tag, Buffer.from('otra cosa').toString('base64')].join(':');
    expect(() => descifrar(alterado, CLAVE)).toThrow();
    expect(datos).toBeTruthy();
  });

  it('con otra clave no se descifra', () => {
    expect(() => descifrar(cifrar('x', CLAVE), randomBytes(32).toString('base64'))).toThrow();
  });

  it('exige una clave de 32 bytes', () => {
    expect(() => cifrar('x', Buffer.from('corta').toString('base64'))).toThrow(
      'La clave de cifrado tiene que tener 32 bytes',
    );
  });
});
