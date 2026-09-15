import bcrypt from 'bcrypt';
import { env } from '../../config/env';
import { AppError } from '../../middlewares/errorHandler';
import { parsearFechaNacimiento } from '../../shared/fechas';
import { firmarToken } from '../../shared/jwt';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { estaBloqueado, limpiarIntentos, registrarFallo } from '../../shared/rateLimit';
import { ESTADO_USUARIO, ROL_API, rolApiADb, rolesDbAApi } from '../../shared/roles';
import { r2Habilitado, subirImagenPerfil, type ArchivoSubida } from '../../shared/r2';
import type {
  LoginBody,
  RecuperarBody,
  RegistroBody,
  ResetearBody,
  RespuestaAuth,
  RespuestaRecuperar,
} from './auth.dto';
import type { PerfilGoogle } from './auth.google';
import type { UsuarioConRoles } from './auth.repository';
import * as authRepo from './auth.repository';
import { consumirCodigoReset, generarCodigoReset, guardarCodigoReset } from './auth.resetStore';

const BCRYPT_COST = 10;
const EMAIL_SISTEMA = 'sistema@pethood.internal';

function nombresDeRol(usuario: UsuarioConRoles): string[] {
  return usuario.roles
    .filter((vinculo) => vinculo.fechaBaja === null)
    .map((vinculo) => vinculo.rol.nombre);
}

function aRespuesta(usuario: UsuarioConRoles): RespuestaAuth {
  const rolesApi = rolesDbAApi(nombresDeRol(usuario));
  return {
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      email: usuario.email,
      roles: rolesApi,
      imagenUrl: usuario.imagenUrl,
      telefono: usuario.telefono,
      ubicacion: usuario.ubicacion,
    },
    token: firmarToken({ usuarioId: usuario.id, email: usuario.email, roles: rolesApi }),
  };
}

function asegurarPuedeIngresar(usuario: UsuarioConRoles): void {
  if (usuario.email === EMAIL_SISTEMA) {
    throw new AppError(
      'CREDENCIALES_INVALIDAS',
      'El correo o contraseña ingresados son incorrectos.',
      401,
    );
  }

  if (usuario.estado.nombre === ESTADO_USUARIO.SUSPENDIDO) {
    throw new AppError(
      'USUARIO_SUSPENDIDO',
      'Tu cuenta está suspendida. Escribinos a soporte para más información.',
      403,
    );
  }

  if (usuario.estado.nombre === ESTADO_USUARIO.INACTIVO) {
    throw new AppError(
      'CREDENCIALES_INVALIDAS',
      'El correo o contraseña ingresados son incorrectos.',
      401,
    );
  }
}

/** Baja hecha por el mismo usuario (HU-1.8). La baja de un admin no se auto-reactiva. */
function esBajaAutoReactivable(usuario: UsuarioConRoles): boolean {
  return usuario.fechaBaja !== null && usuario.usuarioBaja === usuario.id;
}

async function reactivarCuentaPropia(
  usuario: UsuarioConRoles,
  extras: authRepo.DatosReactivarCuenta = {},
): Promise<UsuarioConRoles> {
  const estado = await authRepo.buscarEstadoPorNombre(ESTADO_USUARIO.ACTIVO);
  if (!estado) {
    throw new AppError(
      'ERROR_INTERNO',
      'Faltan catálogos de roles o estados. Corré el seed de la base.',
      500,
    );
  }

  const reactivado = await authRepo.reactivarCuenta(usuario.id, estado.id, extras);

  await registrarAuditoria({
    usuarioId: usuario.id,
    accion: 'REACTIVAR_CUENTA',
    entidad: 'Usuario',
    entidadId: usuario.id,
  });

  return reactivado;
}

async function asegurarUsuarioActivo(usuario: UsuarioConRoles): Promise<UsuarioConRoles> {
  const vigente = esBajaAutoReactivable(usuario)
    ? await reactivarCuentaPropia(usuario)
    : usuario;
  asegurarPuedeIngresar(vigente);
  return vigente;
}

async function exigirCatalogos(rolApi: string) {
  const estado = await authRepo.buscarEstadoPorNombre(ESTADO_USUARIO.ACTIVO);
  const rol = await authRepo.buscarRolPorNombre(rolApiADb(rolApi));

  if (!estado || !rol) {
    throw new AppError(
      'ERROR_INTERNO',
      'Faltan catálogos de roles o estados. Corré el seed de la base.',
      500,
    );
  }

  return { estado, rol };
}

export async function registrar(
  body: RegistroBody,
  archivo?: ArchivoSubida,
): Promise<RespuestaAuth> {
  if (body.rol === ROL_API.MIEMBRO_REFUGIO) {
    throw new AppError(
      'VALIDACION',
      'El registro como refugio todavía no está disponible en esta versión.',
      400,
    );
  }

  const existente = await authRepo.buscarPorEmail(body.email);
  if (existente && !esBajaAutoReactivable(existente)) {
    throw new AppError('EMAIL_DUPLICADO', 'Ya existe una cuenta con ese correo.', 409);
  }

  const fechaNacimiento = parsearFechaNacimiento(body.fechaNacimiento);
  const hash = await bcrypt.hash(body.password, BCRYPT_COST);
  const imagenUrl = archivo && r2Habilitado() ? await subirImagenPerfil(archivo) : undefined;

  if (existente) {
    const usuario = await reactivarCuentaPropia(existente, {
      nombre: body.nombre,
      apellido: body.apellido,
      contrasena: hash,
      telefono: body.telefono,
      dni: body.dni,
      fechaNacimiento,
      imagenUrl,
    });
    return aRespuesta(usuario);
  }

  const { estado, rol } = await exigirCatalogos(body.rol);
  const usuario = await authRepo.crearUsuarioConRol(
    {
      nombre: body.nombre,
      apellido: body.apellido,
      email: body.email,
      contrasena: hash,
      telefono: body.telefono,
      dni: body.dni,
      fechaNacimiento,
      imagenUrl,
      verificado: false,
      estadoId: estado.id,
    },
    rol.id,
  );

  await registrarAuditoria({
    usuarioId: usuario.id,
    accion: 'REGISTRO',
    entidad: 'Usuario',
    entidadId: usuario.id,
    detalle: `rol=${body.rol}`,
  });

  return aRespuesta(usuario);
}

