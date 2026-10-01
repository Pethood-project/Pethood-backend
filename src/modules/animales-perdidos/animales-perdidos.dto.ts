/**
 * Entrada y salida de los avisos de mascotas perdidas y encontradas (spec 020, HU-13.1). Las
 * reglas genéricas salen de `shared/validation`; acá sólo se compone lo propio del aviso.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import {
  coordenadaOpcionalSchema,
  coordenadaSchema,
  fechaFiltroSchema,
  fechaPasadaSchema,
  idSchema,
  limitePaginaSchema,
  listaDeIdsSchema,
  listaDeTextosSchema,
  textoOpcionalSchema,
  textoSchema,
  urlSchema,
} from '../../shared/validation/schemas';

const { animalPerdido } = LIMITES;

/**
 * Separa provincia y localidad en cada valor de `localidades` del portal. Ningún nombre del
 * catálogo de georef lo usa (la coma sí: "Tierra del Fuego, Antártida e Islas del Atlántico
 * Sur").
 */
export const SEPARADOR_LOCALIDAD = '|';

/** El lugar tal como lo carga el formulario: lo comparten el alta y el preview del mapa. */
const campo = {
  provincia: textoSchema({ max: animalPerdido.provincia.max, etiqueta: 'La provincia' }),
  localidad: textoSchema({ max: animalPerdido.localidad.max, etiqueta: 'La localidad' }),
  referencia: textoOpcionalSchema({
    max: animalPerdido.referencia.max,
    etiqueta: 'La referencia',
  }),
};

/**
 * Alta (multipart, las fotos viajan aparte en `fotos`, de 1 a 5 y en el orden de la galería).
 *
 * El nombre llega opcional porque su obligatoriedad depende del estado elegido ("Perdido" lo
 * exige, "Encontrado" no), y el estado se resuelve contra el catálogo en el servicio.
 *
 * El lugar sigue el criterio de la dirección del perfil (Módulo 11): provincia y localidad
 * del catálogo de georef del cliente, más una referencia libre y opcional. Como en el perfil,
 * el backend valida largo y obligatoriedad, no la pertenencia al catálogo.
 *
 * `lugarLatitud`/`lugarLongitud` son el punto del lugar que el usuario vio en el mapa antes de
 * publicar: el del preview o el del link que pegó a mano. Son opcionales: sin ellas, el lugar
 * se geocodifica en el alta.
 */
export const crearAvisoSchema = z
  .object({
    nombre: textoOpcionalSchema({ max: animalPerdido.nombre.max, etiqueta: 'El nombre' }),
    descripcion: textoSchema({ max: animalPerdido.descripcion.max, etiqueta: 'La descripción' }),
    ...campo,
    /** Día en que se perdió o se encontró. No puede ser futuro. */
    fechaSuceso: fechaPasadaSchema('La fecha'),
    estadoId: idSchema('El estado'),
    especieId: idSchema('La especie'),
    latitud: coordenadaSchema({ ...animalPerdido.latitud, etiqueta: 'La latitud' }),
    longitud: coordenadaSchema({ ...animalPerdido.longitud, etiqueta: 'La longitud' }),
    lugarLatitud: coordenadaOpcionalSchema('La ubicación del lugar', -90, 90),
    lugarLongitud: coordenadaOpcionalSchema('La ubicación del lugar', -180, 180),
  })
  .refine((datos) => (datos.lugarLatitud === undefined) === (datos.lugarLongitud === undefined), {
    message: 'La ubicación del lugar no es válida',
  });

export type CrearAvisoDto = z.infer<typeof crearAvisoSchema>;

/**
 * Preview del lugar en el mapa: lo geocodifica SIN publicar nada, para que el formulario
 * muestre el link de Google Maps y el usuario lo verifique, como la dirección del perfil.
 */
export const ubicarLugarSchema = z.object(campo);

export type UbicarLugarDto = z.infer<typeof ubicarLugarSchema>;

/** El link de Google Maps que el usuario pega a mano para corregir el lugar. */
export const leerLinkMapaSchema = z.object({
  mapaUrl: urlSchema('El link del mapa', animalPerdido.mapaUrl.max),
});

export type LeerLinkMapaDto = z.infer<typeof leerLinkMapaSchema>;

/** El lugar ubicado en el mapa: el link para verificarlo y el punto para mandar en el alta. */
export interface LugarEnMapaDto {
  mapaUrl: string;
  latitud: number;
  longitud: number;
}

export interface LocalidadDeFiltro {
  provincia: string;
  localidad: string;
}

/**
 * `localidades` del portal: cada valor es «provincia|localidad», porque el mismo nombre de
 * localidad existe en más de una provincia (hay unos 200 repetidos en el catálogo).
 */
