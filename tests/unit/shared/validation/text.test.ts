import { describe, expect, it } from 'vitest';
import {
  mensajeLongitud,
  mensajeObligatorio,
  validarTexto,
} from '../../../../src/shared/validation/text';

const nombre = { min: 2, max: 25, etiqueta: 'El nombre' };

describe('validarTexto', () => {
  it('recorta los espacios de los extremos', () => {
    expect(validarTexto('  Fido  ', nombre)).toEqual({ valido: true, valor: 'Fido' });
  });

  it('rechaza un texto de un solo carácter con el mensaje de longitud', () => {
    expect(validarTexto('F', nombre)).toEqual({
      valido: false,
      error: 'El nombre debe tener entre 2 y 25 caracteres',
    });
  });

  it('un texto de solo espacios falla por longitud, no como campo vacío', () => {
    // Para quien lo escribió el campo tenía contenido: el mensaje debe hablar de longitud.
    expect(validarTexto('     ', nombre)).toEqual({
      valido: false,
      error: 'El nombre debe tener entre 2 y 25 caracteres',
    });
  });

  it('rechaza un texto que supera el máximo', () => {
    expect(validarTexto('a'.repeat(26), nombre).valido).toBe(false);
  });

  it('acepta exactamente el mínimo y el máximo', () => {
    expect(validarTexto('ab', nombre).valido).toBe(true);
    expect(validarTexto('a'.repeat(25), nombre).valido).toBe(true);
  });

  it('cuenta la longitud después del trim, no antes', () => {
    expect(validarTexto(`  ${'a'.repeat(25)}  `, nombre).valido).toBe(true);
  });

  it('un valor ausente da el mismo mensaje que uno de solo espacios', () => {
    // Desde la UI un campo vacío y uno lleno de espacios se ven igual: si dieran mensajes
    // distintos, la diferencia no tendría sentido para quien lo está completando.
    expect(validarTexto(undefined, nombre)).toEqual({
      valido: false,
      error: 'El nombre debe tener entre 2 y 25 caracteres',
    });
  });

  it('acepta vacío cuando el campo es opcional', () => {
    expect(validarTexto('   ', { max: 50, etiqueta: 'La nota', obligatorio: false })).toEqual({
      valido: true,
      valor: '',
    });
  });
});

describe('mensajeLongitud', () => {
  it('arma un único mensaje para mínimo y máximo', () => {
    expect(mensajeLongitud('El nombre', 2, 25)).toBe(
      'El nombre debe tener entre 2 y 25 caracteres',
    );
  });

  it('sin mínimo real habla solo del máximo, sin mencionar un rango desde cero', () => {
    expect(mensajeLongitud('La descripción', 0, 50)).toBe(
      'La descripción no puede superar los 50 caracteres',
    );
  });
});

describe('mensajeObligatorio', () => {
  it('concuerda en género con el artículo de la etiqueta', () => {
    expect(mensajeObligatorio('La ubicación')).toBe('La ubicación es obligatoria');
    expect(mensajeObligatorio('El peso')).toBe('El peso es obligatorio');
  });
});

describe('validarTexto — mensajes a medida', () => {
  // HU-9.1 fija el texto literal que tiene que ver el usuario, distinto del genérico.
  const descripcionSeguimiento = {
    min: 1,
    max: 10,
    etiqueta: 'La descripción',
    errorObligatorio: 'Completar descripción',
    errorLongitud: 'Limite de caracteres superado',
  };

  it('usa el mensaje a medida cuando el campo viene vacío', () => {
    expect(validarTexto('  ', descripcionSeguimiento)).toEqual({
      valido: false,
      error: 'Completar descripción',
    });
  });

  it('usa el mensaje a medida cuando se pasa del máximo', () => {
    expect(validarTexto('a'.repeat(11), descripcionSeguimiento)).toEqual({
      valido: false,
      error: 'Limite de caracteres superado',
    });
  });

  it('la regla de validez no cambia: un valor correcto sigue pasando recortado', () => {
    expect(validarTexto('  hola  ', descripcionSeguimiento)).toEqual({
      valido: true,
      valor: 'hola',
    });
  });
});

describe('validarTexto — campos sin mínimo', () => {
  const ubicacion = { max: 50, etiqueta: 'La ubicación' };

  it('un campo obligatorio vacío se reporta como obligatorio, no como longitud', () => {
    expect(validarTexto('   ', ubicacion)).toEqual({
      valido: false,
      error: 'La ubicación es obligatoria',
    });
  });

  it('rechaza por máximo cuando se pasa', () => {
    expect(validarTexto('a'.repeat(51), ubicacion)).toEqual({
      valido: false,
      error: 'La ubicación no puede superar los 50 caracteres',
    });
  });
});
