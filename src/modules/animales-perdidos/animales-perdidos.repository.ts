import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta } from '../../shared/auditoria';
import { finDelDia, inicioDelDia } from '../../shared/validation/dates';

/** Lo que pinta una tarjeta del portal, en una sola query y sin N+1. */
const SELECCION_TARJETA = {
  id: true,
  nombre: true,
  descripcion: true,
  imagenUrl: true,
  imagenes: true,
  ubicacion: true,
  fechaSuceso: true,
  fechaAlta: true,
  fechaResuelto: true,
  usuarioReportanteId: true,
  estadoAnimalPerdido: { select: { id: true, nombre: true } },
  especie: { select: { id: true, nombre: true } },
  usuarioReportante: { select: { id: true, nombre: true, apellido: true, imagenUrl: true } },
} satisfies Prisma.AnimalPerdidoSelect;

export type AvisoConRelaciones = Prisma.AnimalPerdidoGetPayload<{
  select: typeof SELECCION_TARJETA;
}>;

export interface FiltrosListado {
  fechaDesde?: Date;
  fechaHasta?: Date;
  estados: number[];
  especies: number[];
  ubicaciones: string[];
}

/**
 * Traduce los filtros a un `where`. Cada filtro vacío es "sin filtro", y todos se combinan
 * con AND entre sí (dentro de cada uno, las opciones elegidas van con OR).
 *
 * Incluye avisos en CUALQUIER estado, "Resuelto" también: la HU los quiere en el portal.
 * Sólo se excluyen los dados de baja.
 */
function whereDelListado(filtros: FiltrosListado): Prisma.AnimalPerdidoWhereInput {
  const { fechaDesde, fechaHasta, estados, especies, ubicaciones } = filtros;

  return {
    fechaBaja: null,
    ...(fechaDesde
      ? {
          fechaAlta: {
            gte: inicioDelDia(fechaDesde),
            ...(fechaHasta ? { lte: finDelDia(fechaHasta) } : {}),
          },
        }
      : {}),
    ...(estados.length > 0 ? { estadoAnimalPerdidoId: { in: estados } } : {}),
    ...(especies.length > 0 ? { especieId: { in: especies } } : {}),
    // Texto libre: igualdad sin distinguir mayúsculas, para que "maipú" encuentre "Maipú".
    ...(ubicaciones.length > 0
      ? {
          OR: ubicaciones.map((ubicacion) => ({
            ubicacion: { equals: ubicacion, mode: 'insensitive' as const },
          })),
        }
      : {}),
  };
}

/**
 * Una página del portal, del aviso más reciente al más viejo.
 *
 * El orden lleva el id como desempate: dos avisos del mismo instante tienen que salir siempre
 * en el mismo orden, o el cursor los repetiría o los saltearía entre páginas. Lo sostiene el
 * índice parcial `animal_perdido_listado_idx`.
 *
 * Se piden `limite + 1` filas para saber si quedan más sin una segunda query de conteo (mismo
 * criterio que el historial del chat). `skip: 1` sobre el cursor porque ese aviso es el último
 * que el cliente YA tiene.
 */
export function listar(filtros: FiltrosListado, limite: number, cursor?: number) {
  return prisma.animalPerdido.findMany({
    where: whereDelListado(filtros),
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    select: SELECCION_TARJETA,
  });
}

/**
 * ¿Existe el aviso del cursor? Con un id inexistente Prisma devuelve una página vacía sin
 * avisar, y el cliente creería que llegó al final. Vale aunque el aviso se haya dado de baja
 * mientras tanto: la posición en el orden sigue existiendo.
 */
export function existeAviso(id: number) {
  return prisma.animalPerdido.findUnique({ where: { id }, select: { id: true } });
}

/**
 * Ubicaciones distintas de los avisos visibles, para armar las opciones del filtro. El
 * agrupado sin distinguir mayúsculas lo hace el servicio: Prisma no sabe agrupar por
 * `lower(...)` sin SQL a mano, y la cantidad de ubicaciones distintas es chica.
 */
export function listarUbicaciones() {
  return prisma.animalPerdido.findMany({
    where: { fechaBaja: null, ubicacion: { not: null } },
    distinct: ['ubicacion'],
    select: { ubicacion: true },
  });
}

export function buscarUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: { id: true },
  });
}

export function buscarEstado(estadoId: number) {
  return prisma.estadoAnimalPerdido.findFirst({
    where: { id: estadoId, fechaBaja: null },
    select: { id: true, nombre: true },
  });
}

export function buscarEspecie(especieId: number) {
  return prisma.especie.findFirst({
    where: { id: especieId, fechaBaja: null },
    select: { id: true },
  });
}

/** `imagenes` llega con al menos una: la primera queda también como portada en `imagenUrl`. */
export function crear(
  datos: {
    nombre: string | null;
    descripcion: string;
    imagenes: string[];
    ubicacion: string;
    fechaSuceso: Date;
    latitud: number;
    longitud: number;
    especieId: number;
    estadoAnimalPerdidoId: number;
  },
  usuarioId: number,
) {
  return prisma.animalPerdido.create({
    data: {
      ...datos,
      imagenUrl: datos.imagenes[0]!,
      usuarioReportanteId: usuarioId,
      ...datosAlta(usuarioId),
    },
    select: SELECCION_TARJETA,
  });
}
