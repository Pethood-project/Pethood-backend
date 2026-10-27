/**
 * Preguntas propias de un refugio, que se suman al final del formulario de solicitud.
 * Las reglas genéricas salen de `shared/validation`; acá solo se compone lo propio.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import {
  booleanoOpcionalSchema,
  booleanoSchema,
  idSchema,
  textoSchema,
} from '../../shared/validation/schemas';

export const TIPOS_PREGUNTA = ['TEXTO', 'SI_NO', 'OPCIONES'] as const;
export type TipoPregunta = (typeof TIPOS_PREGUNTA)[number];

/** Las dos respuestas posibles de una pregunta de tipo SI_NO, tal como se guardan. */
export const RESPUESTAS_SI_NO = ['Sí', 'No'] as const;

const tipoSchema = z.enum(TIPOS_PREGUNTA, {
  errorMap: (_issue, contexto) => ({
    message:
      contexto.data === undefined
        ? 'Elegí cómo se responde la pregunta'
        : 'El tipo de respuesta no es válido',
  }),
});

/** `null` = la pregunta aplica a todas las especies. */
const especieSchema = z.union([z.null(), idSchema('La especie')]);

const opcionesSchema = z.array(
  textoSchema({ max: LIMITES.preguntaAdopcion.opciones.largo, etiqueta: 'Cada opción' }),
  { invalid_type_error: 'Las opciones no son válidas' },
);

const textoPreguntaSchema = () =>
  textoSchema({ ...LIMITES.preguntaAdopcion.texto, etiqueta: 'La pregunta' });

/**
 * Las opciones solo existen en el tipo OPCIONES: ahí tienen que ser entre 2 y 6 y no repetirse
 * (sin distinguir mayúsculas). En los otros tipos se descartan en vez de rechazarse, así un
 * formulario que cambia de tipo no queda trabado por opciones que ya no ve.
 */
export function normalizarOpciones(
  tipo: TipoPregunta,
  opciones: string[],
): { opciones: string[] } | { error: string } {
  if (tipo !== 'OPCIONES') return { opciones: [] };

  const { minimo, maximo } = LIMITES.preguntaAdopcion.opciones;
  if (opciones.length < minimo || opciones.length > maximo) {
    return { error: `Cargá entre ${minimo} y ${maximo} opciones` };
  }

  const vistas = new Set(opciones.map((opcion) => opcion.toLowerCase()));
  if (vistas.size !== opciones.length) {
    return { error: 'Las opciones no pueden repetirse' };
  }

  return { opciones };
}

export const crearPreguntaSchema = z
  .object({
    texto: textoPreguntaSchema(),
    tipo: tipoSchema,
    opciones: opcionesSchema.optional(),
    obligatoria: booleanoSchema(),
    especieId: especieSchema.optional(),
  })
  .transform((datos, ctx) => {
    const normalizadas = normalizarOpciones(datos.tipo, datos.opciones ?? []);

    if ('error' in normalizadas) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['opciones'],
        message: normalizadas.error,
      });
      return z.NEVER;
    }

    return { ...datos, opciones: normalizadas.opciones, especieId: datos.especieId ?? null };
  });

export type CrearPreguntaDto = z.infer<typeof crearPreguntaSchema>;

/** Edición parcial: lo que no llega no se toca. `especieId: null` pasa a "todas". */
export const actualizarPreguntaSchema = z.object({
  texto: textoPreguntaSchema().optional(),
  tipo: tipoSchema.optional(),
  opciones: opcionesSchema.optional(),
  obligatoria: booleanoOpcionalSchema(),
  especieId: especieSchema.optional(),
  activa: booleanoOpcionalSchema(),
});

export type ActualizarPreguntaDto = z.infer<typeof actualizarPreguntaSchema>;

export const reordenarPreguntasSchema = z.object({
  ids: z
    .array(idSchema('La pregunta'), { required_error: 'Faltan las preguntas a ordenar' })
    .min(1, 'Faltan las preguntas a ordenar')
    .max(50, 'Son demasiadas preguntas'),
});

export type ReordenarPreguntasDto = z.infer<typeof reordenarPreguntasSchema>;

export const idPreguntaSchema = idSchema('La pregunta');

/** Una pregunta tal como la ve el refugio que la configura. */
export interface PreguntaDto {
  id: number;
  texto: string;
  tipo: TipoPregunta;
  opciones: string[];
  obligatoria: boolean;
  orden: number;
  activa: boolean;
  /** `null` = aplica a todas las especies. */
  especie: { id: number; nombre: string } | null;
}

/** Una pregunta tal como la ve quien completa el formulario de solicitud. */
export interface PreguntaAplicableDto {
  id: number;
  texto: string;
  tipo: TipoPregunta;
  opciones: string[];
  obligatoria: boolean;
}
