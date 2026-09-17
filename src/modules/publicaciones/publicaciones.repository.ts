import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta } from '../../shared/auditoria';
import { restarAnios } from '../../shared/validation/dates';
import {
  RASGO_COMPATIBLE_NINIOS,
  RASGO_COMPATIBLE_OTRAS_MASCOTAS,
  type FiltrosFeedDto,
} from './publicaciones.dto';

export interface DatosNuevaPublicacion {
  titulo: string;
  descripcion: string;
  ubicacion: string;
  requisitos: string[];
  personalidad: string[];
  desparasitado: boolean;
  vacunas: string | null;
  /** En orden: la primera es la portada. */
  imagenes: string[];
  mascotaId: number;
  usuarioId: number;
}

export function crear(datos: DatosNuevaPublicacion, usuarioAlta: number) {
  const { imagenes, ...resto } = datos;

  return prisma.publicacion.create({
    // imagenUrl se mantiene con la portada, para lo que ya lee ese campo.
    data: { ...resto, imagenes, imagenUrl: imagenes[0] ?? null, ...datosAlta(usuarioAlta) },
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

export function contarActivasDeUsuario(usuarioId: number) {
  return prisma.publicacion.count({ where: { usuarioId, fechaBaja: null } });
}

export function buscarActivaDeMascota(mascotaId: number) {
  return prisma.publicacion.findFirst({ where: { mascotaId, fechaBaja: null } });
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
  mascota: {
    include: {
      raza: { include: { especie: true } },
      refugio: { select: { id: true, nombre: true, direccion: true } },
      historicoEstados: {
        where: { fechaBaja: null },
        include: { estadoMascota: true },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
    },
  },
} as const;

/**
 * Publicaciones que le corresponde ver a este usuario, ya filtradas.
 *
 * Se excluyen las mascotas propias y las que ya guardó en favoritos: sobre unas y otras no
 * habría nada que decidir — `agregarFavorito` rechaza las propias con 403 y las guardadas
 * ya son un sí.
 *
 * El estado vigente se filtra con `some` en vez de mirar la última fila del histórico
 * porque tiene que resolverse en SQL: si se descartara en memoria, `total` y la
 * paginación contarían filas que la página no muestra. Es equivalente mientras se
 * mantenga la invariante de una sola fila activa por mascota, que es como escribe el
 * resto del backend.
 */
function condicionesFeed(usuarioId: number, filtros: FiltrosFeedDto): Prisma.PublicacionWhereInput {
  const mascota: Prisma.MascotaWhereInput = {
    fechaBaja: null,
    usuarioId: { not: usuarioId },
    favoritos: { none: { usuarioId, fechaBaja: null } },
    historicoEstados: {
      some: { fechaBaja: null, estadoMascota: { nombre: ESTADO_VISIBLE_EN_FEED } },
    },
  };

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

  const where: Prisma.PublicacionWhereInput = { fechaBaja: null, mascota };
  const rasgos: string[] = [];

  if (filtros.compatibleNinios) rasgos.push(RASGO_COMPATIBLE_NINIOS);
  if (filtros.compatibleOtrasMascotas) rasgos.push(RASGO_COMPATIBLE_OTRAS_MASCOTAS);
  if (rasgos.length > 0) where.personalidad = { hasEvery: rasgos };

  return where;
}

/**
 * Una página del feed. El orden es por fecha de publicación descendente: no hay algoritmo
 * de recomendación definido todavía, y lo más nuevo primero es determinístico, así que la
 * paginación no repite ni saltea tarjetas entre páginas.
 */
export function listarFeed(usuarioId: number, filtros: FiltrosFeedDto) {
  return prisma.publicacion.findMany({
    where: condicionesFeed(usuarioId, filtros),
    include: RELACIONES_FEED,
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    skip: filtros.desplazamiento,
    take: filtros.limite,
  });
}

/** Total que matchea los filtros, para saber si quedan páginas por traer. */
export function contarFeed(usuarioId: number, filtros: FiltrosFeedDto) {
  return prisma.publicacion.count({ where: condicionesFeed(usuarioId, filtros) });
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

/** Ids que el usuario ya tiene guardados, para marcar el corazón en la ficha. */
export async function filtrarFavoritas(usuarioId: number, mascotaIds: number[]) {
  if (mascotaIds.length === 0) return new Set<number>();

  const favoritos = await prisma.favorito.findMany({
    where: { usuarioId, fechaBaja: null, mascotaId: { in: mascotaIds } },
    select: { mascotaId: true },
  });

  return new Set(favoritos.map((favorito) => favorito.mascotaId));
}
