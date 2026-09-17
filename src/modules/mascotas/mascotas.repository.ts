import type { GeneroMascota, TamanioMascota } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';

export interface DatosNuevaMascota {
  nombre: string;
  fechaNacimiento: Date;
  genero: GeneroMascota;
  peso: number;
  tamanio: TamanioMascota;
  castrado: boolean;
  descripcion: string | null;
  imagenUrl: string;
  razaId: number;
  refugioId: number | null;
  usuarioId: number;
  estadoMascotaId: number;
}

/** Mascota + su primera fila de Mascota_Estado en una sola transacción. */
export function crearConEstado(datos: DatosNuevaMascota, usuarioAlta: number) {
  const { estadoMascotaId, ...mascota } = datos;

  return prisma.mascota.create({
    data: {
      ...mascota,
      ...datosAlta(usuarioAlta),
      historicoEstados: {
        create: { estadoMascotaId, ...datosAlta(usuarioAlta) },
      },
    },
    include: {
      raza: { include: { especie: true } },
      historicoEstados: { include: { estadoMascota: true } },
    },
  });
}

/** Raza vigente con su especie, para validar que la combinación elegida exista. */
export function buscarRaza(razaId: number) {
  return prisma.raza.findFirst({
    where: { id: razaId, fechaBaja: null },
    include: { especie: true },
  });
}

export function buscarEstadoMascota(estadoMascotaId: number) {
  return prisma.estadoMascota.findFirst({ where: { id: estadoMascotaId, fechaBaja: null } });
}

export function buscarEstadoMascotaPorNombre(nombre: string) {
  return prisma.estadoMascota.findFirst({ where: { nombre, fechaBaja: null } });
}

export function buscarUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({ where: { id: usuarioId, fechaBaja: null } });
}

/** Campos escribibles en la edición: los ausentes no se tocan. */
export interface DatosEdicionMascota {
  nombre?: string;
  fechaNacimiento?: Date;
  genero?: GeneroMascota;
  peso?: number;
  tamanio?: TamanioMascota;
  castrado?: boolean;
  descripcion?: string | null;
  imagenUrl?: string;
  razaId?: number;
}

/** Mascota activa por id, sin filtrar por dueño: la propiedad la chequea el servicio. */
export function buscarPorId(mascotaId: number) {
  return prisma.mascota.findFirst({ where: { id: mascotaId, fechaBaja: null } });
}

export function actualizar(mascotaId: number, datos: DatosEdicionMascota, usuarioModifica: number) {
  return prisma.mascota.update({
    where: { id: mascotaId },
    data: { ...datos, ...datosModificacion(usuarioModifica) },
    include: {
      raza: { include: { especie: true } },
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
 * Baja lógica de la mascota y, en la misma transacción, de sus publicaciones activas
 * (HU-6.3: "retirar su información y publicación"). Devuelve cuántas se dieron de baja.
 */
export function darDeBajaConPublicaciones(mascotaId: number, usuarioBaja: number) {
  const baja = datosBaja(usuarioBaja);

  return prisma.$transaction(async (tx) => {
    const publicaciones = await tx.publicacion.updateMany({
      where: { mascotaId, fechaBaja: null },
      data: baja,
    });

    await tx.mascota.update({ where: { id: mascotaId }, data: baja });

    return publicaciones.count;
  });
}

/**
 * Solicitudes vivas sobre las publicaciones activas de la mascota, cada una con su estado
 * vigente. Cuáles bloquean la baja lo decide el servicio.
 */
export function listarSolicitudesDeMascota(mascotaId: number) {
  return prisma.solicitud.findMany({
    where: { fechaBaja: null, publicacion: { mascotaId, fechaBaja: null } },
    include: {
      historicoEstados: {
        where: { fechaBaja: null },
        include: { estadoSolicitud: true },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
    },
  });
}

/**
 * Una publicación puede reusar el string de `mascota.imagenUrl` tal cual
 * (publicaciones.service.ts), así que antes de borrar el archivo del disco hay que
 * confirmar que nadie más lo apunte. Se miran también las publicaciones dadas de baja:
 * un archivo huérfano es más barato que una imagen rota.
 */
export function existePublicacionQueUsaImagen(imagenUrl: string) {
  return prisma.publicacion.findFirst({
    where: { OR: [{ imagenUrl }, { imagenes: { has: imagenUrl } }] },
    select: { id: true },
  });
}

/**
 * Mascotas activas de un ámbito, con su estado vigente.
 *
 * Son dos conjuntos distintos y no uno filtrado:
 * - personales: las que el usuario cargó a título propio (`refugioId` nulo).
 * - del refugio: todas las del refugio, sin importar qué miembro las cargó. Por eso no
 *   lleva `usuarioId` — si lo llevara, cada miembro vería solo las suyas.
 */
export function listarPorAmbito(ambito: { usuarioId: number } | { refugioId: number }) {
  const where =
    'refugioId' in ambito ? { refugioId: ambito.refugioId } : { ...ambito, refugioId: null };

  return prisma.mascota.findMany({
    where: { ...where, fechaBaja: null },
    include: {
      raza: { include: { especie: true } },
      historicoEstados: {
        where: { fechaBaja: null },
        include: { estadoMascota: true },
        orderBy: { fechaAlta: 'desc' },
        take: 1,
      },
    },
    orderBy: { fechaAlta: 'desc' },
  });
}
