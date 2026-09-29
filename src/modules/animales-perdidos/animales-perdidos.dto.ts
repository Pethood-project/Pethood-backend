/**
 * Entrada y salida de los avisos de mascotas perdidas y encontradas (spec 020, HU-13.1). Las
 * reglas genéricas salen de `shared/validation`; acá sólo se compone lo propio del aviso.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import {
  coordenadaSchema,
  fechaFiltroSchema,
  fechaPasadaSchema,
  idSchema,
  limitePaginaSchema,
  listaDeIdsSchema,
  listaDeTextosSchema,
  textoOpcionalSchema,
  textoSchema,
} from '../../shared/validation/schemas';

const { animalPerdido } = LIMITES;

/**
 * Alta (multipart, las fotos viajan aparte en `fotos`, de 1 a 5 y en el orden de la galería).
 *
 * El nombre llega opcional porque su obligatoriedad depende del estado elegido ("Perdido" lo
 * exige, "Encontrado" no), y el estado se resuelve contra el catálogo en el servicio.
 */
export const crearAvisoSchema = z.object({
  nombre: textoOpcionalSchema({ max: animalPerdido.nombre.max, etiqueta: 'El nombre' }),
  descripcion: textoSchema({ max: animalPerdido.descripcion.max, etiqueta: 'La descripción' }),
  ubicacion: textoSchema({ max: animalPerdido.ubicacion.max, etiqueta: 'La ubicación' }),
  /** Día en que se perdió o se encontró. No puede ser futuro. */
  fechaSuceso: fechaPasadaSchema('La fecha'),
  estadoId: idSchema('El estado'),
  especieId: idSchema('La especie'),
  latitud: coordenadaSchema({ ...animalPerdido.latitud, etiqueta: 'La latitud' }),
  longitud: coordenadaSchema({ ...animalPerdido.longitud, etiqueta: 'La longitud' }),
});

export type CrearAvisoDto = z.infer<typeof crearAvisoSchema>;

/**
 * Query del portal.
 *
 * - Paginación por cursor: `cursor` es el id del último aviso que el cliente ya tiene; ausente
 *   es la primera página.
 * - `estados` y `especies` son ids separados por coma, como el resto de los filtros de la API.
 * - `ubicaciones` es texto libre, así que va un parámetro por valor (una ubicación puede tener
 *   coma). Coincide sin distinguir mayúsculas.
 * - `fechaDesde`/`fechaHasta` filtran por la fecha de alta, inclusive en las dos puntas. La HU
 *   pide "desde" obligatoria para filtrar por fecha: un "hasta" suelto es un error.
 */
export const filtrosAvisosSchema = z
  .object({
    cursor: idSchema('El cursor').optional(),
    limite: limitePaginaSchema(animalPerdido.pagina),
    fechaDesde: fechaFiltroSchema('La fecha "desde"'),
    fechaHasta: fechaFiltroSchema('La fecha "hasta"'),
    estados: listaDeIdsSchema('El estado'),
    especies: listaDeIdsSchema('La especie'),
    ubicaciones: listaDeTextosSchema({
      max: animalPerdido.ubicacion.max,
      maximoElementos: animalPerdido.filtroUbicaciones.maximo,
      etiqueta: 'La ubicación',
    }),
  })
  .refine((filtros) => !filtros.fechaHasta || filtros.fechaDesde, {
    message: 'Para filtrar por fecha, elegí la fecha "desde"',
  })
  .refine(
    (filtros) =>
      !filtros.fechaDesde || !filtros.fechaHasta || filtros.fechaDesde <= filtros.fechaHasta,
    { message: 'La fecha "desde" no puede ser posterior a "hasta"' },
  );

export type FiltrosAvisosDto = z.infer<typeof filtrosAvisosSchema>;

/**
 * Una tarjeta del portal (GUI-06): lo justo para pintarla y para el futuro botón de chat.
 *
 * Las coordenadas NO viajan: son las del dispositivo de quien reportó, no las del animal, y
 * no hay mapa que las use.
 */
export interface AvisoDto {
  id: number;
  /** `null` en un aviso "Encontrado" sin nombre: el cliente muestra la especie en su lugar. */
  nombre: string | null;
  descripcion: string;
  /** La portada de la tarjeta: siempre es la primera de `imagenes`. */
  imagenUrl: string;
  /** De 1 a 5, en el orden de la galería del detalle. */
  imagenes: string[];
  /** Texto libre; `null` sólo en avisos cargados antes de HU-13.1. */
  ubicacion: string | null;
  estado: { id: number; nombre: string };
  /** `null` sólo en avisos cargados antes de HU-13.1. */
  especie: { id: number; nombre: string } | null;
  /**
   * Día en que se perdió o se encontró, `AAAA-MM-DD` (sin hora, como `fechaNacimiento` de
   * mascota). `null` sólo en avisos cargados antes de que existiera el campo.
   */
  fechaSuceso: string | null;
  /** Fecha de publicación del aviso: define el orden del portal. */
  fechaAlta: string;
  fechaResuelto: string | null;
  /** Quien publicó el aviso: es la contraparte del chat de reencuentro (HU-13.2). */
  reportante: { id: number; nombre: string; apellido: string; imagenUrl: string | null };
  /** Si el aviso es del usuario autenticado: con `true` la tarjeta no ofrece "Abrir chat". */
  esPropio: boolean;
}

/**
 * Una página del portal, del aviso más reciente al más viejo.
 *
 * No trae `total`: contarlo con los filtros aplicados es una segunda query que el portal no
 * necesita, porque el scroll sólo pregunta si hay más.
 */
export interface ListaAvisosDto {
  avisos: AvisoDto[];
  /** `true` si quedan avisos por pedir con `proximoCursor`. */
  hayMas: boolean;
  /** Id a mandar como `cursor` para la página siguiente. `null` si ya no hay más. */
  proximoCursor: number | null;
}
