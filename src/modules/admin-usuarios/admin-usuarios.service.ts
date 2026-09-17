import { AppError } from '../../middlewares/errorHandler';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { ESTADO_USUARIO, ROL_API, ROL_DB, rolApiADb, rolesDbAApi } from '../../shared/roles';
import type {
  AltaRefugioBody,
  FiltrosRefugios,
  FiltrosUsuarios,
  RolesBody,
} from './admin-usuarios.dto';
import type { RefugioAdmin, UsuarioAdmin } from './admin-usuarios.repository';
import * as repo from './admin-usuarios.repository';

// ─────────────── Mapeo a DTO de salida ───────────────

function aUsuarioDto(usuario: UsuarioAdmin) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    email: usuario.email,
    dni: usuario.dni,
    telefono: usuario.telefono,
    verificado: usuario.verificado,
    estado: usuario.estado.nombre,
    roles: rolesDbAApi(usuario.roles.map((v) => v.rol.nombre)),
    refugioId: usuario.refugioId,
  };
}

function aRefugioDto(refugio: RefugioAdmin) {
  return {
    id: refugio.id,
    nombre: refugio.nombre,
    direccion: refugio.direccion,
    telefono: refugio.telefono,
    email: refugio.email,
    descripcion: refugio.descripcion,
    verificado: refugio.verificado,
    estado: refugio.estado.nombre,
    imagenUrl: refugio.imagenUrl,
  };
}

function esAdmin(usuario: UsuarioAdmin): boolean {
  return usuario.roles.some((v) => v.rol.nombre === ROL_DB.ADMIN);
}

async function buscarUsuarioOFallar(id: number): Promise<UsuarioAdmin> {
  const usuario = await repo.buscarUsuario(id);
  if (!usuario) throw new AppError('USUARIO_NO_ENCONTRADO', 'No encontramos ese usuario.', 404);
  return usuario;
}

async function buscarRefugioOFallar(id: number): Promise<RefugioAdmin> {
  const refugio = await repo.buscarRefugio(id);
  if (!refugio) throw new AppError('REFUGIO_NO_ENCONTRADO', 'No encontramos ese refugio.', 404);
  return refugio;
}

// ─────────────── Usuarios ───────────────

export async function listarUsuarios(filtros: FiltrosUsuarios) {
  const { usuarios, total } = await repo.listarUsuarios({
    q: filtros.q,
    rolNombre: filtros.rol ? rolApiADb(filtros.rol) : undefined,
    estadoNombre: filtros.estado,
    verificado: filtros.verificado,
    page: filtros.page,
    limit: filtros.limit,
  });

  return {
    total,
    page: filtros.page,
    limit: filtros.limit,
    usuarios: usuarios.map(aUsuarioDto),
  };
}

export async function verificarUsuario(adminId: number, usuarioId: number) {
  const usuario = await buscarUsuarioOFallar(usuarioId);

  if (usuario.estado.nombre !== ESTADO_USUARIO.PENDIENTE) {
    if (usuario.verificado) {
      throw new AppError('USUARIO_YA_VERIFICADO', 'Este usuario ya está verificado.', 409);
    }
    throw new AppError(
      'ESTADO_INVALIDO',
      'Solo se puede verificar a un usuario en revisión (Pendiente_Verificacion).',
      409,
    );
  }

  if (!usuario.dni || !usuario.telefono) {
    throw new AppError(
      'DATOS_INCOMPLETOS',
      'El usuario no tiene DNI y/o teléfono cargados: no se puede verificar.',
      409,
    );
  }

  const estadoActivo = await repo.buscarEstadoUsuarioPorNombre(ESTADO_USUARIO.ACTIVO);
  const actualizado = await repo.verificarUsuario(usuarioId, adminId, estadoActivo.id);

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'VERIFICAR_USUARIO',
    entidad: 'Usuario',
    entidadId: usuarioId,
  });

  return aUsuarioDto(actualizado);
}

export async function suspenderUsuario(adminId: number, usuarioId: number, motivo: string) {
  const usuario = await buscarUsuarioOFallar(usuarioId);

  if (esAdmin(usuario)) {
    throw new AppError(
      'NO_SE_PUEDE_SUSPENDER_ADMIN',
      'No se puede suspender a un usuario con rol de administrador.',
      403,
    );
  }

  if (usuario.estado.nombre === ESTADO_USUARIO.SUSPENDIDO) {
    throw new AppError('USUARIO_YA_SUSPENDIDO', 'Este usuario ya está suspendido.', 409);
  }

  if (usuario.estado.nombre !== ESTADO_USUARIO.ACTIVO) {
    throw new AppError('ESTADO_INVALIDO', 'Solo se puede suspender a un usuario activo.', 409);
  }

  const estadoSuspendido = await repo.buscarEstadoUsuarioPorNombre(ESTADO_USUARIO.SUSPENDIDO);
  const actualizado = await repo.cambiarEstadoUsuario(usuarioId, adminId, estadoSuspendido.id);

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'SUSPENDER_USUARIO',
    entidad: 'Usuario',
    entidadId: usuarioId,
    detalle: motivo,
  });

  return aUsuarioDto(actualizado);
}

