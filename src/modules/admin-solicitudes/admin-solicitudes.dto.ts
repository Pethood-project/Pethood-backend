/** Entrada de la vista admin (solo lectura) de solicitudes (BACKEND_PENDIENTE_ADMIN.md §3). */
import { z } from 'zod';
import { listaDeIdsSchema } from '../../shared/validation/schemas';
import { paginacionSchema } from '../admin-usuarios/admin-usuarios.dto';

const idOpcional = z.coerce.number().int().positive().optional();
const fechaOpcional = z.coerce.date({ message: 'La fecha no es válida' }).optional();

export const filtrosSolicitudesSchema = z.object({
  estados: listaDeIdsSchema('El estado'),
  /** Nombre del tipo de solicitud (Adopcion / Transito), sin distinguir mayúsculas. */
  tipo: z.string().trim().min(1).optional(),
  refugioId: idOpcional,
  solicitanteId: idOpcional,
  desde: fechaOpcional,
  hasta: fechaOpcional,
  q: z.string().trim().min(1).optional(),
  ...paginacionSchema,
});

export type FiltrosSolicitudes = z.infer<typeof filtrosSolicitudesSchema>;
