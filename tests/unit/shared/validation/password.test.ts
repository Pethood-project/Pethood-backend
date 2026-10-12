import { describe, expect, it } from 'vitest';
import {
  MENSAJE_PASSWORD_NUEVA,
  validarPasswordNueva,
} from '../../../../src/shared/validation/password';

describe('validarPasswordNueva', () => {
  it('acepta mínimo 8 con mayúscula, minúscula, número y símbolo', () => {
    expect(validarPasswordNueva('Secreta123!')).toEqual({ valido: true, valor: 'Secreta123!' });
    expect(validarPasswordNueva('Ab1!abcd')).toEqual({ valido: true, valor: 'Ab1!abcd' });
  });

  it('cuenta las letras con tilde y la eñe', () => {
    expect(validarPasswordNueva('Ñandú2024#')).toMatchObject({ valido: true });
  });

  it('vacío o que no es texto es obligatoria', () => {
    const error = { valido: false, error: 'La contraseña es obligatoria.' };
    expect(validarPasswordNueva('')).toEqual(error);
    expect(validarPasswordNueva(undefined)).toEqual(error);
    expect(validarPasswordNueva(12345678)).toEqual(error);
  });

  it('rechaza si es más corta que 8', () => {
    expect(validarPasswordNueva('Ab1!abc')).toEqual({
      valido: false,
      error: MENSAJE_PASSWORD_NUEVA,
    });
  });

  it.each([
    ['sin mayúscula', 'secreta123!'],
    ['sin minúscula', 'SECRETA123!'],
    ['sin número', 'Secretaaa!!'],
    ['sin símbolo', 'Secreta1234'],
  ])('rechaza %s', (_motivo, password) => {
    expect(validarPasswordNueva(password)).toEqual({ valido: false, error: MENSAJE_PASSWORD_NUEVA });
  });

  it('el espacio no cuenta como símbolo', () => {
    expect(validarPasswordNueva('Secreta 123')).toMatchObject({ valido: false });
  });
});
