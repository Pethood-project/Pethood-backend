/**
 * Entrada de Moderación y Reportes (spec 008, Módulo 3). Las reglas genéricas salen de
 * `shared/validation`; acá solo se compone lo propio del reporte.
 */
import { TipoReporte } from '@prisma/client';
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import { idSchema, textoSchema } from '../../shared/validation/schemas';
import { paginacionSchema } from '../admin-usuarios/admin-usuarios.dto';

/** HU-3.1 a HU-3.3. `objetoId` es el id de la tabla que indica `tipo` (sin FK, ver spec 008). */
export const crearReporteSchema = z.object({
  tipo: z.nativeEnum(TipoReporte, { errorMap: () => ({ message: 'El tipo no es válido' }) }),
  objetoId: idSchema('El objeto reportado'),
  motivo: textoSchema({ ...LIMITES.reporte.motivo, etiqueta: 'El motivo' }),
});

export type CrearReporteBody = z.infer<typeof crearReporteSchema>;

/** HU-3.7. */
export const resolverReporteSchema = z.object({
  respuesta: textoSchema({ ...LIMITES.admin.respuestaReporte, etiqueta: 'La respuesta' }),
});

export type ResolverReporteBody = z.infer<typeof resolverReporteSchema>;

/** HU-3.6: pendientes por defecto. Tabla de web-admin, paginación por offset. */
export const filtrosReportesSchema = z.object({
  estado: z.enum(['pendiente', 'resuelto', 'todos']).optional().default('pendiente'),
  tipo: z.nativeEnum(TipoReporte).optional(),
  ...paginacionSchema,
});

export type FiltrosReportes = z.infer<typeof filtrosReportesSchema>;
