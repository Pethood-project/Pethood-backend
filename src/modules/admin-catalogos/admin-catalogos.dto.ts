/**
 * Entrada del ABM admin de catálogos (BACKEND_PENDIENTE_ADMIN.md §6). Qué operaciones admite
 * cada catálogo está en `PERMISOS`; ver `docs/api-admin-catalogos.md`.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import {
  enteroSchema,
  idSchema,
  textoOpcionalSchema,
  textoSchema,
} from '../../shared/validation/schemas';
import { banderaOpcionalSchema, paginacionSchema } from '../admin-usuarios/admin-usuarios.dto';

export const CATALOGOS = [
  'especies',
  'razas',
  'vacunas',
  'estados-mascota',
  'estados-publicacion',
  'estados-solicitud',
  'estados-campania',
  'estados-refugio',
  'estados-animal-perdido',
  'tipos-solicitud',
] as const;

export type NombreCatalogo = (typeof CATALOGOS)[number];

export const catalogoSchema = z.enum(CATALOGOS, {
  errorMap: () => ({ message: 'El catálogo no existe' }),
});

export interface Permisos {
  alta: boolean;
  edicion: boolean;
  baja: boolean;
}

const SOLO_EDICION: Permisos = { alta: false, edicion: true, baja: false };

/**
 * Los estados y los tipos de solicitud son parte de la lógica de negocio (el código los
 * busca por nombre): solo se les edita la descripción. Las vacunas son ABM completo desde
 * la spec 029.
 */
export const PERMISOS: Record<NombreCatalogo, Permisos> = {
  especies: { alta: true, edicion: true, baja: true },
  razas: { alta: true, edicion: true, baja: true },
  vacunas: { alta: true, edicion: true, baja: true },
  'estados-mascota': SOLO_EDICION,
  'estados-publicacion': SOLO_EDICION,
  'estados-solicitud': SOLO_EDICION,
  'estados-campania': SOLO_EDICION,
  'estados-refugio': SOLO_EDICION,
  'estados-animal-perdido': SOLO_EDICION,
  'tipos-solicitud': SOLO_EDICION,
};

export const filtrosCatalogoSchema = z.object({
  q: z.string().trim().min(1).optional(),
  /** Solo razas. */
  especieId: z.coerce.number().int().positive().optional(),
  incluirBajas: banderaOpcionalSchema.transform((valor) => valor ?? false),
  ...paginacionSchema,
});

export type FiltrosCatalogo = z.infer<typeof filtrosCatalogoSchema>;

const nombre = textoSchema({ ...LIMITES.catalogo.nombre, etiqueta: 'El nombre' });
const descripcion = textoOpcionalSchema({
  max: LIMITES.catalogo.descripcion.max,
  etiqueta: 'La descripción',
});

export interface DatosCatalogo {
  nombre?: string;
  descripcion?: string | null;
  especieId?: number;
  secuenciaDias?: number;
  /** Solo vacunas: especies que la admiten (al menos una). */
  especieIds?: number[];
}

const ALTA_ESPECIE = z.object({ nombre, descripcion });
const ALTA_RAZA = z.object({ nombre, especieId: idSchema('La especie') });
/** El `codigo` no se recibe: lo genera el service (spec 029 §6). Edición = mismo body. */
const ALTA_VACUNA = z.object({
  nombre,
  // Obligatoria: la app la precarga en la historia clínica y la muestra en la medalla.
  descripcion: textoSchema({
    min: 1,
    max: LIMITES.catalogo.descripcion.max,
    etiqueta: 'La descripción',
  }),
  especieIds: z
    .array(idSchema('La especie'), { invalid_type_error: 'Las especies no son válidas' })
    .min(1, 'Elegí al menos una especie'),
});

const EDICION_POR_CATALOGO: Partial<Record<NombreCatalogo, z.ZodTypeAny>> = {
  especies: ALTA_ESPECIE,
  razas: z.object({ nombre }),
  vacunas: ALTA_VACUNA,
  'tipos-solicitud': z.object({
    descripcion,
    secuenciaDias: enteroSchema({ ...LIMITES.catalogo.secuenciaDias, etiqueta: 'La secuencia' }),
  }),
};
// Todos los estados: solo descripción.
for (const c of CATALOGOS) {
  if (c.startsWith('estados-')) EDICION_POR_CATALOGO[c] = z.object({ descripcion });
}

/** Schema del body de POST, o `undefined` si el catálogo no admite altas. */
export function schemaAlta(
  catalogo: NombreCatalogo,
): z.ZodType<DatosCatalogo, z.ZodTypeDef, unknown> | undefined {
  if (catalogo === 'especies') return ALTA_ESPECIE;
  if (catalogo === 'razas') return ALTA_RAZA;
  if (catalogo === 'vacunas') return ALTA_VACUNA;
  return undefined;
}

/** Schema del body de PUT, o `undefined` si el catálogo no admite ediciones. */
export function schemaEdicion(
  catalogo: NombreCatalogo,
): z.ZodType<DatosCatalogo, z.ZodTypeDef, unknown> | undefined {
  return EDICION_POR_CATALOGO[catalogo];
}