export async function login(body: LoginBody): Promise<RespuestaAuth> {
  if (estaBloqueado(body.email)) {
    throw new AppError(
      'DEMASIADOS_INTENTOS',
      'Demasiados intentos fallidos. Esperá unos minutos e intentalo de nuevo.',
      429,
    );
  }

  const usuario = await authRepo.buscarPorEmail(body.email);
  if (!usuario || !usuario.contrasena) {
    registrarFallo(body.email);
    throw new AppError(
      'CREDENCIALES_INVALIDAS',
      'El correo o contraseña ingresados son incorrectos.',
      401,
    );
  }

  const ok = await bcrypt.compare(body.password, usuario.contrasena);
  if (!ok) {
    registrarFallo(body.email);
    throw new AppError(
      'CREDENCIALES_INVALIDAS',
      'El correo o contraseña ingresados son incorrectos.',
      401,
    );
  }

  const vigente = await asegurarUsuarioActivo(usuario);
  limpiarIntentos(body.email);

  return aRespuesta(vigente);
}

export async function loginConGoogle(perfil: PerfilGoogle): Promise<RespuestaAuth> {
  const porGoogle = await authRepo.buscarPorGoogleId(perfil.googleId);
  if (porGoogle) {
    const vigente = await asegurarUsuarioActivo(porGoogle);
    return aRespuesta(vigente);
  }

  const porEmail = await authRepo.buscarPorEmail(perfil.email);
  if (porEmail) {
    const vigente = await asegurarUsuarioActivo(porEmail);
    const vinculado = await authRepo.vincularGoogleId(
      vigente.id,
      perfil.googleId,
      perfil.imagenUrl,
    );
    await registrarAuditoria({
      usuarioId: vinculado.id,
      accion: 'VINCULAR_GOOGLE',
      entidad: 'Usuario',
      entidadId: vinculado.id,
    });
    return aRespuesta(vinculado);
  }

  const { estado, rol } = await exigirCatalogos(ROL_API.ADOPTANTE);
  const usuario = await authRepo.crearUsuarioConRol(
    {
      nombre: perfil.nombre,
      apellido: perfil.apellido,
      email: perfil.email,
      googleId: perfil.googleId,
      imagenUrl: perfil.imagenUrl,
      verificado: true,
      estadoId: estado.id,
    },
    rol.id,
  );

  await registrarAuditoria({
    usuarioId: usuario.id,
    accion: 'REGISTRO_GOOGLE',
    entidad: 'Usuario',
    entidadId: usuario.id,
  });

  return aRespuesta(usuario);
}

export async function perfilPropio(usuarioId: number): Promise<RespuestaAuth['usuario']> {
  const usuario = await authRepo.buscarPorId(usuarioId);
  if (!usuario) {
    throw new AppError('NO_AUTENTICADO', 'No encontramos tu sesión.', 401);
  }
  return aRespuesta(usuario).usuario;
}

const MENSAJE_RECUPERAR =
  'Si el correo está registrado, te enviamos un código para restablecer tu contraseña.';

function puedeRecuperar(usuario: UsuarioConRoles): boolean {
  if (usuario.email === EMAIL_SISTEMA) return false;
  const estado = usuario.estado.nombre;
  return estado !== ESTADO_USUARIO.SUSPENDIDO && estado !== ESTADO_USUARIO.INACTIVO;
}

export async function solicitarRecuperacion(body: RecuperarBody): Promise<RespuestaRecuperar> {
  const usuario = await authRepo.buscarPorEmail(body.email);

  if (!usuario || !puedeRecuperar(usuario)) {
    return { mensaje: MENSAJE_RECUPERAR };
  }

  const codigo = generarCodigoReset();
  guardarCodigoReset(usuario.email, usuario.id, codigo);

  await registrarAuditoria({
    usuarioId: usuario.id,
    accion: 'SOLICITAR_RECUPERACION',
    entidad: 'Usuario',
    entidadId: usuario.id,
  });

  if (env.NODE_ENV !== 'production') {
    console.info(`[auth] Código de recuperación para ${usuario.email}: ${codigo}`);
    return { mensaje: MENSAJE_RECUPERAR, codigo };
  }

  return { mensaje: MENSAJE_RECUPERAR };
}

export async function resetearPassword(body: ResetearBody): Promise<void> {
  const usuarioId = consumirCodigoReset(body.email, body.codigo);
  if (!usuarioId) {
    throw new AppError(
      'CODIGO_INVALIDO',
      'El código es inválido o expiró. Pedí uno nuevo e intentalo de nuevo.',
      400,
    );
  }

  const usuario = await authRepo.buscarPorId(usuarioId);
  if (!usuario || usuario.email !== body.email) {
    throw new AppError(
      'CODIGO_INVALIDO',
      'El código es inválido o expiró. Pedí uno nuevo e intentalo de nuevo.',
      400,
    );
  }

  const hash = await bcrypt.hash(body.password, BCRYPT_COST);
  await authRepo.actualizarContrasena(usuario.id, hash);

  await registrarAuditoria({
    usuarioId: usuario.id,
    accion: 'RESETEAR_CONTRASENA',
    entidad: 'Usuario',
    entidadId: usuario.id,
  });
}
