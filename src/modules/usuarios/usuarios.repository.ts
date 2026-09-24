import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';
import { AppError } from '../../middlewares/errorHandler';
import type { Ambito } from '../../shared/ambito';

const ESTADOS_SOLICITUD_ABIERTA = ['Pendiente', 'En_Revision'] as const;

const includePerfil = {
  estado: true,
  roles: { include: { rol: true } },
  _count: {
    select: {
      // Las mascotas no se cuentan acá: dependen del perfil con el que se mira (personal o
      // refugio), ver `contarMascotasDelAmbito`.
      // El filtro por `mascota` no es opcional: tiene que dar el mismo número que
      // `GET /favoritos`, que descarta las mascotas dadas de baja. Sin él, al eliminarse
      // una mascota guardada el perfil muestra "5" y GUI-12 lista 4.
      favoritos: { where: { fechaBaja: null, mascota: { fechaBaja: null } } },
    },
  },
} as const;

export type UsuarioPerfil = Prisma.UsuarioGetPayload<{ include: typeof includePerfil }>;

export interface DatosActualizarPerfil {
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  ubicacion: string;
  imagenUrl?: string;
}

function mapearErrorUnico(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target;
    const campos = Array.isArray(target) ? target.join(',') : String(target ?? '');
    if (campos.includes('email')) {
      throw new AppError('EMAIL_DUPLICADO', 'El correo ingresado ya está en uso.', 409);
    }
  }
  throw error;
}

export async function buscarPerfil(usuarioId: number): Promise<UsuarioPerfil | null> {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    include: includePerfil,
  });
}

/**
 * Mismo criterio que `GET /mascotas/mias` para el perfil pedido (ver `shared/ambito.ts`),
 * para que el contador de Mi Perfil no pueda discrepar del listado.
 */
export function contarMascotasDelAmbito(
  usuario: { id: number; refugioId: number | null },
  ambito: Ambito,
): Promise<number> {
  const where: Prisma.MascotaWhereInput =
    ambito === 'REFUGIO'
      ? { fechaBaja: null, refugioId: usuario.refugioId ?? -1 }
      : { fechaBaja: null, usuarioId: usuario.id, refugioId: null };

  return prisma.mascota.count({ where });
}

export async function buscarPorEmail(email: string): Promise<{ id: number } | null> {
  return prisma.usuario.findFirst({
    where: { email, fechaBaja: null },
    select: { id: true },
  });
}

export async function promedioValoracion(usuarioId: number): Promise<number | null> {
  const resultado = await prisma.resena.aggregate({
    where: { usuarioReportadoId: usuarioId, fechaBaja: null },
    _avg: { puntuacion: true },
  });
  return resultado._avg.puntuacion;
}

export async function actualizarPerfil(
  usuarioId: number,
  datos: DatosActualizarPerfil,
): Promise<UsuarioPerfil> {
  try {
    return await prisma.usuario.update({
      where: { id: usuarioId },
      data: {
        nombre: datos.nombre,
        apellido: datos.apellido,
        email: datos.email,
        telefono: datos.telefono,
        ubicacion: datos.ubicacion,
        ...(datos.imagenUrl ? { imagenUrl: datos.imagenUrl } : {}),
        ...datosModificacion(usuarioId),
      },
      include: includePerfil,
    });
  } catch (error) {
    mapearErrorUnico(error);
  }
}

export async function actualizarContrasena(usuarioId: number, hash: string): Promise<void> {
  await prisma.usuario.update({
    where: { id: usuarioId },
    data: {
      contrasena: hash,
      ...datosModificacion(usuarioId),
    },
  });
}

export async function buscarHashContrasena(
  usuarioId: number,
): Promise<{ id: number; contrasena: string | null } | null> {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: { id: true, contrasena: true },
  });
}

export function buscarEstadoUsuarioPorNombre(nombre: string) {
  return prisma.estadoUsuario.findFirst({ where: { nombre, fechaBaja: null } });
}

export function buscarEstadoSolicitudPorNombre(nombre: string) {
  return prisma.estadoSolicitud.findFirst({ where: { nombre, fechaBaja: null } });
}

/**
 * HU-1.8: cierra trámites abiertos del usuario y deja la cuenta Inactiva (baja lógica).
 *
 * En la misma transacción:
 * - cancela solicitudes Pendiente/En_Revision que envió o que le llegaron sobre mascotas
 *   particulares (las del refugio las siguen viendo los demás miembros);
 * - retira publicaciones y mascotas particulares;
 * - limpia favoritos;
 * - marca al usuario con estado Inactivo + fechaBaja.
 */
export async function darDeBajaCuenta(
  usuarioId: number,
  estadoInactivoId: number,
  estadoCanceladaId: number,
): Promise<void> {
  const baja = datosBaja(usuarioId);

  await prisma.$transaction(async (tx) => {
    const solicitudes = await tx.solicitud.findMany({
      where: {
        fechaBaja: null,
        OR: [{ usuarioId }, { publicacion: { usuarioId, mascota: { refugioId: null } } }],
      },
      include: {
        historicoEstados: {
          where: { fechaBaja: null },
          include: { estadoSolicitud: true },
          orderBy: { fechaAlta: 'desc' },
          take: 1,
        },
      },
    });

    const abiertas = solicitudes.filter((solicitud) => {
      const vigente = solicitud.historicoEstados[0]?.estadoSolicitud.nombre;
      return (
        vigente !== undefined && (ESTADOS_SOLICITUD_ABIERTA as readonly string[]).includes(vigente)
      );
    });

    for (const solicitud of abiertas) {
      await tx.solicitud.update({
        where: { id: solicitud.id },
        data: baja,
      });
      await tx.solicitudEstado.create({
        data: {
          solicitudId: solicitud.id,
          estadoSolicitudId: estadoCanceladaId,
          ...datosAlta(usuarioId),
        },
      });
    }

    const mascotas = await tx.mascota.findMany({
      where: { usuarioId, fechaBaja: null, refugioId: null },
      select: { id: true },
    });
    const mascotaIds = mascotas.map((mascota) => mascota.id);

    if (mascotaIds.length > 0) {
      await tx.publicacion.updateMany({
        where: { mascotaId: { in: mascotaIds }, fechaBaja: null },
        data: baja,
      });
      await tx.mascota.updateMany({
        where: { id: { in: mascotaIds } },
        data: baja,
      });
    }

    await tx.favorito.updateMany({
      where: { usuarioId, fechaBaja: null },
      data: baja,
    });

    await tx.usuario.update({
      where: { id: usuarioId },
      data: { estadoId: estadoInactivoId, ...baja },
    });
  });
}
