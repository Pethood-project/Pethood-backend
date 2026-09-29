import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { idSchema, limitePaginaSchema } from '../../../../src/shared/validation/schemas';

/** Primer mensaje de error, o `null` si validó. Es lo que el controller le manda al cliente. */
function primerError(schema: z.ZodTypeAny, datos: unknown): string | null {
  const resultado = schema.safeParse(datos);
  return resultado.success ? null : (resultado.error.issues[0]?.message ?? null);
}

describe('idSchema', () => {
  const especie = z.object({ especieId: idSchema('La especie') });

  it('acepta un id como número o como texto', () => {
    expect(especie.parse({ especieId: 3 })).toEqual({ especieId: 3 });
    expect(especie.parse({ especieId: '3' })).toEqual({ especieId: 3 });
  });

  it('un id ausente da el mensaje en español, no el de Zod en inglés', () => {
    expect(primerError(especie, {})).toBe('La especie es obligatoria');
    expect(primerError(especie, { especieId: '' })).toBe('La especie es obligatoria');
  });

  it('un id inválido concuerda en género con la etiqueta', () => {
    expect(primerError(especie, { especieId: 'abc' })).toBe('La especie no es válida');
    expect(primerError(z.object({ id: idSchema('El estado') }), { id: '0' })).toBe(
      'El estado no es válido',
    );
  });

  it('con .optional() un id ausente es válido', () => {
    expect(z.object({ cursor: idSchema('El cursor').optional() }).parse({})).toEqual({});
  });
});

describe('limitePaginaSchema', () => {
  const query = z.object({ limite: limitePaginaSchema({ porDefecto: 20, maximo: 50 }) });

  it('ausente toma el valor por defecto', () => {
    expect(query.parse({})).toEqual({ limite: 20 });
  });

  it('acepta un valor dentro del rango', () => {
    expect(query.parse({ limite: '35' })).toEqual({ limite: 35 });
  });

  it('fuera de rango da el mensaje en español', () => {
    for (const limite of ['0', '51', 'muchos']) {
      expect(primerError(query, { limite })).toBe('El límite tiene que ser un número entre 1 y 50');
    }
  });
});
