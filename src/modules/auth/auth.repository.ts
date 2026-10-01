import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { datosAlta, datosModificacion, USUARIO_SISTEMA_ID } from '../../shared/auditoria';
import { AppError } from '../../middlewares/errorHandler';

const includeUsuario = {
  estado: true,
  roles: { include: { rol: true } },
  // El refugio al que pertenece la persona, para que la sesión sepa en nombre de quién
  // atiende (GUI-31 muestra "Refugio Esperanza · 4 sin leer"). Sólo nombre e id: el resto
  // del refugio se pide a su propio endpoint.
  refugio: { select: { id: true, nombre: true } },
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
  provincia?: string;
  localidad?: string;
  calleAltura?: string;
  mapaUrl?: string;
  latitud?: number;
  longitud?: number;
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
          provincia: datos.provincia,
          localidad: datos.localidad,
          calleAltura: datos.calleAltura,
          mapaUrl: datos.mapaUrl,
          latitud: datos.latitud,
          longitud: datos.longitud,
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

/** Estado del refugio al que pertenece la persona, o `null` si no pertenece a ninguno. */
export async function buscarEstadoRefugioDeUsuario(usuarioId: number): Promise<string | null> {
  const usuario = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { refugio: { select: { fechaBaja: true, estado: { select: { nombre: true } } } } },
  });
  const refugio = usuario?.refugio;
  if (!refugio) return null;
  return refugio.fechaBaja ? 'Inactivo' : refugio.estado.nombre;
}

export async function buscarEstadoRefugioPorNombre(nombre: string) {
  return prisma.estadoRefugio.findUnique({ where: { nombre } });
}

export interface DatosNuevoRefugio {
  nombre: string;
  provincia: string;
  localidad: string;
  calleAltura: string;
  telefono?: string;
  email?: string;
  descripcion?: string | null;
  imagenUrl?: string;
  estadoId: number;
}

/**
 * Persona + refugio en una sola transacción: la persona queda con los roles Adoptante y
 * Refugio y asociada al refugio, que nace sin verificar.
 */
export async function crearRefugioConMiembro(
  persona: DatosNuevoUsuario,
  refugio: DatosNuevoRefugio,
  rolIds: number[],
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: {
          nombre: persona.nombre,
          apellido: persona.apellido,
          email: persona.email,
          contrasena: persona.contrasena,
          verificado: false,
          estadoId: persona.estadoId,
          ...datosAlta(USUARIO_SISTEMA_ID),
        },
      });

      const creado = await tx.refugio.create({
        data: { ...refugio, verificado: false, ...datosAlta(usuario.id) },
        include: { estado: true },
      });

      await tx.usuario.update({ where: { id: usuario.id }, data: { refugioId: creado.id } });
      await tx.rolUsuario.createMany({
        data: rolIds.map((rolId) => ({ usuarioId: usuario.id, rolId, ...datosAlta(usuario.id) })),
      });

      return { usuarioId: usuario.id, refugio: creado };
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
    | 'provincia'
    | 'localidad'
    | 'calleAltura'
    | 'mapaUrl'
    | 'latitud'
    | 'longitud'
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
