import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';
import { distanciaKm, resolverCoordenadasDeMapsUrl } from '../../shared/geo';
import { restarAnios, finDelDia } from '../../shared/validation/dates';
import {
  ESTADO_PUBLICACION,
  RASGO_COMPATIBLE_NINIOS,
  RASGO_COMPATIBLE_OTRAS_MASCOTAS,
  type FiltrosFeedDto,
} from './publicaciones.dto';

export interface DatosNuevaPublicacion {
  titulo: string;
  descripcion: string;
  ubicacion: string;
  /** Coordenadas opcionales del lugar (Módulo 11). */
  latitud: number | null;
  longitud: number | null;
  requisitos: string[];
  personalidad: string[];
  desparasitado: boolean;
  /** En orden: la primera es la portada. */
  imagenes: string[];
  mascotaId: number;
  usuarioId: number;
  /** Estado con el que nace, en el mismo alta (una publicación nunca queda sin estado). */
  estadoPublicacionId: number;
}

/**
 * Alta de una publicación. En la misma transacción da de baja (lógica) los avisos
 * finalizados anteriores de la misma mascota: publicarla de nuevo reemplaza al viejo, que
 * deja de aparecer en «Mis publicaciones». Sus solicitudes quedan como historial.
 *
 * Devuelve la publicación nueva y los ids de las finalizadas que retiró, para la auditoría.
 */
export function crear(datos: DatosNuevaPublicacion, usuarioAlta: number) {
  const { imagenes, estadoPublicacionId, ...resto } = datos;

  return prisma.$transaction(async (tx) => {
    const finalizadas = await tx.publicacion.findMany({
      where: {
        mascotaId: datos.mascotaId,
        fechaBaja: null,
        historicoEstados: conEstadoVigente({ nombre: ESTADO_PUBLICACION.FINALIZADA }),
      },
      select: { id: true },
    });
    const retiradas = finalizadas.map((publicacion) => publicacion.id);

    if (retiradas.length > 0) {
      await tx.publicacion.updateMany({
        where: { id: { in: retiradas } },
        data: datosBaja(usuarioAlta),
      });
    }

    const publicacion = await tx.publicacion.create({
      data: {
        ...resto,
        imagenes,
        // imagenUrl se mantiene con la portada, para lo que ya lee ese campo.
        imagenUrl: imagenes[0] ?? null,
        ...datosAlta(usuarioAlta),
        historicoEstados: { create: { estadoPublicacionId, ...datosAlta(usuarioAlta) } },
      },
    });

    return { publicacion, retiradas };
  });
}

export function buscarEstadoPublicacionPorNombre(nombre: string) {
  return prisma.estadoPublicacion.findFirst({ where: { nombre, fechaBaja: null } });
}

/** Filtro de "estado vigente" sobre el histórico. Ver la nota de `some` en `condicionesFeed`. */
function conEstadoVigente(
  estado: Prisma.EstadoPublicacionWhereInput,
): Prisma.PublicacionEstadoListRelationFilter {
  return { some: { fechaBaja: null, estadoPublicacion: estado } };
}

/**
 * Cambia el estado vigente de una publicación: baja de la fila actual y alta de la nueva, en
 * una transacción, para no romper la invariante de una sola fila vigente (que además
 * garantiza el índice parcial `publicacion_estado_activo_uq`).
 */
export function cambiarEstado(
  publicacionId: number,
  estadoPublicacionId: number,
  usuarioId: number,
) {
  return prisma.$transaction(async (tx) => {
    await tx.publicacionEstado.updateMany({
      where: { publicacionId, fechaBaja: null },
      data: datosBaja(usuarioId),
    });

    await tx.publicacionEstado.create({
      data: { publicacionId, estadoPublicacionId, ...datosAlta(usuarioId) },
    });
  });
}

