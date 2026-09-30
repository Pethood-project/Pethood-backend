/** Entrada de la moderación admin de mascotas (BACKEND_PENDIENTE_ADMIN.md §2). */
import { z } from 'zod';
import { listaDeIdsSchema } from '../../shared/validation/schemas';
import { banderaOpcionalSchema, paginacionSchema } from '../admin-usuarios/admin-usuarios.dto';

const idOpcional = z.coerce.number().int().positive().optional();

export const filtrosMascotasSchema = z.object({
  estados: listaDeIdsSchema('El estado'),
  especieId: idOpcional,
  refugioId: idOpcional,
  usuarioId: idOpcional,
  q: z.string().trim().min(1).optional(),
  incluirBajas: banderaOpcionalSchema.transform((valor) => valor ?? false),
  ...paginacionSchema,
});

export type FiltrosMascotas = z.infer<typeof filtrosMascotasSchema>;
