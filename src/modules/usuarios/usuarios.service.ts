import bcrypt from 'bcrypt';
import { AppError } from '../../middlewares/errorHandler';
import type { Ambito } from '../../shared/ambito';
import { persistirImagenPerfil } from '../../shared/imagenPerfil';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { ESTADO_USUARIO, ROL_DB, rolesDbAApi } from '../../shared/roles';
import type { ArchivoSubida } from '../../shared/r2';
import type { ActualizarPerfilBody, CambiarPasswordBody, PerfilPropio } from './usuarios.dto';
import type { UsuarioPerfil } from './usuarios.repository';
import * as repo from './usuarios.repository';

const BCRYPT_COST = 10;

function nombresDeRol(usuario: UsuarioPerfil): string[] {
  return usuario.roles
    .filter((vinculo) => vinculo.fechaBaja === null)
    .map((vinculo) => vinculo.rol.nombre);
}

function aPerfil(
  usuario: UsuarioPerfil,
  mascotas: number,
  valoracion: number | null,
): PerfilPropio {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    email: usuario.email,
    telefono: usuario.telefono,
    ubicacion: usuario.ubicacion,
    imagenUrl: usuario.imagenUrl,
    roles: rolesDbAApi(nombresDeRol(usuario)),
    refugio: usuario.refugio,
    tienePassword: Boolean(usuario.contrasena),
    mascotas,
    favoritos: usuario._count.favoritos,
    valoracion: valoracion === null ? null : Math.round(valoracion * 10) / 10,
  };
}

/** `ambito` decide qué mascotas cuenta el perfil: las personales o las del refugio. */
async function armarPerfil(usuario: UsuarioPerfil, ambito: Ambito): Promise<PerfilPropio> {
  const [mascotas, valoracion] = await Promise.all([
    repo.contarMascotasDelAmbito(usuario, ambito),
    repo.promedioValoracion(usuario.id),
  ]);
  return aPerfil(usuario, mascotas, valoracion);
}

export async function obtenerPerfil(usuarioId: number, ambito: Ambito): Promise<PerfilPropio> {
  const usuario = await repo.buscarPerfil(usuarioId);
  if (!usuario) {
    throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);
  }
  return armarPerfil(usuario, ambito);
}

export async function actualizarPerfil(
  usuarioId: number,
  ambito: Ambito,
  body: ActualizarPerfilBody,
  archivo?: ArchivoSubida,
): Promise<PerfilPropio> {
  const actual = await repo.buscarPerfil(usuarioId);
  if (!actual) {
    throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);
  }

  if (body.email !== actual.email) {
    const existente = await repo.buscarPorEmail(body.email);
    if (existente && existente.id !== usuarioId) {
      throw new AppError('EMAIL_DUPLICADO', 'El correo ingresado ya está en uso.', 409);
    }
  }

  const imagenUrl = archivo ? await persistirImagenPerfil(archivo) : undefined;
  const actualizado = await repo.actualizarPerfil(usuarioId, { ...body, imagenUrl });

  await registrarAuditoria({
    usuarioId,
    accion: 'EDITAR_PERFIL',
    entidad: 'Usuario',
    entidadId: usuarioId,
  });

  return armarPerfil(actualizado, ambito);
}

export async function cambiarPassword(usuarioId: number, body: CambiarPasswordBody): Promise<void> {
  const usuario = await repo.buscarHashContrasena(usuarioId);
  if (!usuario) {
    throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);
  }

  if (usuario.contrasena) {
    if (!body.passwordActual) {
      throw new AppError('VALIDACION', 'Ingresá tu contraseña actual para poder cambiarla.', 400);
    }

    const ok = await bcrypt.compare(body.passwordActual, usuario.contrasena);
    if (!ok) {
      throw new AppError('CREDENCIALES_INVALIDAS', 'La contraseña actual no es correcta.', 401);
    }
  }

  const hash = await bcrypt.hash(body.passwordNueva, BCRYPT_COST);
  await repo.actualizarContrasena(usuarioId, hash);

  await registrarAuditoria({
    usuarioId,
    accion: 'CAMBIAR_CONTRASENA',
    entidad: 'Usuario',
    entidadId: usuarioId,
  });
}

/**
 * HU-1.8. Misma baja para quien se registró con correo o con Google: el usuario queda
 * Inactivo, se cierran trámites abiertos y el perfil deja de verse. El cliente cierra
 * la sesión; el JWT no se invalida (regla 3).
 */
export async function darDeBajaCuenta(usuarioId: number): Promise<void> {
  const usuario = await repo.buscarPerfil(usuarioId);
  if (!usuario) {
    throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);
  }

  if (nombresDeRol(usuario).includes(ROL_DB.ADMIN)) {
    throw new AppError(
      'NO_SE_PUEDE_BAJAR_ADMIN',
      'No se puede dar de baja una cuenta de administrador.',
      403,
    );
  }

  const [estadoInactivo, estadoCancelada] = await Promise.all([
    repo.buscarEstadoUsuarioPorNombre(ESTADO_USUARIO.INACTIVO),
    repo.buscarEstadoSolicitudPorNombre('Cancelada'),
  ]);

  if (!estadoInactivo || !estadoCancelada) {
    throw new AppError(
      'ERROR_INTERNO',
      'No pudimos dar de baja la cuenta. Intentalo de nuevo.',
      500,
    );
  }

  await repo.darDeBajaCuenta(usuarioId, estadoInactivo.id, estadoCancelada.id);

  await registrarAuditoria({
    usuarioId,
    accion: 'BAJA_CUENTA',
    entidad: 'Usuario',
    entidadId: usuarioId,
  });
}