/** Mascota activa con su estado vigente, para validar que se pueda publicar. */
export function buscarMascota(mascotaId: number) {
  return prisma.mascota.findFirst({
    where: { id: mascotaId, fechaBaja: null },
    include: {
      historicoEstados: {
        where: { fechaBaja: null },
        include: { estadoMascota: true },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
    },
  });
}

/**
 * Solo las personales: la quota anti-spam es del adoptante particular, no del refugio. Y solo
 * las que están en estado "Activa": una pausada no se ve en el feed y una finalizada ya
 * cumplió su ciclo, así que ninguna de las dos es spam ni debería trabar una nueva.
 */
export function contarActivasPersonalesDeUsuario(usuarioId: number) {
  return prisma.publicacion.count({
    where: {
      usuarioId,
      fechaBaja: null,
      mascota: { refugioId: null },
      historicoEstados: conEstadoVigente({ nombre: ESTADO_PUBLICACION.ACTIVA }),
    },
  });
}

/** Estado vigente de la publicación, para las transiciones. */
const ESTADO_VIGENTE = {
  where: { fechaBaja: null },
  include: { estadoPublicacion: true },
  orderBy: { fechaAlta: 'desc' },
  take: 1,
} as const;

/**
 * Publicación en curso (Activa o Pausada) de una mascota: a lo sumo hay una. Las
 * finalizadas no cuentan: son avisos cerrados, y la mascota se puede volver a publicar.
 * Trae el estado vigente para la sincronización automática.
 */
export function buscarEnCursoDeMascota(mascotaId: number) {
  return prisma.publicacion.findFirst({
    where: {
      mascotaId,
      fechaBaja: null,
      historicoEstados: conEstadoVigente({ nombre: { not: ESTADO_PUBLICACION.FINALIZADA } }),
    },
    include: { historicoEstados: ESTADO_VIGENTE },
    orderBy: { fechaAlta: 'desc' },
  });
}

/**
 * La publicación viva (sin baja) más reciente de una mascota, en el estado que esté: la en
 * curso si tiene una y, si no, el último aviso finalizado.
 */
export function buscarUltimaDeMascota(mascotaId: number) {
  return prisma.publicacion.findFirst({
    where: { mascotaId, fechaBaja: null },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });
}

export interface DatosEdicionPublicacion {
  descripcion: string;
  ubicacion: string;
  /** Coordenadas opcionales del lugar (Módulo 11). */
  latitud: number | null;
  longitud: number | null;
  requisitos: string[];
  personalidad: string[];
  desparasitado: boolean;
  /** En orden: la primera es la portada. */
  imagenes: string[];
}

export function actualizar(
  publicacionId: number,
  datos: DatosEdicionPublicacion,
  usuarioModificacion: number,
) {
  return prisma.publicacion.update({
    where: { id: publicacionId },
    data: {
      ...datos,
      // Mismo par que en el alta: imagenUrl acompaña a la portada.
      imagenUrl: datos.imagenes[0] ?? null,
      ...datosModificacion(usuarioModificacion),
    },
  });
}

export function buscarUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({ where: { id: usuarioId, fechaBaja: null } });
}

/**
 * Único estado con el que una mascota entra al feed de adopción. Es más restrictivo que
 * `ESTADOS_QUE_HABILITAN_PUBLICACION`: una mascota "En_Transito" ya tiene hogar temporal
 * asignado y no corresponde ofrecerla para adoptar.
 */
const ESTADO_VISIBLE_EN_FEED = 'Disponible';

