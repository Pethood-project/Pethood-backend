import { describe, expect, it } from 'vitest';
import {
  validarAliasOpcional,
  validarCbuOpcional,
} from '../../../../src/shared/validation/bancario';

describe('validarAliasOpcional', () => {
  it('vacío o ausente es null: el campo es opcional', () => {
    expect(validarAliasOpcional('')).toEqual({ valido: true, valor: null });
    expect(validarAliasOpcional('   ')).toEqual({ valido: true, valor: null });
    expect(validarAliasOpcional(undefined)).toEqual({ valido: true, valor: null });
  });

  it('acepta letras, números, puntos y guiones, con trim', () => {
    expect(validarAliasOpcional(' refugio.patitas-mp ')).toEqual({
      valido: true,
      valor: 'refugio.patitas-mp',
    });
  });

  it('rechaza largo fuera de 6 a 20', () => {
    expect(validarAliasOpcional('abc')).toEqual({
      valido: false,
      error: 'El alias debe tener entre 6 y 20 caracteres',
    });
    expect(validarAliasOpcional('a'.repeat(21))).toMatchObject({ valido: false });
  });

  it('rechaza espacios y símbolos', () => {
    expect(validarAliasOpcional('refugio patitas')).toEqual({
      valido: false,
      error: 'El alias sólo puede tener letras, números, puntos y guiones',
    });
    expect(validarAliasOpcional('refugio@mp')).toMatchObject({ valido: false });
  });
});

describe('validarCbuOpcional', () => {
  it('vacío es null', () => {
    expect(validarCbuOpcional('')).toEqual({ valido: true, valor: null });
  });

  it('acepta 22 dígitos y quita espacios pegados', () => {
    expect(validarCbuOpcional('0000003100 012345678901')).toEqual({
      valido: true,
      valor: '0000003100012345678901',
    });
  });

  it('rechaza otro largo o letras', () => {
    const error = { valido: false, error: 'El CBU o CVU debe tener 22 números' };
    expect(validarCbuOpcional('123')).toEqual(error);
    expect(validarCbuOpcional('000000310001234567890A')).toEqual(error);
  });
});
