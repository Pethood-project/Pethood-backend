/**
 * Entrada y salida de historia clínica. Las reglas genéricas (trim, longitudes, fechas)
 * salen de `shared/validation`; acá solo se compone lo propio del módulo.
 */
import type { TipoVacuna } from '@prisma/client';
import { z } from 'zod';
import { TIPOS_VACUNA } from '../../shared/vacunas';
import { LIMITES } from '../../shared/validation/limits';
import {
  booleanoOpcionalSchema,
  booleanoSchema,
  fechaFuturaOpcionalSchema,
  fechaPasadaSchema,
  textoOpcionalSchema,
  textoSchema,
} from '../../shared/validation/schemas';
import { mensajeObligatorio } from '../../shared/validation/text';

/**
 * Alta (HU-8.1), en dos variantes según `tipoVacuna` (spec 019):
 * - Sin `tipoVacuna` es un registro común (visita, inyección, operación...): fecha visita,
 *   título y descripción obligatorios.
 * - Con `tipoVacuna` es una vacuna: el título es el nombre de la vacuna (lo pone el service)
 *   y la descripción, si no viene, es la del plan de vacunación.
 * Fecha próxima y requiere revisión son opcionales en los dos casos. El tipo de vacuna solo
 * se fija acá — HU-8.3 no lo lista entre los campos editables.
 */
export const crearHistoriaClinicaSchema = z
  .object({
    fechaVisita: fechaPasadaSchema('La fecha de visita'),
    fechaProxima: fechaFuturaOpcionalSchema('La fecha próxima'),
    requiereRevision: booleanoSchema(),
    tipoVacuna: z
      .preprocess(
        (valor) => (valor === '' || valor === null ? undefined : valor),
        z
          .enum(TIPOS_VACUNA, { errorMap: () => ({ message: 'La vacuna no es válida' }) })
          .optional(),
      )
      .transform((valor): TipoVacuna | null => valor ?? null),
    titulo: textoOpcionalSchema({
      max: LIMITES.historiaClinica.titulo.max,
      etiqueta: 'El título',
    }),
    descripcion: textoOpcionalSchema({
      max: LIMITES.historiaClinica.descripcion.max,
      etiqueta: 'La descripción',
    }),
  })
  .superRefine((datos, ctx) => {
    if (datos.tipoVacuna) return;

    if (datos.titulo === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: mensajeObligatorio('El título') });
    } else if (datos.descripcion === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: mensajeObligatorio('La descripción'),
      });
    }
  });

export type CrearHistoriaClinicaDto = z.infer<typeof crearHistoriaClinicaSchema>;

/**
 * Modificación (HU-8.3): nunca es un UPDATE real (ver `historia-clinica.service.ts`), pero
 * el formulario de edición puede reenviar solo lo que cambió — lo ausente se completa con
 * el valor del registro anterior en el service. `tipoVacuna` queda deliberadamente afuera:
 * no es un campo editable según la HU; y en una vacuna el título es su nombre, así que el
 * service ignora el que llegue.
 */
export const editarHistoriaClinicaSchema = z.object({
  fechaVisita: fechaPasadaSchema('La fecha de visita').optional(),
  fechaProxima: fechaFuturaOpcionalSchema('La fecha próxima').optional(),
  requiereRevision: booleanoOpcionalSchema(),
  titulo: textoSchema({ ...LIMITES.historiaClinica.titulo, etiqueta: 'El título' }).optional(),
  descripcion: textoSchema({
    ...LIMITES.historiaClinica.descripcion,
    etiqueta: 'La descripción',
  }).optional(),
});

export type EditarHistoriaClinicaDto = z.infer<typeof editarHistoriaClinicaSchema>;

export interface HistoriaClinicaDto {
  id: number;
  fechaVisita: string;
  fechaProxima: string | null;
  requiereRevision: boolean;
  vacunacion: boolean;
  /** Qué vacuna es, para pintar su medalla; null si no es vacuna (spec 019). */
  tipoVacuna: TipoVacuna | null;
  titulo: string;
  descripcion: string;
  documentoUrl: string | null;
  mascotaId: number;
  usuarioAlta: number;
  fechaAlta: string;
}