/** Todo lo que hace falta para pintar la tarjeta y la ficha completa. */
const RELACIONES_FEED = {
  historicoEstados: ESTADO_VIGENTE,
  // Quién la publicó, para el «Publicado por» de la ficha cuando no es de un refugio.
  usuario: { select: { id: true, nombre: true, apellido: true, imagenUrl: true } },
  mascota: {
    include: {
      raza: { include: { especie: true } },
      refugio: {
        select: {
          id: true,
          nombre: true,
          provincia: true,
          localidad: true,
          calleAltura: true,
          mapaUrl: true,
        },
      },
      historicoEstados: {
        where: { fechaBaja: null },
        include: { estadoMascota: true },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
      // Las vacunas vigentes de la mascota, para las medallas de la ficha (spec 019).
      historiaClinica: {
        where: { fechaBaja: null, tipoVacuna: { not: null } },
        select: { tipoVacuna: true, fechaVisita: true },
      },
    },
  },
} as const;

/**
 * Publicaciones que le corresponde ver a este usuario, ya filtradas.
 *
 * Se excluyen las mascotas propias y las que ya guardó en favoritos: sobre unas y otras no
 * habría nada que decidir — `agregarFavorito` rechaza las propias con 403 y las guardadas
 * ya son un sí. Propias son las que cargó el usuario y las de su refugio
 * (`actorRefugioId`): el feed solo se ve desde el perfil personal, y ahí lo del refugio no
 * se muestra. Mismo criterio que `esMascotaPropia` en `shared/ambito.ts`, expresado en SQL:
 * excluir "usuarioId = mío" Y excluir "refugioId = el mío" son dos condiciones en AND, que
 * por De Morgan equivalen a excluir la unión de las dos.
 *
 * El estado vigente se filtra con `some` en vez de mirar la última fila del histórico
 * porque tiene que resolverse en SQL: si se descartara en memoria, `total` y la
 * paginación contarían filas que la página no muestra. Es equivalente mientras se
 * mantenga la invariante de una sola fila activa por mascota, que es como escribe el
 * resto del backend.
 */
/**
 * Ids de publicaciones vivas cuyo texto libre (HU-11.4) matchea parcialmente el título, la
 * descripción, el nombre de la mascota o algún rasgo de personalidad. Se resuelve con SQL
 * crudo porque el match parcial sobre un `text[]` (`unnest` + `ILIKE`) no se puede expresar
 * con el query builder de Prisma.
 */
async function idsPorTexto(texto: string): Promise<number[]> {
  const patron = `%${texto}%`;
  const filas = await prisma.$queryRaw<{ id: number }[]>`
    SELECT p.publicacion_id AS id
    FROM publicacion p
    JOIN mascota m ON m.mascota_id = p.mascota_id
    WHERE p.publicacion_fecha_baja IS NULL
      AND (
        p.publicacion_titulo ILIKE ${patron}
        OR COALESCE(p.publicacion_descripcion, '') ILIKE ${patron}
        OR COALESCE(m.mascota_nombre, '') ILIKE ${patron}
        OR EXISTS (
          SELECT 1 FROM unnest(p.publicacion_personalidad) AS rasgo WHERE rasgo ILIKE ${patron}
        )
      )
  `;
  return filas.map((fila) => fila.id);
}

/**
 * Ids de publicaciones cuya coordenada capturada al publicar cae dentro del radio (km),
 * con la fórmula del semiverseno (Haversine). El `LEAST/GREATEST` evita que un error de
 * punto flotante saque al `acos` de su dominio.
 */
async function idsPublicacionCerca(lat: number, lng: number, radioKm: number): Promise<number[]> {
  const filas = await prisma.$queryRaw<{ id: number }[]>`
    SELECT publicacion_id AS id
    FROM publicacion
    WHERE publicacion_fecha_baja IS NULL
      AND publicacion_ubicacion_latitud IS NOT NULL
      AND publicacion_ubicacion_longitud IS NOT NULL
      AND (
        6371 * acos(
          LEAST(1, GREATEST(-1,
            cos(radians(${lat})) * cos(radians(publicacion_ubicacion_latitud)) *
            cos(radians(publicacion_ubicacion_longitud) - radians(${lng})) +
            sin(radians(${lat})) * sin(radians(publicacion_ubicacion_latitud))
          ))
        )
      ) <= ${radioKm}
  `;
  return filas.map((fila) => fila.id);
}

/**
 * Ids de refugios dentro del radio, según las coordenadas extraídas de su enlace de Google
 * Maps (`refugio_mapa_url`). Se resuelve en memoria a propósito: la cantidad de refugios es
 * chica y así el parseo del link queda en una función pura testeable, no en SQL. Los links
 * cortos (`maps.app.goo.gl`) se resuelven siguiendo la redirección, con caché.
 *
 * Un refugio sin link, o con un link que no permite obtener coordenadas, simplemente no
 * entra en el filtro por distancia.
 */
async function refugiosEnRadio(lat: number, lng: number, radioKm: number): Promise<number[]> {
  const refugios = await prisma.refugio.findMany({
    where: { fechaBaja: null, mapaUrl: { not: null } },
    select: { id: true, mapaUrl: true },
  });

  const usuario = { latitud: lat, longitud: lng };

  const resultados = await Promise.all(
    refugios.map(async (refugio) => {
      const coordenadas = await resolverCoordenadasDeMapsUrl(refugio.mapaUrl);
      if (!coordenadas) return null;
      return distanciaKm(usuario, coordenadas) <= radioKm ? refugio.id : null;
    }),
  );

  return resultados.filter((id): id is number => id !== null);
}

/**
 * Publicaciones dentro del radio (HU-11.3): las que capturaron su propia coordenada cerca,
 * más las de refugios cuyo link de Maps apunta a una coordenada cercana.
 */
async function idsEnRadio(lat: number, lng: number, radioKm: number): Promise<number[]> {
  const porPublicacion = await idsPublicacionCerca(lat, lng, radioKm);
  const refugios = await refugiosEnRadio(lat, lng, radioKm);

  const porRefugio =
    refugios.length > 0
      ? (
          await prisma.publicacion.findMany({
            where: { fechaBaja: null, mascota: { refugioId: { in: refugios } } },
            select: { id: true },
          })
        ).map((fila) => fila.id)
      : [];

  return [...new Set([...porPublicacion, ...porRefugio])];
}

/** Intersección de varios conjuntos de ids: la fila tiene que estar en todos. */
function interseccionDe(listas: number[][]): number[] {
  return listas.reduce((acumuladas, lista) => {
    const conjunto = new Set(lista);
    return acumuladas.filter((id) => conjunto.has(id));
  });
}

function condicionesFeed(
  usuarioId: number,
  filtros: FiltrosFeedDto,
  actorRefugioId: number | null,
): Prisma.PublicacionWhereInput {
  const mascota: Prisma.MascotaWhereInput = {
    fechaBaja: null,
    usuarioId: { not: usuarioId },
    favoritos: { none: { usuarioId, fechaBaja: null } },
    historicoEstados: {
      some: { fechaBaja: null, estadoMascota: { nombre: ESTADO_VISIBLE_EN_FEED } },
    },
  };

  // Con OR explícito y no `{ not: ... }` a secas: en SQL `refugio_id <> X` es NULL para las
  // mascotas sin refugio, y las dejaría afuera a todas.
  if (actorRefugioId !== null) {
    mascota.OR = [{ refugioId: null }, { refugioId: { not: actorRefugioId } }];
  }

  if (filtros.especieId !== undefined) {
    mascota.raza = { especieId: filtros.especieId };
  }

  if (filtros.tamanio !== undefined) mascota.tamanio = filtros.tamanio;
  if (filtros.genero !== undefined) mascota.genero = filtros.genero;
  if (filtros.castrado) mascota.castrado = true;

  // Cuanto más chica la edad, más reciente el nacimiento: los extremos se invierten.
  // `edadMax` es exclusivo para que rangos contiguos (0–1, 1–3) no se pisen.
  if (filtros.edadMin !== undefined || filtros.edadMax !== undefined) {
    const nacimiento: Prisma.DateTimeFilter = {};

    if (filtros.edadMin !== undefined) nacimiento.lte = restarAnios(filtros.edadMin);
    if (filtros.edadMax !== undefined) nacimiento.gt = restarAnios(filtros.edadMax);

    // Sin fecha de nacimiento no se puede saber la edad: queda fuera del rango pedido.
    mascota.fechaNacimiento = nacimiento;
  }

  // Solo los avisos en estado "Activa". El filtro de la mascota "Disponible" se mantiene
  // igual: hoy van juntos (la publicación sigue al estado de la mascota), pero el día que se
  // pueda pausar a mano una publicación de una mascota disponible, lo que manda es el aviso.
  const where: Prisma.PublicacionWhereInput = {
    fechaBaja: null,
    mascota,
    historicoEstados: conEstadoVigente({ nombre: ESTADO_PUBLICACION.ACTIVA }),
  };
  const rasgos: string[] = [];

  if (filtros.compatibleNinios) rasgos.push(RASGO_COMPATIBLE_NINIOS);
  if (filtros.compatibleOtrasMascotas) rasgos.push(RASGO_COMPATIBLE_OTRAS_MASCOTAS);
  if (rasgos.length > 0) where.personalidad = { hasEvery: rasgos };

  // Rango de fecha de alta (HU-11.2), las dos puntas inclusive.
  if (filtros.fechaDesde || filtros.fechaHasta) {
    const rango: Prisma.DateTimeFilter = {};
    if (filtros.fechaDesde) rango.gte = filtros.fechaDesde;
    if (filtros.fechaHasta) rango.lte = finDelDia(filtros.fechaHasta);
    where.fechaAlta = rango;
  }

  return where;
}

/**
 * `condicionesFeed` + los filtros que necesitan SQL crudo (texto libre y cercanía). Los ids
 * de esos dos se calculan aparte y se intersecan, porque `where.id` es un único `in`.
 */
async function condicionesFeedCompletas(
  usuarioId: number,
  filtros: FiltrosFeedDto,
  actorRefugioId: number | null,
): Promise<Prisma.PublicacionWhereInput> {
  const where = condicionesFeed(usuarioId, filtros, actorRefugioId);
  const conjuntos: number[][] = [];

  if (filtros.texto) conjuntos.push(await idsPorTexto(filtros.texto));

  if (
    filtros.latitud !== undefined &&
    filtros.longitud !== undefined &&
    filtros.radioKm !== undefined
  ) {
    conjuntos.push(await idsEnRadio(filtros.latitud, filtros.longitud, filtros.radioKm));
  }

  if (conjuntos.length > 0) {
    where.id = { in: interseccionDe(conjuntos) };
  }

  return where;
}

/**
 * Una página del feed. El orden es por fecha de publicación descendente: no hay algoritmo
 * de recomendación definido todavía, y lo más nuevo primero es determinístico, así que la
 * paginación no repite ni saltea tarjetas entre páginas.
 */
export async function listarFeed(
  usuarioId: number,
  filtros: FiltrosFeedDto,
  actorRefugioId: number | null,
) {
  return prisma.publicacion.findMany({
    where: await condicionesFeedCompletas(usuarioId, filtros, actorRefugioId),
    include: RELACIONES_FEED,
    // HU-11.2: por defecto lo más nuevo primero; `antiguas` invierte el orden. El `id` como
    // desempate mantiene la paginación determinística entre páginas.
    orderBy:
      filtros.orden === 'antiguas'
        ? [{ fechaAlta: 'asc' as const }, { id: 'asc' as const }]
        : [{ fechaAlta: 'desc' as const }, { id: 'desc' as const }],
    skip: filtros.desplazamiento,
    take: filtros.limite,
  });
}

/** Total que matchea los filtros, para saber si quedan páginas por traer. */
export async function contarFeed(
  usuarioId: number,
  filtros: FiltrosFeedDto,
  actorRefugioId: number | null,
) {
  return prisma.publicacion.count({
    where: await condicionesFeedCompletas(usuarioId, filtros, actorRefugioId),
  });
}

/**
 * Detalle por id. No aplica los filtros del feed ni excluye favoritos ni mascotas propias:
 * si el usuario llegó al id, puede ver la ficha. Sí exige que la publicación siga activa.
 */
export function buscarActivaPorId(publicacionId: number) {
  return prisma.publicacion.findFirst({
    where: { id: publicacionId, fechaBaja: null, mascota: { fechaBaja: null } },
    include: RELACIONES_FEED,
  });
}

/**
 * Publicaciones vivas de un perfil ("Mis publicaciones"), la más nueva primero, en el estado
 * que estén (o solo en los de `estadoIds`, si se eligió alguno). Mismo
 * criterio de pertenencia que `mascotas.listarPorAmbito`:
 * - personales: las de mascotas que el usuario cargó a título propio (`refugioId` nulo).
 * - del refugio: las de cualquier mascota del refugio, la haya publicado quien la haya
 *   publicado. Por eso no lleva `usuarioId`.
 */
export function listarDeAmbito(
  ambito: { usuarioId: number } | { refugioId: number },
  estadoIds: number[] = [],
) {
  const mascota: Prisma.MascotaWhereInput =
    'refugioId' in ambito
      ? { refugioId: ambito.refugioId, fechaBaja: null }
      : { usuarioId: ambito.usuarioId, refugioId: null, fechaBaja: null };

  const where: Prisma.PublicacionWhereInput = { fechaBaja: null, mascota };

  // Sin estados elegidos no se filtra: es "ver todas".
  if (estadoIds.length > 0) where.historicoEstados = conEstadoVigente({ id: { in: estadoIds } });

  return prisma.publicacion.findMany({
    where,
    include: RELACIONES_FEED,
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
  });
}

/** Ids que el usuario ya tiene guardados, para marcar el corazón en la ficha. */
export async function filtrarFavoritas(usuarioId: number, mascotaIds: number[]) {
  if (mascotaIds.length === 0) return new Set<number>();

  const favoritos = await prisma.favorito.findMany({
    where: { usuarioId, fechaBaja: null, mascotaId: { in: mascotaIds } },
    select: { mascotaId: true },
  });

  return new Set(favoritos.map((favorito) => favorito.mascotaId));
}
