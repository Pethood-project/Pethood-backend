import type { ZodTypeAny } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  actualizarPreguntaSchema,
  crearPreguntaSchema,
  normalizarOpciones,
  reordenarPreguntasSchema,
} from '../../../../src/modules/preguntas-adopcion/preguntas-adopcion.dto';

function primerError(schema: ZodTypeAny, entrada: unknown): string | undefined {
  const resultado = schema.safeParse(entrada);
  return resultado.success ? undefined : resultado.error.issues[0]?.message;
}

describe('crearPreguntaSchema', () => {
  it('acepta una pregunta de texto y la deja sin alcance de especie', () => {
    const resultado = crearPreguntaSchema.parse({
      texto: '  ¿Tenés veterinario cerca?  ',
      tipo: 'TEXTO',
    });

    expect(resultado).toEqual({
      texto: '¿Tenés veterinario cerca?',
      tipo: 'TEXTO',
      opciones: [],
      obligatoria: false,
      especieId: null,
    });
  });

  it('acepta el alcance por especie y que sea obligatoria', () => {
    const resultado = crearPreguntaSchema.parse({
      texto: '¿Tu jardín está cerrado?',
      tipo: 'SI_NO',
      obligatoria: true,
      especieId: 2,
    });

    expect(resultado).toMatchObject({ obligatoria: true, especieId: 2 });
  });

  it('el texto es obligatorio y tiene tope', () => {
    expect(primerError(crearPreguntaSchema, { tipo: 'TEXTO' })).toBeDefined();
    expect(primerError(crearPreguntaSchema, { texto: '  ', tipo: 'TEXTO' })).toBeDefined();
    expect(
      primerError(crearPreguntaSchema, { texto: 'a'.repeat(201), tipo: 'TEXTO' }),
    ).toBeDefined();
    expect(
      primerError(crearPreguntaSchema, { texto: 'a'.repeat(200), tipo: 'TEXTO' }),
    ).toBeUndefined();
  });

  it('pide el tipo y rechaza uno inventado', () => {
    expect(primerError(crearPreguntaSchema, { texto: '¿Hola?' })).toBe(
      'Elegí cómo se responde la pregunta',
    );
    expect(primerError(crearPreguntaSchema, { texto: '¿Hola?', tipo: 'LIBRE' })).toBe(
      'El tipo de respuesta no es válido',
    );
  });

  it('OPCIONES pide entre 2 y 6 opciones', () => {
    const base = { texto: '¿Dónde vivís?', tipo: 'OPCIONES' };

    expect(primerError(crearPreguntaSchema, base)).toBe('Cargá entre 2 y 6 opciones');
    expect(primerError(crearPreguntaSchema, { ...base, opciones: ['Casa'] })).toBe(
      'Cargá entre 2 y 6 opciones',
    );
    expect(
      primerError(crearPreguntaSchema, { ...base, opciones: ['1', '2', '3', '4', '5', '6', '7'] }),
    ).toBe('Cargá entre 2 y 6 opciones');
    expect(
      primerError(crearPreguntaSchema, { ...base, opciones: ['Casa', 'Depto'] }),
    ).toBeUndefined();
  });

  it('las opciones no se repiten, sin distinguir mayúsculas', () => {
    expect(
      primerError(crearPreguntaSchema, {
        texto: '¿Dónde vivís?',
        tipo: 'OPCIONES',
        opciones: ['Casa', 'casa'],
      }),
    ).toBe('Las opciones no pueden repetirse');
  });

  it('en los otros tipos las opciones se descartan en vez de rechazarse', () => {
    const resultado = crearPreguntaSchema.parse({
      texto: '¿Tenés patio?',
      tipo: 'SI_NO',
      opciones: ['Sí', 'No'],
    });

    expect(resultado.opciones).toEqual([]);
  });

  it('una opción demasiado larga se rechaza', () => {
    expect(
      primerError(crearPreguntaSchema, {
        texto: '¿Dónde vivís?',
        tipo: 'OPCIONES',
        opciones: ['a'.repeat(61), 'Casa'],
      }),
    ).toBeDefined();
  });
});

describe('actualizarPreguntaSchema', () => {
  it('es parcial: lo que no llega queda sin tocar', () => {
    const resultado = actualizarPreguntaSchema.parse({ obligatoria: true });

    expect(resultado).toEqual({ obligatoria: true });
  });

  it('especieId null pasa a "todas"; ausente no se toca', () => {
    expect(actualizarPreguntaSchema.parse({ especieId: null }).especieId).toBeNull();
    expect(actualizarPreguntaSchema.parse({}).especieId).toBeUndefined();
  });

  it('activa se conserva como booleano, también si llega como texto', () => {
    expect(actualizarPreguntaSchema.parse({ activa: false }).activa).toBe(false);
    expect(actualizarPreguntaSchema.parse({ activa: 'true' }).activa).toBe(true);
  });
});

describe('reordenarPreguntasSchema', () => {
  it('pide al menos una pregunta', () => {
    expect(primerError(reordenarPreguntasSchema, { ids: [] })).toBe(
      'Faltan las preguntas a ordenar',
    );
    expect(primerError(reordenarPreguntasSchema, {})).toBeDefined();
  });

  it('acepta ids numéricos', () => {
    expect(reordenarPreguntasSchema.parse({ ids: [3, '1', 2] }).ids).toEqual([3, 1, 2]);
  });
});

describe('normalizarOpciones', () => {
  it('sin tipo OPCIONES devuelve vacío', () => {
    expect(normalizarOpciones('TEXTO', ['a', 'b'])).toEqual({ opciones: [] });
  });
});
