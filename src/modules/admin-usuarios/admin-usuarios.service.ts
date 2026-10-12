import { env } from '../../config/env';
import { AppError } from '../../middlewares/errorHandler';
import { registrarAuditoria } from '../../shared/logAuditoria';
import * as notificaciones from '../notificaciones/notificaciones.service';
import { ESTADO_USUARIO, ROL_API, ROL_DB, rolApiADb, rolesDbAApi } from '../../shared/roles';
import { listarDeRefugio, listarDeUsuario } from '../resenas/resenas.service';
import { etiquetaUbicacion } from '../../shared/ubicacion';
import { firmarUrlArchivo } from '../../shared/urlFirmada';
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
    // Texto de la dirección estructurada, para no romper a los consumidores que ya mostraban
    // `direccion` (spec 002). El refugio ya no guarda un texto libre aparte.
    direccion: etiquetaUbicacion(refugio),
    provincia: refugio.provincia,
    localidad: refugio.localidad,
    calleAltura: refugio.calleAltura,
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

export async function obtenerDetalleUsuario(adminId: number, id: number) {
  const usuario = await buscarUsuarioOFallar(id);

  // Acceso a datos sensibles: queda quién los vio y qué archivos eran (rutas, sin firma).
  if (usuario.dniImagenUrl || usuario.selfieUrl) {
    await registrarAuditoria({
      usuarioId: adminId,
      accion: 'VER_DOCUMENTOS_USUARIO',
      entidad: 'Usuario',
      entidadId: id,
      detalle: `dni=${usuario.dniImagenUrl ?? '-'} selfie=${usuario.selfieUrl ?? '-'}`,
    });
  }
  const [resumen, resenas] = await Promise.all([repo.resumenUsuario(id), listarDeUsuario(id)]);

  return {
    usuario: {
      ...aUsuarioDto(usuario),
      imagenUrl: usuario.imagenUrl,
      documentos: {
        dniImagenUrl: firmarUrlArchivo(usuario.dniImagenUrl),
        selfieUrl: firmarUrlArchivo(usuario.selfieUrl),
      },
      fechaNacimiento: usuario.fechaNacimiento,
      fechaAlta: usuario.fechaAlta,
      ubicacion: etiquetaUbicacion(usuario),
      refugio: usuario.refugio ? { id: usuario.refugio.id, nombre: usuario.refugio.nombre } : null,
    },
    resumen,
    resenas,
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

  if (!usuario.dniImagenUrl || !usuario.selfieUrl) {
    throw new AppError(
      'FALTA_DOCUMENTACION',
      'El usuario todavía no subió la foto del DNI y la selfie: no se puede verificar.',
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
    detalle: 'con documentacion (dni+selfie)',
  });

  await notificaciones.notificar({
    usuarioId,
    tipo: 'USUARIO_VALIDADO',
    mensaje: 'Ya podés solicitar adopciones: validamos tu cuenta.',
    entidadTipo: 'PERFIL',
    entidadId: usuarioId,
    canal: { push: true },
    usuarioAlta: adminId,
  });

  return aUsuarioDto(actualizado);
}

/**
 * Baja lógica de los documentos de un usuario verificado: queda no verificado y vuelve a
 * Pendiente_Verificacion para subir DNI y selfie de nuevo (spec 002.1).
 */
export async function revocarVerificacion(adminId: number, usuarioId: number, motivo: string) {
  const usuario = await buscarUsuarioOFallar(usuarioId);

  if (esAdmin(usuario)) {
    throw new AppError(
      'NO_SE_PUEDE_REVOCAR_ADMIN',
      'No se puede revocar la verificación de un administrador.',
      403,
    );
  }

  if (!usuario.verificado) {
    throw new AppError('USUARIO_NO_VERIFICADO', 'Este usuario no está verificado.', 409);
  }

  if (usuario.estado.nombre !== ESTADO_USUARIO.ACTIVO) {
    throw new AppError(
      'ESTADO_INVALIDO',
      'Solo se puede revocar la verificación de un usuario activo.',
      409,
    );
  }

  const estadoPendiente = await repo.buscarEstadoUsuarioPorNombre(ESTADO_USUARIO.PENDIENTE);
  const actualizado = await repo.revocarVerificacion(usuarioId, adminId, estadoPendiente.id);
  if (!actualizado) {
    throw new AppError(
      'ESTADO_INVALIDO',
      'El usuario cambió de estado mientras lo revisabas. Actualizá y probá de nuevo.',
      409,
    );
  }

  await registrarAuditoria({
    usuarioId: adminId,
    accion: 'REVOCAR_VERIFICACION',
    entidad: 'Usuario',
    entidadId: usuarioId,
    // Las rutas quedan en el log: los archivos siguen en storage (baja lógica), así hay
    // con qué reconstruir qué se había aprobado.
    detalle: `${motivo} | dni=${usuario.dniImagenUrl ?? '-'} selfie=${usuario.selfieUrl ?? '-'}`,
  });

  await notificaciones.notificar({
    usuarioId,
    tipo: 'VERIFICACION_REVOCADA',
    mensaje: `Revocamos la verificación de tu cuenta: ${motivo}. Volvé a subir tu DNI y tu selfie.`,
    entidadTipo: 'PERFIL',
    entidadId: usuarioId,
    canal: { push: true },
    usuarioAlta: adminId,
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

  // Solo mail: con la cuenta suspendida ya no puede entrar, así que no hay bandeja que ver.
  await notificaciones.enviarMailDirecto({
    to: actualizado.email,
    asunto: 'Tu cuenta de PetHood fue suspendida',
    texto: `Tu cuenta de PetHood fue suspendida: ${motivo}\n\nSi creés que es un error, escribinos a ${env.MAIL_SOPORTE}.`,
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

  // Solo mail: con la cuenta dada de baja ya no puede entrar, así que una fila de bandeja
  // nunca se vería.
  await notificaciones.enviarMailDirecto({
    to: actualizado.email,
    asunto: 'Tu cuenta de PetHood fue dada de baja',
    texto: `Tu cuenta de PetHood fue dada de baja: ${motivo}\n\nSi creés que es un error, escribinos a ${env.MAIL_SOPORTE}.`,
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

  // Todo usuario es adoptante siempre: lo que cambia es su vínculo con un refugio (MIEMBRO_REFUGIO).
  if (body.quitar.includes(ROL_API.ADOPTANTE)) {
    throw new AppError(
      'NO_SE_PUEDE_QUITAR_ADOPTANTE',
      'El rol de adoptante no se puede quitar: todos los usuarios son adoptantes.',
      409,
    );
  }

  const refugioDestino =
    body.agregar.includes(ROL_API.MIEMBRO_REFUGIO) && body.refugioId !== undefined
      ? await buscarRefugioOFallar(body.refugioId)
      : null;

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

  // Sin rol de refugio no queda asociado a ningún refugio.
  if (
    body.quitar.includes(ROL_API.MIEMBRO_REFUGIO) &&
    !body.agregar.includes(ROL_API.MIEMBRO_REFUGIO)
  ) {
    await repo.desasignarRefugio(usuarioId, adminId);
  }

  if (refugioDestino) {
    await repo.asignarRefugio(usuarioId, refugioDestino.id, adminId);

    if (refugioDestino.estado.nombre === 'Pendiente_Verificacion') {
      await notificaciones.notificar({
        usuarioId,
        tipo: 'REFUGIO_REGISTRADO_PENDIENTE',
        mensaje: `${refugioDestino.nombre} quedó registrado y a la espera de validación`,
        asuntoMail: 'Tu refugio quedó a la espera de validación',
        entidadTipo: 'REFUGIO',
        entidadId: refugioDestino.id,
        canal: { mail: true },
        usuarioAlta: adminId,
      });
    }
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

  const [resumen, resenas] = await Promise.all([repo.resumenRefugio(id), listarDeRefugio(id)]);

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
    resenas,
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

  // "Nuevo refugio esperando validación", a todos los administradores. Best-effort: el
  // refugio ya está creado, que el aviso falle no puede convertir eso en un 500.
  try {
    const admins = await repo.listarIdsAdmins();
    await Promise.all(
      admins.map((usuarioId) =>
        notificaciones.notificar({
          usuarioId,
          tipo: 'REFUGIO_NUEVO_PENDIENTE',
          mensaje: `${refugio.nombre} está esperando validación`,
          asuntoMail: `Nuevo refugio pendiente de validación: ${refugio.nombre}`,
          entidadTipo: 'REFUGIO',
          entidadId: refugio.id,
          canal: { mail: true },
          usuarioAlta: adminId,
        }),
      ),
    );
  } catch (err) {
    console.error('No se pudo avisar a los admins del refugio nuevo', refugio.id, err);
  }

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

  await avisarMiembrosRefugio(refugioId, {
    tipo: 'REFUGIO_APROBADO',
    mensaje: `¡${actualizado.nombre} fue validado! Ya podés publicar mascotas en adopción.`,
    asuntoMail: `${actualizado.nombre} fue aprobado en PetHood`,
    adminId,
  });

  return aRefugioDto(actualizado);
}

/** A todos los miembros activos de un refugio (spec 004: aprobado/rechazado, suspendido).
 * Best-effort: el cambio de estado del refugio ya se escribió antes de llamar acá. */
async function avisarMiembrosRefugio(
  refugioId: number,
  datos: { tipo: string; mensaje: string; asuntoMail: string; adminId: number },
): Promise<void> {
  try {
    const miembros = await repo.listarIdsMiembrosDeRefugio(refugioId);

    await Promise.all(
      miembros.map((usuarioId) =>
        notificaciones.notificar({
          usuarioId,
          tipo: datos.tipo,
          mensaje: datos.mensaje,
          asuntoMail: datos.asuntoMail,
          entidadTipo: 'REFUGIO',
          entidadId: refugioId,
          canal: { mail: true, push: true },
          usuarioAlta: datos.adminId,
        }),
      ),
    );
  } catch (err) {
    console.error('No se pudo avisar a los miembros del refugio', refugioId, err);
  }
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

  await avisarMiembrosRefugio(refugioId, {
    tipo: 'REFUGIO_SUSPENDIDO',
    mensaje: `${actualizado.nombre} fue suspendido: ${motivo}`,
    asuntoMail: `${actualizado.nombre} fue suspendido en PetHood`,
    adminId,
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
