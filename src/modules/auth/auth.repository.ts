import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { datosAlta, datosModificacion, USUARIO_SISTEMA_ID } from '../../shared/auditoria';
import { AppError } from '../../middlewares/errorHandler';

const includeUsuario = {
  estado: true,
  roles: { include: { rol: true } },
} as const;

export type UsuarioConRoles = Prisma.UsuarioGetPayload<{ include: typeof includeUsuario }>;

export interface DatosNuevoUsuario {
  nombre: string;
  apellido: string;
  email: string;
  contrasena?: string;
  telefono?: string;
  dni?: string;
  fechaNacimiento?: Date;
  googleId?: string;
  verificado: boolean;
  imagenUrl?: string;
  estadoId: number;
}

function mapearErrorUnico(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target;
    const campos = Array.isArray(target) ? target.join(',') : String(target ?? '');
    if (campos.includes('email')) {
      throw new AppError('EMAIL_DUPLICADO', 'Ya existe una cuenta con ese correo.', 409);
    }
    if (campos.includes('dni')) {
      throw new AppError('DNI_DUPLICADO', 'Ya existe una cuenta con ese DNI.', 409);
    }
    if (campos.includes('google')) {
      throw new AppError('EMAIL_DUPLICADO', 'Ya existe una cuenta vinculada a Google.', 409);
    }
  }
  throw error;
}

export async function buscarPorEmail(email: string): Promise<UsuarioConRoles | null> {
  return prisma.usuario.findUnique({
    where: { email },
    include: includeUsuario,
  });
}

export async function buscarPorGoogleId(googleId: string): Promise<UsuarioConRoles | null> {
  return prisma.usuario.findUnique({
    where: { googleId },
    include: includeUsuario,
  });
}

export async function buscarPorId(id: number): Promise<UsuarioConRoles | null> {
  return prisma.usuario.findFirst({
    where: { id, fechaBaja: null },
    include: includeUsuario,
  });
}

export async function buscarEstadoPorNombre(nombre: string) {
  return prisma.estadoUsuario.findUnique({ where: { nombre } });
}

export async function buscarRolPorNombre(nombre: string) {
  return prisma.rol.findUnique({ where: { nombre } });
}

export async function crearUsuarioConRol(
  datos: DatosNuevoUsuario,
  rolId: number,
): Promise<UsuarioConRoles> {
  try {
    return await prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: {
          nombre: datos.nombre,
          apellido: datos.apellido,
          email: datos.email,
          contrasena: datos.contrasena,
          telefono: datos.telefono,
          dni: datos.dni,
          fechaNacimiento: datos.fechaNacimiento,
          googleId: datos.googleId,
          verificado: datos.verificado,
          imagenUrl: datos.imagenUrl,
          estadoId: datos.estadoId,
          ...datosAlta(USUARIO_SISTEMA_ID),
        },
      });

      await tx.rolUsuario.create({
        data: {
          usuarioId: usuario.id,
          rolId,
          ...datosAlta(usuario.id),
        },
      });

      return tx.usuario.findUniqueOrThrow({
        where: { id: usuario.id },
        include: includeUsuario,
      });
    });
  } catch (error) {
    mapearErrorUnico(error);
  }
}

export async function vincularGoogleId(
  usuarioId: number,
  googleId: string,
  imagenUrl?: string,
): Promise<UsuarioConRoles> {
  return prisma.usuario.update({
    where: { id: usuarioId },
    data: {
      googleId,
      imagenUrl,
      verificado: true,
      usuarioModificacion: usuarioId,
      fechaModificacion: new Date(),
    },
    include: includeUsuario,
  });
}

export async function actualizarContrasena(usuarioId: number, hash: string): Promise<void> {
  await prisma.usuario.update({
    where: { id: usuarioId },
    data: {
      contrasena: hash,
      usuarioModificacion: usuarioId,
      fechaModificacion: new Date(),
    },
  });
}

export type DatosReactivarCuenta = Partial<
  Pick<
    DatosNuevoUsuario,
    | 'nombre'
    | 'apellido'
    | 'contrasena'
    | 'telefono'
    | 'dni'
    | 'fechaNacimiento'
    | 'googleId'
    | 'imagenUrl'
    | 'verificado'
  >
>;

/** HU-1.8: vuelve a dar de alta una cuenta que el propio usuario había dado de baja. */
export async function reactivarCuenta(
  usuarioId: number,
  estadoActivoId: number,
  extras: DatosReactivarCuenta = {},
): Promise<UsuarioConRoles> {
  return prisma.usuario.update({
    where: { id: usuarioId },
    data: {
      estadoId: estadoActivoId,
      fechaBaja: null,
      usuarioBaja: null,
      ...extras,
      ...datosModificacion(usuarioId),
    },
    include: includeUsuario,
  });
}
