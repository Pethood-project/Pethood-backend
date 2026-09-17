import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosBaja, datosModificacion } from '../../shared/auditoria';

const includeUsuario = {
  estado: true,
  refugio: true,
  roles: { where: { fechaBaja: null }, include: { rol: true } },
} as const;

export type UsuarioAdmin = Prisma.UsuarioGetPayload<{ include: typeof includeUsuario }>;

export interface FiltrosUsuariosRepo {
  q?: string;
  rolNombre?: string;
  estadoNombre?: string;
  verificado?: boolean;
  page: number;
  limit: number;
}

function whereUsuarios(filtros: FiltrosUsuariosRepo): Prisma.UsuarioWhereInput {
  return {
    fechaBaja: null,
    ...(filtros.verificado !== undefined ? { verificado: filtros.verificado } : {}),
    ...(filtros.estadoNombre ? { estado: { nombre: filtros.estadoNombre } } : {}),
    ...(filtros.rolNombre
      ? { roles: { some: { fechaBaja: null, rol: { nombre: filtros.rolNombre } } } }
      : {}),
    ...(filtros.q
      ? {
          OR: [
            { nombre: { contains: filtros.q, mode: 'insensitive' } },
            { apellido: { contains: filtros.q, mode: 'insensitive' } },
            { email: { contains: filtros.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}

export async function listarUsuarios(
  filtros: FiltrosUsuariosRepo,
): Promise<{ usuarios: UsuarioAdmin[]; total: number }> {
  const where = whereUsuarios(filtros);
  const [usuarios, total] = await Promise.all([
    prisma.usuario.findMany({
      where,
      include: includeUsuario,
      orderBy: { id: 'asc' },
      skip: (filtros.page - 1) * filtros.limit,
      take: filtros.limit,
    }),
    prisma.usuario.count({ where }),
  ]);
  return { usuarios, total };
}

export function buscarUsuario(id: number): Promise<UsuarioAdmin | null> {
  return prisma.usuario.findFirst({ where: { id, fechaBaja: null }, include: includeUsuario });
}

export function buscarEstadoUsuarioPorNombre(nombre: string) {
  return prisma.estadoUsuario.findUniqueOrThrow({ where: { nombre } });
}

export function buscarRolPorNombre(nombre: string) {
  return prisma.rol.findUniqueOrThrow({ where: { nombre } });
}

export function contarUsuariosActivosConRol(rolId: number, excluirUsuarioId?: number) {
  return prisma.usuario.count({
    where: {
      fechaBaja: null,
      estado: { nombre: 'Activo' },
      roles: { some: { fechaBaja: null, rolId } },
      ...(excluirUsuarioId ? { id: { not: excluirUsuarioId } } : {}),
    },
  });
}

export function cambiarEstadoUsuario(id: number, adminId: number, estadoId: number) {
  return prisma.usuario.update({
    where: { id },
    data: { estadoId, ...datosModificacion(adminId) },
    include: includeUsuario,
  });
}

export function verificarUsuario(id: number, adminId: number, estadoActivoId: number) {
  return prisma.usuario.update({
    where: { id },
    data: { verificado: true, estadoId: estadoActivoId, ...datosModificacion(adminId) },
    include: includeUsuario,
  });
}

export function darDeBajaUsuario(id: number, adminId: number, estadoInactivoId: number) {
  return prisma.usuario.update({
    where: { id },
    data: { estadoId: estadoInactivoId, ...datosBaja(adminId) },
    include: includeUsuario,
  });
}

export function buscarVinculoRolActivo(usuarioId: number, rolId: number) {
  return prisma.rolUsuario.findFirst({ where: { usuarioId, rolId, fechaBaja: null } });
}

export function agregarRol(usuarioId: number, rolId: number, adminId: number) {
  return prisma.rolUsuario.create({
    data: { usuarioId, rolId, usuarioAlta: adminId },
  });
}

export function quitarRol(vinculoId: number, adminId: number) {
  return prisma.rolUsuario.update({
    where: { id: vinculoId },
    data: datosBaja(adminId),
  });
}

export function asignarRefugio(usuarioId: number, refugioId: number, adminId: number) {
  return prisma.usuario.update({
    where: { id: usuarioId },
    data: { refugioId, ...datosModificacion(adminId) },
  });
}

export function buscarRefugio(id: number) {
  return prisma.refugio.findFirst({ where: { id, fechaBaja: null }, include: { estado: true } });
}

// ─────────────── Refugios ───────────────

const includeRefugio = { estado: true } as const;

export type RefugioAdmin = Prisma.RefugioGetPayload<{ include: typeof includeRefugio }>;

export interface FiltrosRefugiosRepo {
  q?: string;
  estadoNombre?: string;
  verificado?: boolean;
  page: number;
  limit: number;
}

function whereRefugios(filtros: FiltrosRefugiosRepo): Prisma.RefugioWhereInput {
  return {
    fechaBaja: null,
    ...(filtros.verificado !== undefined ? { verificado: filtros.verificado } : {}),
    ...(filtros.estadoNombre ? { estado: { nombre: filtros.estadoNombre } } : {}),
    ...(filtros.q ? { nombre: { contains: filtros.q, mode: 'insensitive' } } : {}),
  };
}

export async function listarRefugios(
  filtros: FiltrosRefugiosRepo,
): Promise<{ refugios: RefugioAdmin[]; total: number }> {
  const where = whereRefugios(filtros);
  const [refugios, total] = await Promise.all([
    prisma.refugio.findMany({
      where,
      include: includeRefugio,
      orderBy: { id: 'asc' },
      skip: (filtros.page - 1) * filtros.limit,
      take: filtros.limit,
    }),
    prisma.refugio.count({ where }),
  ]);
  return { refugios, total };
}

export function buscarRefugioDetalle(id: number) {
  return prisma.refugio.findFirst({
    where: { id, fechaBaja: null },
    include: {
      estado: true,
      usuarios: {
        where: { fechaBaja: null },
        select: {
          id: true,
          nombre: true,
          apellido: true,
          email: true,
          roles: { where: { fechaBaja: null }, include: { rol: true } },
        },
      },
    },
  });
}

export function buscarEstadoRefugioPorNombre(nombre: string) {
  return prisma.estadoRefugio.findUniqueOrThrow({ where: { nombre } });
}

/** Resumen de actividad del refugio para el modal de detalle (spec 002, tabla §4 fila 41). */
export async function resumenRefugio(refugioId: number) {
  const [mascotasActivas, publicacionesActivas, solicitudesConEstado, campaniasActivas, resenas] =
    await Promise.all([
      prisma.mascota.count({ where: { refugioId, fechaBaja: null } }),
      prisma.publicacion.count({
        where: { fechaBaja: null, mascota: { refugioId, fechaBaja: null } },
      }),
      prisma.solicitud.findMany({
        where: { fechaBaja: null, publicacion: { mascota: { refugioId } } },
        include: {
          historicoEstados: {
            where: { fechaBaja: null },
            include: { estadoSolicitud: true },
            orderBy: { fechaAlta: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.campania.count({
        where: { refugioId, fechaBaja: null, estadoCampania: { nombre: 'Activa' } },
      }),
      prisma.resena.aggregate({
        where: { refugioReportadoId: refugioId, fechaBaja: null },
        _count: { _all: true },
        _avg: { puntuacion: true },
      }),
    ]);

  const solicitudesPendientes = solicitudesConEstado.filter(
    (s) => s.historicoEstados[0]?.estadoSolicitud.nombre === 'Pendiente',
  ).length;

  return {
    mascotasActivas,
    publicacionesActivas,
    solicitudesPendientes,
    campaniasActivas,
    resenasRecibidas: resenas._count._all,
    promedioResenas: resenas._avg.puntuacion ? Math.round(resenas._avg.puntuacion * 10) / 10 : null,
  };
}

export function crearRefugio(
  datos: {
    nombre: string;
    direccion: string;
    telefono?: string;
    email?: string;
    descripcion: string | null;
  },
  estadoPendienteId: number,
  adminId: number,
) {
  return prisma.refugio.create({
    data: {
      nombre: datos.nombre,
      direccion: datos.direccion,
      telefono: datos.telefono,
      email: datos.email,
      descripcion: datos.descripcion,
      verificado: false,
      estadoId: estadoPendienteId,
      usuarioAlta: adminId,
    },
    include: includeRefugio,
  });
}

export function verificarRefugio(id: number, adminId: number, estadoActivoId: number) {
  return prisma.refugio.update({
    where: { id },
    data: { verificado: true, estadoId: estadoActivoId, ...datosModificacion(adminId) },
    include: includeRefugio,
  });
}

export function cambiarEstadoRefugio(id: number, adminId: number, estadoId: number) {
  return prisma.refugio.update({
    where: { id },
    data: { estadoId, ...datosModificacion(adminId) },
    include: includeRefugio,
  });
}

export function darDeBajaRefugio(id: number, adminId: number, estadoInactivoId: number) {
  return prisma.refugio.update({
    where: { id },
    data: { estadoId: estadoInactivoId, ...datosBaja(adminId) },
    include: includeRefugio,
  });
}
