/**
 * Entrada y salida de historia clínica. Las reglas genéricas (trim, longitudes, fechas)
 * salen de `shared/validation`; acá solo se compone lo propio del módulo.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import {
  booleanoOpcionalSchema,
  booleanoSchema,
  fechaFuturaOpcionalSchema,
  fechaPasadaSchema,
  textoSchema,
} from '../../shared/validation/schemas';

/**
 * Alta (HU-8.1). Fecha visita, título y descripción son obligatorios; fecha próxima y
 * requiere revisión son opcionales; vacunación solo se puede fijar acá — HU-8.3 no la
 * lista entre los campos editables.
 */
export const crearHistoriaClinicaSchema = z.object({
  fechaVisita: fechaPasadaSchema('La fecha de visita'),
  fechaProxima: fechaFuturaOpcionalSchema('La fecha próxima'),
  requiereRevision: booleanoSchema(),
  vacunacion: booleanoSchema(),
  titulo: textoSchema({ ...LIMITES.historiaClinica.titulo, etiqueta: 'El título' }),
  descripcion: textoSchema({
    ...LIMITES.historiaClinica.descripcion,
    etiqueta: 'La descripción',
  }),
});

export type CrearHistoriaClinicaDto = z.infer<typeof crearHistoriaClinicaSchema>;

/**
 * Modificación (HU-8.3): nunca es un UPDATE real (ver `historia-clinica.service.ts`), pero
 * el formulario de edición puede reenviar solo lo que cambió — lo ausente se completa con
 * el valor del registro anterior en el service. `vacunacion` queda deliberadamente afuera:
 * no es un campo editable según la HU.
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
  titulo: string;
  descripcion: string;
  documentoUrl: string | null;
  mascotaId: number;
  usuarioAlta: number;
  fechaAlta: string;
}
