import { z } from 'zod';
import { parsearMesISO } from '../../shared/validation/dates';

/** "AAAA-MM" válido, igual formato que <input type="month"> en el front. */
const mesISO = z.string().refine((valor) => parsearMesISO(valor) !== null, {
  message: 'Debe tener el formato AAAA-MM',
});

export const periodoDashboardSchema = z
  .object({
    desde: mesISO,
    hasta: mesISO,
  })
  .refine((periodo) => periodo.desde <= periodo.hasta, {
    message: 'El mes "desde" no puede ser posterior al mes "hasta"',
  });

export type PeriodoDashboardInput = z.infer<typeof periodoDashboardSchema>;

// Export por entidad (mismo patrón que dashboard-admin.dto.ts), scopeado a refugioId.
export const ENTIDADES_EXPORTABLES_REFUGIO = ['mascotas', 'solicitudes', 'donaciones'] as const;

export type EntidadExportableRefugio = (typeof ENTIDADES_EXPORTABLES_REFUGIO)[number];

export const entidadExportRefugioSchema = z.enum(ENTIDADES_EXPORTABLES_REFUGIO);
