/**
 * Entrada del módulo de soporte (spec 015). Las reglas genéricas salen de
 * `shared/validation`; acá solo se compone lo propio del módulo.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import {
  enteroSchema,
  idSchema,
  textoOpcionalSchema,
  textoSchema,
} from '../../shared/validation/schemas';
import { emailSchema } from '../auth/auth.dto';

const L = LIMITES;

const cuerpoNoVacio = (cuerpo: Record<string, unknown>) =>
  Object.values(cuerpo).some((valor) => valor !== undefined);
const MENSAJE_CUERPO_VACIO = 'Indicá al menos un campo para modificar.';

// ─────────────── Consultas (HU-15.2) ───────────────

export const consultaBodySchema = z.object({
  nombreCompleto: textoSchema({
    ...L.consultaSoporte.nombreCompleto,
    etiqueta: 'El nombre completo',
    soloLetras: true,
  }),
  email: emailSchema.pipe(
    z.string().max(L.consultaSoporte.email.max, 'El correo electrónico es demasiado largo'),
  ),
  asunto: textoSchema({ ...L.consultaSoporte.asunto, etiqueta: 'El asunto' }),
  mensaje: textoSchema({ ...L.consultaSoporte.mensaje, etiqueta: 'El mensaje' }),
});

export type ConsultaBody = z.infer<typeof consultaBodySchema>;

/** `'true'`/`'false'` en query string; ausente = sin filtro. */
export const filtrosConsultasSchema = z.object({
  resuelta: z
    .enum(['true', 'false'])
    .optional()
    .transform((valor) => (valor === undefined ? undefined : valor === 'true')),
});

export type FiltrosConsultas = z.infer<typeof filtrosConsultasSchema>;

// ─────────────── FAQs (HU-15.3) ───────────────

const categoriaNombre = () =>
  textoSchema({ ...L.faqCategoria.nombre, etiqueta: 'El nombre de la categoría' });
const categoriaDescripcion = () =>
  textoOpcionalSchema({ max: L.faqCategoria.descripcion.max, etiqueta: 'La descripción' });

export const categoriaBodySchema = z.object({
  nombre: categoriaNombre(),
  descripcion: categoriaDescripcion(),
});

export const categoriaPatchSchema = z
  .object({ nombre: categoriaNombre().optional(), descripcion: categoriaDescripcion().optional() })
  .refine(cuerpoNoVacio, { message: MENSAJE_CUERPO_VACIO });

export type CategoriaBody = z.infer<typeof categoriaBodySchema>;
export type CategoriaPatch = z.infer<typeof categoriaPatchSchema>;

const faqPregunta = () => textoSchema({ ...L.faq.pregunta, etiqueta: 'La pregunta' });
const faqRespuesta = () => textoSchema({ ...L.faq.respuesta, etiqueta: 'La respuesta' });
const faqOrden = () => enteroSchema({ ...L.faq.orden, etiqueta: 'El orden' });
const faqCategoriaId = () => idSchema('La categoría');

export const faqBodySchema = z.object({
  pregunta: faqPregunta(),
  respuesta: faqRespuesta(),
  orden: faqOrden(),
  faqCategoriaId: faqCategoriaId(),
});

export const faqPatchSchema = z
  .object({
    pregunta: faqPregunta().optional(),
    respuesta: faqRespuesta().optional(),
    orden: faqOrden().optional(),
    faqCategoriaId: faqCategoriaId().optional(),
  })
  .refine(cuerpoNoVacio, { message: MENSAJE_CUERPO_VACIO });

export type FaqBody = z.infer<typeof faqBodySchema>;
export type FaqPatch = z.infer<typeof faqPatchSchema>;
