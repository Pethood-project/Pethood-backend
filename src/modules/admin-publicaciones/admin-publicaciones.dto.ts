/** Entrada de la moderación admin de publicaciones (BACKEND_PENDIENTE_ADMIN.md §1). */
import { z } from 'zod';
import { listaDeIdsSchema } from '../../shared/validation/schemas';
import {
  banderaOpcionalSchema,
  motivoBodySchema,
  paginacionSchema,
} from '../admin-usuarios/admin-usuarios.dto';

const idOpcional = z.coerce.number().int().positive().optional();

export const filtrosPublicacionesSchema = z.object({
  estados: listaDeIdsSchema('El estado'),
  refugioId: idOpcional,
  usuarioId: idOpcional,
  q: z.string().trim().min(1).optional(),
  incluirBajas: banderaOpcionalSchema.transform((valor) => valor ?? false),
  ...paginacionSchema,
});

export type FiltrosPublicaciones = z.infer<typeof filtrosPublicacionesSchema>;

export const estadoBodySchema = motivoBodySchema.extend({
  accion: z.enum(['PAUSAR', 'REACTIVAR', 'FINALIZAR']),
});

export type EstadoBody = z.infer<typeof estadoBodySchema>;
