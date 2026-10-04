import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';
import { finDelDia, inicioDelDia } from '../../shared/validation/dates';

/**
 * Lo que pinta una tarjeta del portal, en una sola query y sin N+1. Las coordenadas del
 * dispositivo NO están: nunca se exponen, y la distancia se calcula con las del lugar.
 */
const SELECCION_TARJETA = {
  id: true,
  nombre: true,
  descripcion: true,
  imagenUrl: true,
  imagenes: true,
  provincia: true,
  localidad: true,
  referencia: true,
  lugarLatitud: true,
  lugarLongitud: true,
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
  provincias: string[];
  /** Pares provincia-localidad: el mismo nombre de localidad existe en varias provincias. */
  localidades: { provincia: string; localidad: string }[];
  /** Ids dentro del radio de cercanía, ya calculados (`idsEnRadio`). Ausente = sin radio. */
  idsCercanos?: number[];
}

/**
 * Traduce los filtros a un `where`. Cada filtro vacío es "sin filtro", y todos se combinan
 * con AND entre sí (dentro de cada uno, las opciones elegidas van con OR).
 *
 * Incluye avisos en CUALQUIER estado, "Resuelto" también: la HU los quiere en el portal.
 * Sólo se excluyen los dados de baja.
 *
 * Provincia y localidad se comparan exactas: salen del catálogo de georef del cliente, no se
 * escriben a mano. Como el resto, van con AND: con provincias y localidades elegidas, sólo
 * entran esas localidades (el cliente no manda localidades de provincias que no eligió).
 */
function whereDelListado(filtros: FiltrosListado): Prisma.AnimalPerdidoWhereInput {
  const { fechaDesde, fechaHasta, estados, especies, provincias, localidades, idsCercanos } =
    filtros;

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
    ...(provincias.length > 0 ? { provincia: { in: provincias } } : {}),
    ...(localidades.length > 0
      ? { OR: localidades.map(({ provincia, localidad }) => ({ provincia, localidad })) }
      : {}),
    ...(idsCercanos ? { id: { in: idsCercanos } } : {}),
  };
}

/**
 * Ids de los avisos visibles dentro del radio (km) de un punto, con la fórmula del semiverseno
 * (Haversine), igual que el filtro por cercanía de publicaciones (HU-11.3).
 *
 * Se mide contra el LUGAR geocodificado y, si el geocoder no lo encontró, contra las
 * coordenadas del dispositivo al publicar: sin ese respaldo, un aviso sin geocodificar nunca
 * entraría en un filtro por cercanía. El `LEAST/GREATEST` evita que un error de punto flotante
 * saque al `acos` de su dominio.
 *
 * Es SQL a mano porque Prisma no sabe expresar la fórmula, y va como un paso aparte que
 * devuelve ids para que el listado siga siendo un `findMany` con cursor.
 */
