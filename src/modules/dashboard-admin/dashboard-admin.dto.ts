import { z } from 'zod';

export const ENTIDADES_EXPORTABLES = [
  'usuarios',
  'mascotas',
  'publicaciones',
  'solicitudes',
  'campanias',
] as const;

export type EntidadExportable = (typeof ENTIDADES_EXPORTABLES)[number];

export const entidadExportSchema = z.enum(ENTIDADES_EXPORTABLES);
