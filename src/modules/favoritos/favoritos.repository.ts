import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja } from '../../shared/auditoria';

/**
 * Favoritos que el usuario realmente ve: activos y de mascotas que no fueron eliminadas.
 *
 * El filtro por `mascota.fechaBaja` es lo que HU-6.3 dejó anotado como pendiente: una
 * mascota dada de baja sigue teniendo filas de Favorito apuntándole y, sin este `where`,
 * aparecería en la grilla de GUI-12.
 *
 * El listado y el contador comparten este filtro a propósito — si divergen, el header
 * dice "4 animales guardados" arriba de una grilla de 3.
 */
function visiblesDe(usuarioId: number) {
  return {
    usuarioId,
    fechaBaja: null,
    mascota: { fechaBaja: null },
  };
}

/** Estado vigente de la mascota + su raza/especie, para armar la tarjeta. */
const RELACIONES_TARJETA = {
  raza: { include: { especie: true } },
  historicoEstados: {
    where: { fechaBaja: null },
    include: { estadoMascota: true },
    orderBy: { fechaAlta: 'desc' },
    take: 1,
  },
} as const;

/**
 * Favoritos visibles del usuario, del más reciente al más antiguo (HU-6.6).
 *
 * Trae además la publicación activa de cada mascota y la solicitud viva que el usuario ya
 * tenga sobre ella: es lo que decide el botón de GUI-12 (HU-7.1). Sin publicación no hay
 * nada que solicitar aunque el favorito siga en la lista, y con una solicitud abierta la
 * tarjeta dice "Solicitud enviada" en vez de ofrecer un botón que iba a rebotar con 409.
 */
export function listarVisiblesDeUsuario(usuarioId: number) {
  return prisma.favorito.findMany({
    where: visiblesDe(usuarioId),
    include: {
      mascota: {
        include: {
          ...RELACIONES_TARJETA,
          publicaciones: {
            where: { fechaBaja: null },
            select: {
              id: true,
              solicitudes: {
                where: { usuarioId, fechaBaja: null, fechaRespuesta: null },
                select: { id: true },
                take: 1,
              },
            },
            take: 1,
          },
        },
      },
    },
    orderBy: { fechaAlta: 'desc' },
  });
}

/** Favorito activo de este usuario sobre esta mascota, si lo hay. */
export function buscarActivo(usuarioId: number, mascotaId: number) {
  return prisma.favorito.findFirst({ where: { usuarioId, mascotaId, fechaBaja: null } });
}

/**
 * Alta. No reactiva una fila dada de baja: inserta una nueva, así cada ciclo de
 * guardar/quitar queda registrado. El índice único parcial permite el par repetido
 * mientras sólo una de las filas esté activa.
 */
export function crear(usuarioId: number, mascotaId: number) {
  return prisma.favorito.create({
    data: { usuarioId, mascotaId, ...datosAlta(usuarioId) },
  });
}

/** Baja lógica: la fila queda como histórico y deja de contar para el listado. */
export function darDeBaja(favoritoId: number, usuarioBaja: number) {
  return prisma.favorito.update({
    where: { id: favoritoId },
    data: datosBaja(usuarioBaja),
  });
}

/** Mascota activa por id, sin filtrar por dueño: la propiedad la chequea el servicio. */
export function buscarMascotaActiva(mascotaId: number) {
  return prisma.mascota.findFirst({ where: { id: mascotaId, fechaBaja: null } });
}

/**
 * Sólo se puede guardar una mascota que esté ofrecida en adopción. Se mira al agregar y
 * NO al listar: si después la publicación se da de baja, el favorito sigue visible con el
 * badge actualizado (HU-6.6: "una mascota que cambia de estado sigue en la lista").
 */
export function buscarPublicacionActiva(mascotaId: number) {
  return prisma.publicacion.findFirst({
    where: { mascotaId, fechaBaja: null },
    select: { id: true },
  });
}