export async function idsEnRadio(
  latitud: number,
  longitud: number,
  radioKm: number,
): Promise<number[]> {
  const filas = await prisma.$queryRaw<{ id: number }[]>`
    SELECT animal_perdido_id AS id
    FROM animal_perdido
    WHERE animal_perdido_fecha_baja IS NULL
      AND (
        6371 * acos(
          LEAST(1, GREATEST(-1,
            cos(radians(${latitud})) *
            cos(radians(COALESCE(animal_perdido_lugar_latitud, animal_perdido_latitud))) *
            cos(
              radians(COALESCE(animal_perdido_lugar_longitud, animal_perdido_longitud)) -
              radians(${longitud})
            ) +
            sin(radians(${latitud})) *
            sin(radians(COALESCE(animal_perdido_lugar_latitud, animal_perdido_latitud)))
          ))
        )
      ) <= ${radioKm}
  `;

  return filas.map((fila) => fila.id);
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
 * Pares provincia-localidad distintos de los avisos visibles, para las opciones del filtro:
 * así nunca se ofrece una localidad sin avisos. El agrupado por provincia lo hace el servicio.
 */
export function listarUbicaciones() {
  return prisma.animalPerdido.findMany({
    where: { fechaBaja: null, provincia: { not: null }, localidad: { not: null } },
    distinct: ['provincia', 'localidad'],
    select: { provincia: true, localidad: true },
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
    provincia: string;
    localidad: string;
    referencia: string | null;
    /** El lugar geocodificado, o `null` si el geocoder no lo encontró. */
    lugarLatitud: number | null;
    lugarLongitud: number | null;
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

/** Baja lógica de un aviso por el admin (spec 008): `null` si no existe. */
export function buscarParaModeracion(id: number) {
  return prisma.animalPerdido.findFirst({
    where: { id },
    select: {
      id: true,
      nombre: true,
      descripcion: true,
      usuarioReportanteId: true,
      fechaBaja: true,
    },
  });
}

/** Da de baja el aviso y avisa a quien lo publicó en la misma transacción. */
export function darDeBajaPorModeracion(datos: {
  id: number;
  adminId: number;
  duenoId: number;
  mensajeAviso: string;
}) {
  return prisma.$transaction([
    prisma.animalPerdido.update({ where: { id: datos.id }, data: datosBaja(datos.adminId) }),
    prisma.notificacion.create({
      data: {
        tipo: 'MODERACION',
        mensaje: datos.mensajeAviso,
        usuarioId: datos.duenoId,
        ...datosAlta(datos.adminId),
      },
    }),
  ]);
}

// ─────────────── HU-13.2 · Reclamo y cierre del caso ───────────────

/**
 * El aviso con lo que necesitan el reclamo y el paso a Resuelto: de quién es, en qué estado
 * está y si sigue vivo.
 *
 * Trae también la fecha de baja de la cuenta del reportante: no se le puede abrir una sala a
 * alguien que ya no está, igual que el chat no deja escribirle a un contacto inactivo.
 */
export function buscarParaReclamo(id: number) {
  return prisma.animalPerdido.findUnique({
    where: { id },
    select: {
      id: true,
      nombre: true,
      fechaBaja: true,
      usuarioReportanteId: true,
      estadoAnimalPerdido: { select: { id: true, nombre: true } },
      usuarioReportante: { select: { id: true, fechaBaja: true } },
    },
  });
}

/** El estado "Resuelto" del catálogo, que es el que cierra el caso. */
export function buscarEstadoPorNombre(nombre: string) {
  return prisma.estadoAnimalPerdido.findFirst({
    where: { nombre, fechaBaja: null },
    select: { id: true, nombre: true },
  });
}

/**
 * Pasa el aviso a Resuelto y le pone la fecha de cierre.
 *
 * `fechaResuelto` es la que hasta ahora sólo escribía el seed: es el dato con el que el
 * portal puede decir cuándo volvió, independiente de `fechaModificacion`, que cambia con
 * cualquier edición.
 */
export function marcarResuelto(datos: { id: number; estadoId: number; usuarioId: number }) {
  return prisma.animalPerdido.update({
    where: { id: datos.id },
    data: {
      estadoAnimalPerdidoId: datos.estadoId,
      fechaResuelto: new Date(),
      ...datosModificacion(datos.usuarioId),
    },
    select: SELECCION_TARJETA,
  });
}

// ─────────────── HU-13.3 · Lo que gestiona quien publicó el aviso ───────────────

/**
 * Un aviso por id, con su fecha de baja: el detalle tiene que poder decir "se eliminó" en vez
 * de "no existe", porque la tarjeta del chat lo sigue mostrando después de la baja.
 */
export function buscarPorId(id: number) {
  return prisma.animalPerdido.findUnique({
    where: { id },
    select: { ...SELECCION_TARJETA, fechaBaja: true },
  });
}

/** Los avisos vivos de una persona, del más reciente al más viejo (Mis publicaciones). */
export function listarDeReportante(usuarioId: number) {
  return prisma.animalPerdido.findMany({
    where: { usuarioReportanteId: usuarioId, fechaBaja: null },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    select: SELECCION_TARJETA,
  });
}

/** `imagenes` llega con al menos una: la primera queda también como portada en `imagenUrl`. */
export function actualizar(
  id: number,
  datos: {
    nombre: string | null;
    descripcion: string;
    imagenes: string[];
    provincia: string;
    localidad: string;
    referencia: string | null;
    lugarLatitud: number | null;
    lugarLongitud: number | null;
    fechaSuceso: Date;
    especieId: number;
    estadoAnimalPerdidoId: number;
  },
  usuarioId: number,
) {
  return prisma.animalPerdido.update({
    where: { id },
    data: { ...datos, imagenUrl: datos.imagenes[0]!, ...datosModificacion(usuarioId) },
    select: SELECCION_TARJETA,
  });
}

/** Baja lógica por quien lo publicó. Las fotos quedan: las sigue mostrando el chat. */
export function darDeBajaPorReportante(id: number, usuarioId: number) {
  return prisma.animalPerdido.update({ where: { id }, data: datosBaja(usuarioId) });
}