const localidadesDeFiltroSchema = listaDeTextosSchema({
  max: animalPerdido.provincia.max + SEPARADOR_LOCALIDAD.length + animalPerdido.localidad.max,
  maximoElementos: animalPerdido.filtroLocalidades.maximo,
  etiqueta: 'La localidad',
}).transform((valores, ctx): LocalidadDeFiltro[] => {
  const pares: LocalidadDeFiltro[] = [];

  for (const valor of valores) {
    const partes = valor.split(SEPARADOR_LOCALIDAD).map((parte) => parte.trim());

    if (partes.length !== 2 || !partes[0] || !partes[1]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La localidad no es válida' });
      return z.NEVER;
    }

    pares.push({ provincia: partes[0], localidad: partes[1] });
  }

  return pares;
});

/**
 * Query del portal.
 *
 * - Paginación por cursor: `cursor` es el id del último aviso que el cliente ya tiene; ausente
 *   es la primera página.
 * - `estados` y `especies` son ids separados por coma, como el resto de los filtros de la API.
 * - `provincias` y `localidades` van un parámetro por valor, porque son texto y pueden tener
 *   coma. Cada localidad es «provincia|localidad» (`?localidades=Mendoza%7CMaip%C3%BA`): el
 *   mismo nombre existe en varias provincias.
 * - `latitud`/`longitud` son las del usuario que consulta. Con ellas cada aviso trae su
 *   distancia; con `radioKm` además se filtra por cercanía (HU-11.3, como en publicaciones).
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
    provincias: listaDeTextosSchema({
      max: animalPerdido.provincia.max,
      maximoElementos: animalPerdido.filtroProvincias.maximo,
      etiqueta: 'La provincia',
    }),
    localidades: localidadesDeFiltroSchema,
    latitud: coordenadaOpcionalSchema('La latitud', -90, 90),
    longitud: coordenadaOpcionalSchema('La longitud', -180, 180),
    radioKm: z.coerce
      .number({ invalid_type_error: 'El radio no es válido' })
      .min(animalPerdido.radioKm.min, 'El radio no es válido')
      .max(animalPerdido.radioKm.max, 'El radio no es válido')
      .optional(),
  })
  .refine((filtros) => !filtros.fechaHasta || filtros.fechaDesde, {
    message: 'Para filtrar por fecha, elegí la fecha "desde"',
  })
  .refine(
    (filtros) =>
      !filtros.fechaDesde || !filtros.fechaHasta || filtros.fechaDesde <= filtros.fechaHasta,
    { message: 'La fecha "desde" no puede ser posterior a "hasta"' },
  )
  .refine((filtros) => (filtros.latitud === undefined) === (filtros.longitud === undefined), {
    message: 'La ubicación no es válida',
  })
  .refine((filtros) => filtros.radioKm === undefined || filtros.latitud !== undefined, {
    message: 'Para filtrar por cercanía necesitamos tu ubicación',
  });

export type FiltrosAvisosDto = z.infer<typeof filtrosAvisosSchema>;

/**
 * Una tarjeta del portal (GUI-06): lo justo para pintarla, el popup de detalle y el futuro
 * botón de chat.
 *
 * Las coordenadas del dispositivo de quien reportó NUNCA viajan. La distancia y el link a
 * Google Maps salen sólo del lugar geocodificado.
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
  /**
   * El lugar listo para mostrar: «referencia, localidad - provincia», con el mismo formato que
   * la dirección del perfil. `null` sólo en avisos cargados antes de HU-13.1.
   */
  ubicacion: string | null;
  provincia: string | null;
  localidad: string | null;
  referencia: string | null;
  /**
   * Distancia en km (un decimal) entre el usuario y el lugar, si el pedido trajo `latitud` y
   * `longitud` y el lugar se pudo geocodificar. Si no, `null`.
   */
  distanciaKm: number | null;
  /**
   * Link a Google Maps del lugar: con las coordenadas geocodificadas o, si no las hay, buscando
   * el texto del lugar. `null` sólo si el aviso no tiene lugar.
   */
  mapaUrl: string | null;
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
  /**
   * Si el aviso es del usuario autenticado. Decide qué botón ofrece el detalle: con `false`,
   * "Enviar mensaje" (el reclamo, HU-13.2); con `true`, "Marcar como resuelto".
   */
  esPropio: boolean;
}

/**
 * Resultado de reclamar un aviso (HU-13.2): la sala de reencuentro, lista para abrir.
 *
 * Devuelve sólo el id y no la conversación entera porque el cliente navega a la sala y ésta
 * se pinta sola con `GET /chats/:chatId` — es el endpoint que existe justamente para eso
 * (abrir una sala sin haber pasado por el listado).
 *
 * `nueva` es `false` cuando la sala ya existía: el botón no se esconde después del primer
 * reclamo, así que volver a tocarlo es el caso normal y devuelve la misma sala.
 */
export interface ReclamoDto {
  chatId: number;
  nueva: boolean;
}

/** Opciones del filtro: cada provincia con avisos y sus localidades con avisos. */
export interface ProvinciaConLocalidadesDto {
  provincia: string;
  localidades: string[];
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
