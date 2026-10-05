/** Entrada de la vista admin (solo lectura) de campañas de donación. */
import { z } from 'zod';
import { paginacionSchema } from '../admin-usuarios/admin-usuarios.dto';

const idOpcional = z.coerce.number().int().positive().optional();

export const filtrosCampanasSchema = z.object({
  /** Nombre del estado de campaña (Inactiva / Activa / Finalizada), sin distinguir mayúsculas. */
  estado: z.string().trim().min(1).optional(),
  refugioId: idOpcional,
  q: z.string().trim().min(1).optional(),
  ...paginacionSchema,
});

export type FiltrosCampanas = z.infer<typeof filtrosCampanasSchema>;