export async function reactivarUsuario(adminId: number, usuarioId: number) {
  const usuario = await buscarUsuarioOFallar(usuarioId);

  if (usuario.estado.nombre !== ESTADO_USUARIO.SUSPENDIDO) {
    throw new AppError('ESTADO_INVALIDO', 'Solo se puede reactivar a un usuario suspendido.', 409);
  }

  const estadoActivo = await repo.buscarEstadoUsuarioPorNombre(ESTADO_USUARIO.ACTIVO);
  const actualizado = await repo.cambiarEstadoUsuario(usuarioId, adminId, estadoActivo.id);

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'REACTIVAR_USUARIO',
    entidad: 'Usuario',
    entidadId: usuarioId,
  });

  return aUsuarioDto(actualizado);
}

export async function bajaUsuario(adminId: number, usuarioId: number, motivo: string) {
  const usuario = await buscarUsuarioOFallar(usuarioId);

  if (esAdmin(usuario)) {
    throw new AppError(
      'NO_SE_PUEDE_BAJAR_ADMIN',
      'No se puede dar de baja a un usuario con rol de administrador.',
      403,
    );
  }

  if (usuario.estado.nombre === ESTADO_USUARIO.INACTIVO) {
    throw new AppError('USUARIO_YA_DADO_DE_BAJA', 'Este usuario ya fue dado de baja.', 409);
  }

  const estadoInactivo = await repo.buscarEstadoUsuarioPorNombre(ESTADO_USUARIO.INACTIVO);
  const actualizado = await repo.darDeBajaUsuario(usuarioId, adminId, estadoInactivo.id);

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'BAJA_USUARIO',
    entidad: 'Usuario',
    entidadId: usuarioId,
    detalle: motivo,
  });

  return aUsuarioDto(actualizado);
}

export async function gestionarRoles(adminId: number, usuarioId: number, body: RolesBody) {
  const usuario = await buscarUsuarioOFallar(usuarioId);

  // Blindaje (regla 4): a un admin no se le puede tocar ningún otro rol. Quitarle el
  // rol ADMIN en sí es el único camino permitido, gobernado por ULTIMO_ADMINISTRADOR (regla 5).
  if (esAdmin(usuario) && body.quitar.some((rol) => rol !== ROL_API.ADMIN)) {
    throw new AppError(
      'NO_SE_PUEDE_EDITAR_ADMIN',
      'No se le pueden quitar roles a un usuario con rol de administrador.',
      403,
    );
  }

  if (body.agregar.includes(ROL_API.MIEMBRO_REFUGIO) && body.refugioId !== undefined) {
    await buscarRefugioOFallar(body.refugioId);
  }

  for (const rolApi of body.agregar) {
    const rol = await repo.buscarRolPorNombre(rolApiADb(rolApi));
    const vinculo = await repo.buscarVinculoRolActivo(usuarioId, rol.id);
    if (!vinculo) await repo.agregarRol(usuarioId, rol.id, adminId);
  }

  for (const rolApi of body.quitar) {
    const rol = await repo.buscarRolPorNombre(rolApiADb(rolApi));

    if (rolApi === ROL_API.ADMIN) {
      const otrosAdmins = await repo.contarUsuariosActivosConRol(rol.id, usuarioId);
      if (otrosAdmins === 0) {
        throw new AppError(
          'ULTIMO_ADMINISTRADOR',
          'No se puede quitar el rol: quedaría el sistema sin administradores.',
          409,
        );
      }
    }

    const vinculo = await repo.buscarVinculoRolActivo(usuarioId, rol.id);
    if (vinculo) await repo.quitarRol(vinculo.id, adminId);
  }

  if (body.agregar.includes(ROL_API.MIEMBRO_REFUGIO) && body.refugioId !== undefined) {
    await repo.asignarRefugio(usuarioId, body.refugioId, adminId);
  }

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'EDITAR_ROLES',
    entidad: 'Usuario',
    entidadId: usuarioId,
    detalle: JSON.stringify(body),
  });

  const actualizado = await buscarUsuarioOFallar(usuarioId);
  return {
    mensaje: 'Roles actualizados.',
    roles: rolesDbAApi(actualizado.roles.map((v) => v.rol.nombre)),
  };
}

