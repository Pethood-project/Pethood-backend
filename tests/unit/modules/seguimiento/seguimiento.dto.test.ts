import { describe, expect, it } from 'vitest';
import {
  enviarPreguntaSchema,
  subirActualizacionSchema,
} from '../../../../src/modules/seguimiento/seguimiento.dto';
import { LIMITES } from '../../../../src/shared/validation/limits';

/** Los mensajes de HU-9.1 son texto literal de la consigna: si cambian, cambia la evaluación. */
function errorDe(datos: unknown): string | undefined {
  const resultado = subirActualizacionSchema.safeParse(datos);
  return resultado.success ? undefined : resultado.error.issues[0]?.message;
}

describe('subirActualizacionSchema (HU-9.1)', () => {
  it('sin descripción responde "Completar descripción"', () => {
    expect(errorDe({})).toBe('Completar descripción');
    expect(errorDe({ descripcion: '   ' })).toBe('Completar descripción');
  });

  it('pasado el límite responde "Limite de caracteres superado"', () => {
    const larga = 'a'.repeat(LIMITES.seguimiento.descripcion.max + 1);

    expect(errorDe({ descripcion: larga })).toBe('Limite de caracteres superado');
  });

  it('acepta exactamente el máximo', () => {
    const justa = 'a'.repeat(LIMITES.seguimiento.descripcion.max);

    expect(errorDe({ descripcion: justa })).toBeUndefined();
  });

  it('recorta los espacios de los extremos', () => {
    const resultado = subirActualizacionSchema.parse({ descripcion: '  Come bien  ' });

    expect(resultado.descripcion).toBe('Come bien');
  });
});

describe('enviarPreguntaSchema (spec 011 §6.11)', () => {
  it('exige la pregunta y respeta sus límites', () => {
    const { min, max } = LIMITES.seguimiento.pregunta;

    expect(enviarPreguntaSchema.safeParse({ texto: '  ' }).success).toBe(false);
    expect(enviarPreguntaSchema.safeParse({ texto: 'a'.repeat(min - 1) }).success).toBe(false);
    expect(enviarPreguntaSchema.safeParse({ texto: 'a'.repeat(max + 1) }).success).toBe(false);
    expect(enviarPreguntaSchema.parse({ texto: ' ¿Duerme bien? ' }).texto).toBe('¿Duerme bien?');
  });
});
