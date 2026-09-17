import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import { idSchema, textoOpcionalSchema, textoSchema } from '../../shared/validation/schemas';
import { validarTexto } from '../../shared/validation/text';

/** Hasta 5 fotos por publicación; el orden recibido es el orden de la galería. */
export const MAXIMO_IMAGENES = 5;

/**
 * En multipart un campo repetido llega como array, pero con un único valor llega como
 * string suelto. Se normaliza siempre a array.
 */
function listaSchema(maximoPorItem: number, etiqueta: string) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((valor) => {
      if (valor === undefined) return [];
      return Array.isArray(valor) ? valor : [valor];
    })
    .superRefine((valores, ctx) => {
      for (const valor of valores) {
        const resultado = validarTexto(valor, {
          max: maximoPorItem,
          etiqueta,
          obligatorio: false,
        });

        if (!resultado.valido) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
          return;
        }
      }
    })
    .transform((valores) => valores.map((valor) => valor.trim()).filter(Boolean));
}

const booleanoSchema = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((valor) => valor === true || valor === 'true');

export const crearPublicacionSchema = z.object({
  mascotaId: idSchema('La mascota'),
  descripcion: textoSchema({
    max: LIMITES.publicacion.descripcion.max,
    etiqueta: 'La descripción',
  }),
  ubicacion: textoSchema({
    max: LIMITES.publicacion.ubicacion.max,
    etiqueta: 'La ubicación',
  }),
  requisitos: listaSchema(LIMITES.publicacion.requisito.max, 'Cada requisito'),
  personalidad: listaSchema(LIMITES.publicacion.personalidad.max, 'Cada rasgo'),
  desparasitado: booleanoSchema,
  vacunas: textoOpcionalSchema({
    max: LIMITES.publicacion.vacunas.max,
    etiqueta: 'Las vacunas',
  }),
});

export type CrearPublicacionDto = z.infer<typeof crearPublicacionSchema>;

/** Tamaño de página del feed y tope duro, para que un cliente no pida la tabla entera. */
export const FEED_LIMITE_POR_DEFECTO = 20;
export const FEED_LIMITE_MAXIMO = 50;

/**
 * Rasgos canónicos de `personalidad` con los que se resuelven los filtros de compatibilidad.
 * El modelo no tiene columnas para esto: la compatibilidad se declara al publicar eligiendo
 * el rasgo, así que los strings tienen que coincidir exactamente con los que ofrece el
 * formulario de crear publicación en la app.
 */
export const RASGO_COMPATIBLE_NINIOS = 'Bueno con chicos';
export const RASGO_COMPATIBLE_OTRAS_MASCOTAS = 'Bueno con otras mascotas';

/** En query string todo llega como texto; sólo `'true'` activa el filtro. */
const banderaSchema = z
  .string()
  .optional()
  .transform((valor) => valor === 'true');

const enteroOpcionalSchema = (etiqueta: string) =>
  z.coerce.number().int(`${etiqueta} no es válido`).min(0, `${etiqueta} no es válido`).optional();

export const filtrosFeedSchema = z.object({
  especieId: z.coerce.number().int().positive('La especie no es válida').optional(),
  tamanio: z.enum(['PEQUENO', 'MEDIANO', 'GRANDE']).optional(),
  genero: z.enum(['MACHO', 'HEMBRA']).optional(),
  /** Años cumplidos, inclusivo. */
  edadMin: enteroOpcionalSchema('La edad mínima'),
  /** Años cumplidos, exclusivo: el rango "1–3 años" es `edadMin=1&edadMax=3`. */
  edadMax: enteroOpcionalSchema('La edad máxima'),
  castrado: banderaSchema,
  compatibleNinios: banderaSchema,
  compatibleOtrasMascotas: banderaSchema,
  limite: z.coerce
    .number()
    .int()
    .positive()
    .max(FEED_LIMITE_MAXIMO)
    .optional()
    .default(FEED_LIMITE_POR_DEFECTO),
  desplazamiento: z.coerce.number().int().min(0).optional().default(0),
});

export type FiltrosFeedDto = z.infer<typeof filtrosFeedSchema>;

/** Mascota tal como la necesitan la tarjeta del feed y la ficha completa. */
export interface MascotaPublicadaDto {
  id: number;
  nombre: string | null;
  /** `AAAA-MM-DD` o null. La edad se calcula en el cliente. */
  fechaNacimiento: string | null;
  genero: 'MACHO' | 'HEMBRA';
  tamanio: 'PEQUENO' | 'MEDIANO' | 'GRANDE' | null;
  peso: number | null;
  castrado: boolean;
  descripcion: string | null;
  imagenUrl: string | null;
  especie: { id: number; nombre: string };
  raza: { id: number; nombre: string };
  estado: { id: number; nombre: string };
}

export interface PublicacionFeedDto {
  id: number;
  titulo: string;
  descripcion: string | null;
  ubicacion: string | null;
  requisitos: string[];
  personalidad: string[];
  desparasitado: boolean;
  vacunas: string | null;
  /** En orden; la primera es la portada. Rutas relativas al origen de la API. */
  imagenes: string[];
  fechaPublicacion: string;
  mascota: MascotaPublicadaDto;
  /** Null cuando publica un adoptante particular y no un refugio. */
  refugio: { id: number; nombre: string; direccion: string } | null;
  /** Si el usuario que consulta ya la tiene guardada. */
  enFavoritos: boolean;
}

export interface FeedPublicacionesDto {
  /** Total que matchea los filtros, no el largo de esta página. */
  total: number;
  publicaciones: PublicacionFeedDto[];
}

export interface PublicacionCreadaDto {
  id: number;
  titulo: string;
  descripcion: string | null;
  ubicacion: string | null;
  requisitos: string[];
  personalidad: string[];
  desparasitado: boolean;
  vacunas: string | null;
  imagenes: string[];
  mascotaId: number;
  usuarioId: number;
}