// ─────────────── Refugios ───────────────

export async function listarRefugios(filtros: FiltrosRefugios) {
  const { refugios, total } = await repo.listarRefugios({
    q: filtros.q,
    estadoNombre: filtros.estado,
    verificado: filtros.verificado,
    page: filtros.page,
    limit: filtros.limit,
  });

  return {
    total,
    page: filtros.page,
    limit: filtros.limit,
    refugios: refugios.map(aRefugioDto),
  };
}

export async function obtenerDetalleRefugio(id: number) {
  const refugio = await repo.buscarRefugioDetalle(id);
  if (!refugio) throw new AppError('REFUGIO_NO_ENCONTRADO', 'No encontramos ese refugio.', 404);

  const resumen = await repo.resumenRefugio(id);

  return {
    refugio: aRefugioDto(refugio),
    miembros: refugio.usuarios.map((u) => ({
      id: u.id,
      nombre: u.nombre,
      apellido: u.apellido,
      email: u.email,
      roles: rolesDbAApi(u.roles.map((v) => v.rol.nombre)),
    })),
    resumen,
  };
}

export async function altaRefugio(adminId: number, body: AltaRefugioBody) {
  const estadoPendiente = await repo.buscarEstadoRefugioPorNombre('Pendiente_Verificacion');
  const refugio = await repo.crearRefugio(body, estadoPendiente.id, adminId);

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'ALTA_REFUGIO',
    entidad: 'Refugio',
    entidadId: refugio.id,
  });

  return aRefugioDto(refugio);
}

export async function verificarRefugio(adminId: number, refugioId: number) {
  const refugio = await buscarRefugioOFallar(refugioId);

  if (refugio.estado.nombre !== 'Pendiente_Verificacion') {
    if (refugio.verificado) {
      throw new AppError('REFUGIO_YA_VERIFICADO', 'Este refugio ya está verificado.', 409);
    }
    throw new AppError(
      'ESTADO_INVALIDO',
      'Solo se puede verificar a un refugio en revisión (Pendiente_Verificacion).',
      409,
    );
  }

  const estadoActivo = await repo.buscarEstadoRefugioPorNombre('Activo');
  const actualizado = await repo.verificarRefugio(refugioId, adminId, estadoActivo.id);

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'VERIFICAR_REFUGIO',
    entidad: 'Refugio',
    entidadId: refugioId,
  });

  return aRefugioDto(actualizado);
}

export async function suspenderRefugio(adminId: number, refugioId: number, motivo: string) {
  const refugio = await buscarRefugioOFallar(refugioId);

  if (refugio.estado.nombre === 'Suspendido') {
    throw new AppError('REFUGIO_YA_SUSPENDIDO', 'Este refugio ya está suspendido.', 409);
  }

  if (refugio.estado.nombre !== 'Activo') {
    throw new AppError('ESTADO_INVALIDO', 'Solo se puede suspender a un refugio activo.', 409);
  }

  const estadoSuspendido = await repo.buscarEstadoRefugioPorNombre('Suspendido');
  const actualizado = await repo.cambiarEstadoRefugio(refugioId, adminId, estadoSuspendido.id);

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'SUSPENDER_REFUGIO',
    entidad: 'Refugio',
    entidadId: refugioId,
    detalle: motivo,
  });

  return aRefugioDto(actualizado);
}

export async function reactivarRefugio(adminId: number, refugioId: number) {
  const refugio = await buscarRefugioOFallar(refugioId);

  if (refugio.estado.nombre !== 'Suspendido') {
    throw new AppError('ESTADO_INVALIDO', 'Solo se puede reactivar a un refugio suspendido.', 409);
  }

  const estadoActivo = await repo.buscarEstadoRefugioPorNombre('Activo');
  const actualizado = await repo.cambiarEstadoRefugio(refugioId, adminId, estadoActivo.id);

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'REACTIVAR_REFUGIO',
    entidad: 'Refugio',
    entidadId: refugioId,
  });

  return aRefugioDto(actualizado);
}

export async function bajaRefugio(adminId: number, refugioId: number, motivo: string) {
  const refugio = await buscarRefugioOFallar(refugioId);

  if (refugio.estado.nombre === 'Inactivo') {
    throw new AppError('REFUGIO_YA_DADO_DE_BAJA', 'Este refugio ya fue dado de baja.', 409);
  }

  const estadoInactivo = await repo.buscarEstadoRefugioPorNombre('Inactivo');
  const actualizado = await repo.darDeBajaRefugio(refugioId, adminId, estadoInactivo.id);

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'BAJA_REFUGIO',
    entidad: 'Refugio',
    entidadId: refugioId,
    detalle: motivo,
  });

  return aRefugioDto(actualizado);
}
