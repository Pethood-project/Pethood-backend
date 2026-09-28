import { z } from 'zod';
import type { VacunaAplicadaDto } from '../../shared/vacunas';
import { LIMITES } from '../../shared/validation/limits';
import { idSchema, listaDeIdsSchema, textoSchema } from '../../shared/validation/schemas';
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

/**
 * Lo que se carga al publicar y se puede editar después, con las mismas reglas en los dos
 * casos. La mascota queda afuera: se elige al crear y no se cambia.
 */
const camposEditables = {
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
};

export const crearPublicacionSchema = z.object({
  mascotaId: idSchema('La mascota'),
  ...camposEditables,
});

export type CrearPublicacionDto = z.infer<typeof crearPublicacionSchema>;

/**
 * En `imagenes` de la edición, el lugar que ocupa cada foto nueva: la primera marca es el
 * primer archivo de `fotos`, la segunda el segundo, y así.
 */
export const MARCADOR_FOTO_NUEVA = 'nueva';

/**
 * Edición de una publicación: reemplaza todos los datos editables (el formulario manda el
 * aviso entero, igual que al crearlo). Una lista que no viaja queda vacía, como al crear.
 *
 * `imagenes` es la galería final en orden: cada ítem es una foto que la publicación ya
 * tenía (su URL, tal como la devolvió la API) o `MARCADOR_FOTO_NUEVA` en el lugar de una
 * de las fotos nuevas. Sin ninguna, hereda la foto de la mascota, como al crear.
 */
export const editarPublicacionSchema = z.object({
  ...camposEditables,
  imagenes: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((valor) => {
      if (valor === undefined) return [];
      return Array.isArray(valor) ? valor : [valor];
    })
    .refine((valores) => valores.length <= MAXIMO_IMAGENES, {
      message: `Podés subir hasta ${MAXIMO_IMAGENES} fotos`,
    }),
});

export type EditarPublicacionDto = z.infer<typeof editarPublicacionSchema>;

/**
 * Cambios de estado manuales:
 * - PAUSAR: Activa → Pausada.
 * - REACTIVAR: Pausada → Activa.
 * - FINALIZAR: Activa o Pausada → Finalizada (terminal).
 */
export const ACCIONES_ESTADO_PUBLICACION = ['PAUSAR', 'REACTIVAR', 'FINALIZAR'] as const;
export type AccionEstadoPublicacion = (typeof ACCIONES_ESTADO_PUBLICACION)[number];

export const cambiarEstadoPublicacionSchema = z.object({
  accion: z.enum(ACCIONES_ESTADO_PUBLICACION, {
    errorMap: () => ({ message: 'La acción no es válida' }),
  }),
});

export type CambiarEstadoPublicacionDto = z.infer<typeof cambiarEstadoPublicacionSchema>;

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
  /**
   * Medallas de la mascota: salen de su historia clínica, no se cargan en la publicación
   * (spec 019).
   */
  vacunas: VacunaAplicadaDto[];
  /** En orden; la primera es la portada. Rutas relativas al origen de la API. */
  imagenes: string[];
  fechaPublicacion: string;
  /** Estado del aviso (no el de la mascota). Ver `ESTADO_PUBLICACION`. */
  estado: EstadoPublicacionDto;
  mascota: MascotaPublicadaDto;
  /** Null cuando publica un adoptante particular y no un refugio. */
  refugio: { id: number; nombre: string; direccion: string } | null;
  /**
   * La persona que la publicó, solo cuando no es de un refugio (`refugio` null): la ficha la
   * muestra en «Publicado por». En una de refugio es null, para no exponer a su personal.
   */
  publicadoPor: { nombre: string; apellido: string } | null;
  /** Si el usuario que consulta ya la tiene guardada. */
  enFavoritos: boolean;
  /**
   * Si la mascota es del usuario que consulta (o de su mismo refugio). El feed nunca la
   * devuelve en `true` porque ya excluye esas publicaciones; la ficha (`GET /:id`) sí puede,
   * para que el frontend oculte "Solicitar adopción" y el corazón de favoritos sobre la
   * propia mascota.
   */
  esPropia: boolean;
  /**
   * Si el usuario la puede editar y cambiar de estado desde el perfil activo: quien la
   * publicó (perfil personal) o cualquier miembro del refugio dueño (perfil de refugio).
   * Siempre `false` en el feed.
   */
  puedeEditar: boolean;
}

export interface FeedPublicacionesDto {
  /** Total que matchea los filtros, no el largo de esta página. */
  total: number;
  publicaciones: PublicacionFeedDto[];
}

/**
 * Nombres del catálogo `Estado_Publicacion` — el estado del AVISO, no el de la mascota.
 * - Activa: se ve en el feed y se puede solicitar.
 * - Pausada: sigue viva pero no aparece en el feed (la pausó quien la gestiona, o la mascota
 *   pasó a tratamiento o tránsito).
 * - Finalizada: el aviso quedó cerrado para siempre (lo finalizó quien la gestiona, o la
 *   mascota fue adoptada o falleció). La mascota se puede volver a publicar en otro aviso.
 *
 * Las transiciones manuales son `ACCIONES_ESTADO_PUBLICACION`; las automáticas siguen al
 * estado de la mascota (`sincronizarConEstadoMascota` en el servicio) y solo pausan o
 * finalizan: reactivar es siempre a mano.
 */
export const ESTADO_PUBLICACION = {
  ACTIVA: 'Activa',
  PAUSADA: 'Pausada',
  FINALIZADA: 'Finalizada',
} as const;
export type NombreEstadoPublicacion = (typeof ESTADO_PUBLICACION)[keyof typeof ESTADO_PUBLICACION];

/** Estado vigente de una publicación, con la misma forma que el de la mascota. */
export interface EstadoPublicacionDto {
  id: number;
  nombre: string;
}

/**
 * Filtro de "Mis publicaciones": `?estados=1,3` (ids de `Estado_Publicacion`). Sin el
 * parámetro, o vacío, trae todas.
 */
export const filtrosMisPublicacionesSchema = z.object({
  estados: listaDeIdsSchema('El estado de publicación'),
});

export type FiltrosMisPublicacionesDto = z.infer<typeof filtrosMisPublicacionesSchema>;

/** Tarjeta de "Mis publicaciones": lo mínimo para la grilla, la ficha se pide aparte. */
export interface PublicacionPropiaDto {
  id: number;
  /** Portada: la primera foto de la publicación, o la de la mascota si no subió propias. */
  imagenUrl: string | null;
  fechaPublicacion: string;
  estado: EstadoPublicacionDto;
  mascota: {
    id: number;
    nombre: string | null;
    /** `AAAA-MM-DD` o null. La edad se calcula en el cliente. */
    fechaNacimiento: string | null;
    especie: { id: number; nombre: string };
  };
}

export interface PublicacionCreadaDto {
  id: number;
  titulo: string;
  descripcion: string | null;
  ubicacion: string | null;
  requisitos: string[];
  personalidad: string[];
  desparasitado: boolean;
  imagenes: string[];
  mascotaId: number;
  usuarioId: number;
}
