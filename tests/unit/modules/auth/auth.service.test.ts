import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../src/middlewares/errorHandler';
import type { UsuarioConRoles } from '../../../../src/modules/auth/auth.repository';
import { ESTADO_USUARIO, ROL_API, ROL_DB } from '../../../../src/shared/roles';

vi.mock('../../../../src/modules/auth/auth.repository', () => ({
  buscarPorEmail: vi.fn(),
  buscarPorGoogleId: vi.fn(),
  buscarPorId: vi.fn(),
  buscarEstadoPorNombre: vi.fn(),
  buscarRolPorNombre: vi.fn(),
  crearUsuarioConRol: vi.fn(),
  vincularGoogleId: vi.fn(),
  actualizarContrasena: vi.fn(),
  reactivarCuenta: vi.fn(),
}));

vi.mock('../../../../src/shared/logAuditoria', () => ({
  registrarAuditoria: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/shared/r2', () => ({
  r2Habilitado: vi.fn(),
  subirImagenPerfil: vi.fn(),
}));

import * as authRepo from '../../../../src/modules/auth/auth.repository';
import {
  login,
  loginConGoogle,
  registrar,
  resetearPassword,
  solicitarRecuperacion,
} from '../../../../src/modules/auth/auth.service';
import { limpiarCodigosReset } from '../../../../src/modules/auth/auth.resetStore';
import * as r2 from '../../../../src/shared/r2';

const mockedRepo = vi.mocked(authRepo);

function estadoUsuario(nombre: string, id = 2) {
  return {
    id,
    nombre,
    descripcion: null,
    usuarioAlta: 1,
    fechaAlta: new Date(),
    usuarioModificacion: null,
    fechaModificacion: null,
    usuarioBaja: null,
    fechaBaja: null,
  };
}

function usuarioFake(overrides: Partial<UsuarioConRoles> = {}): UsuarioConRoles {
  return {
    id: 10,
    nombre: 'Ana',
    apellido: 'Perez',
    email: 'ana@mail.com',
    contrasena: 'hash',
    telefono: null,
    dni: null,
    fechaNacimiento: new Date('1995-05-20'),
    googleId: null,
    verificado: false,
    imagenUrl: null,
    ubicacion: null,
    refugioId: null,
    estadoId: 2,
    usuarioAlta: 1,
    fechaAlta: new Date(),
    usuarioModificacion: null,
    fechaModificacion: null,
    usuarioBaja: null,
    fechaBaja: null,
    estado: estadoUsuario(ESTADO_USUARIO.ACTIVO),
    roles: [
      {
        id: 1,
        usuarioId: 10,
        rolId: 3,
        usuarioAlta: 10,
        fechaAlta: new Date(),
        usuarioModificacion: null,
        fechaModificacion: null,
        usuarioBaja: null,
        fechaBaja: null,
        rol: {
          id: 3,
          nombre: ROL_DB.ADOPTANTE,
          descripcion: null,
          usuarioAlta: 1,
          fechaAlta: new Date(),
          usuarioModificacion: null,
          fechaModificacion: null,
          usuarioBaja: null,
          fechaBaja: null,
        },
      },
    ],
    ...overrides,
  };
}

function usuarioDadoDeBaja(overrides: Partial<UsuarioConRoles> = {}): UsuarioConRoles {
  return usuarioFake({
    estadoId: 4,
    usuarioBaja: 10,
    fechaBaja: new Date('2026-09-01'),
    estado: estadoUsuario(ESTADO_USUARIO.INACTIVO, 4),
    ...overrides,
  });
}

describe('auth.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limpiarCodigosReset();
    vi.mocked(r2.r2Habilitado).mockReturnValue(false);
    mockedRepo.buscarEstadoPorNombre.mockResolvedValue({
      id: 2,
      nombre: ESTADO_USUARIO.ACTIVO,
      descripcion: null,
      usuarioAlta: 1,
      fechaAlta: new Date(),
      usuarioModificacion: null,
      fechaModificacion: null,
      usuarioBaja: null,
      fechaBaja: null,
    });
    mockedRepo.buscarRolPorNombre.mockResolvedValue({
      id: 3,
      nombre: ROL_DB.ADOPTANTE,
      descripcion: null,
      usuarioAlta: 1,
      fechaAlta: new Date(),
      usuarioModificacion: null,
      fechaModificacion: null,
      usuarioBaja: null,
      fechaBaja: null,
    });
  });

  it('registra un adoptante y devuelve token + rol de API', async () => {
    mockedRepo.buscarPorEmail.mockResolvedValue(null);
    mockedRepo.crearUsuarioConRol.mockResolvedValue(usuarioFake({ contrasena: 'hash' }));

    const resultado = await registrar({
      nombre: 'Ana',
      apellido: 'Perez',
      email: 'ana@mail.com',
      password: 'secreto123',
      fechaNacimiento: '20/05/1995',
      telefono: '2615123456',
      rol: ROL_API.ADOPTANTE,
    });

    expect(resultado.usuario.roles).toEqual([ROL_API.ADOPTANTE]);
    expect(resultado.token.split('.')).toHaveLength(3);
    expect(mockedRepo.crearUsuarioConRol).toHaveBeenCalledOnce();
  });

  it('sube la foto a R2 y guarda solo la URL en el usuario', async () => {
    mockedRepo.buscarPorEmail.mockResolvedValue(null);
    mockedRepo.crearUsuarioConRol.mockResolvedValue(
      usuarioFake({ imagenUrl: 'https://cdn.pethood.test/perfiles/abc.jpg' }),
    );
    vi.mocked(r2.r2Habilitado).mockReturnValue(true);
    vi.mocked(r2.subirImagenPerfil).mockResolvedValue('https://cdn.pethood.test/perfiles/abc.jpg');

    const archivo = { buffer: Buffer.from('fake'), mimetype: 'image/jpeg' };
    const resultado = await registrar(
      {
        nombre: 'Ana',
        apellido: 'Perez',
        email: 'ana@mail.com',
        password: 'secreto123',
        fechaNacimiento: '20/05/1995',
        telefono: '2615123456',
        rol: ROL_API.ADOPTANTE,
      },
      archivo,
    );

    expect(r2.subirImagenPerfil).toHaveBeenCalledWith(archivo);
    expect(mockedRepo.crearUsuarioConRol).toHaveBeenCalledWith(
      expect.objectContaining({ imagenUrl: 'https://cdn.pethood.test/perfiles/abc.jpg' }),
      3,
    );
    expect(resultado.usuario.imagenUrl).toBe('https://cdn.pethood.test/perfiles/abc.jpg');
  });

  it('si R2 está desactivado, registra sin subir la foto', async () => {
    mockedRepo.buscarPorEmail.mockResolvedValue(null);
    mockedRepo.crearUsuarioConRol.mockResolvedValue(usuarioFake({ imagenUrl: null }));

    const archivo = { buffer: Buffer.from('fake'), mimetype: 'image/jpeg' };
    await registrar(
      {
        nombre: 'Ana',
        apellido: 'Perez',
        email: 'ana@mail.com',
        password: 'secreto123',
        fechaNacimiento: '20/05/1995',
        telefono: '2615123456',
        rol: ROL_API.ADOPTANTE,
      },
      archivo,
    );

    expect(r2.subirImagenPerfil).not.toHaveBeenCalled();
    expect(mockedRepo.crearUsuarioConRol).toHaveBeenCalledWith(
      expect.objectContaining({ imagenUrl: undefined }),
      3,
    );
  });

  it('rechaza registro con email duplicado', async () => {
    mockedRepo.buscarPorEmail.mockResolvedValue(usuarioFake());

    await expect(
      registrar({
        nombre: 'Ana',
        apellido: 'Perez',
        email: 'ana@mail.com',
        password: 'secreto123',
        fechaNacimiento: '20/05/1995',
        telefono: '2615123456',
        rol: ROL_API.ADOPTANTE,
      }),
    ).rejects.toMatchObject({ codigo: 'EMAIL_DUPLICADO', httpStatus: 409 });
  });

  it('login con contraseña inválida no distingue si el email existe', async () => {
    mockedRepo.buscarPorEmail.mockResolvedValue(null);

    await expect(login({ email: 'nadie@mail.com', password: 'secreto123' })).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(login({ email: 'nadie@mail.com', password: 'secreto123' })).rejects.toMatchObject({
      codigo: 'CREDENCIALES_INVALIDAS',
      httpStatus: 401,
    });
  });

  it('login de usuario suspendido responde 403', async () => {
    mockedRepo.buscarPorEmail.mockResolvedValue(
      usuarioFake({
        contrasena: await (await import('bcrypt')).hash('secreto123', 4),
        estado: estadoUsuario(ESTADO_USUARIO.SUSPENDIDO, 3),
      }),
    );

    await expect(login({ email: 'ana@mail.com', password: 'secreto123' })).rejects.toMatchObject({
      codigo: 'USUARIO_SUSPENDIDO',
      httpStatus: 403,
    });
  });

  it('login reactiva una cuenta dada de baja por el mismo usuario', async () => {
    const password = 'secreto123';
    const hash = await (await import('bcrypt')).hash(password, 4);
    const dadaDeBaja = usuarioDadoDeBaja({ contrasena: hash, googleId: null });
    const reactivada = usuarioFake({ contrasena: hash });

    mockedRepo.buscarPorEmail.mockResolvedValue(dadaDeBaja);
    mockedRepo.reactivarCuenta.mockResolvedValue(reactivada);

    const resultado = await login({ email: 'ana@mail.com', password });

    expect(resultado.usuario.id).toBe(10);
    expect(mockedRepo.reactivarCuenta).toHaveBeenCalledWith(10, 2, {});
  });

  it('login no reactiva una cuenta dada de baja por un admin', async () => {
    const password = 'secreto123';
    const hash = await (await import('bcrypt')).hash(password, 4);
    mockedRepo.buscarPorEmail.mockResolvedValue(
      usuarioDadoDeBaja({ contrasena: hash, usuarioBaja: 99 }),
    );

    await expect(login({ email: 'ana@mail.com', password })).rejects.toMatchObject({
      codigo: 'CREDENCIALES_INVALIDAS',
      httpStatus: 401,
    });
    expect(mockedRepo.reactivarCuenta).not.toHaveBeenCalled();
  });

  it('login con Google crea adoptante si no existe', async () => {
    mockedRepo.buscarPorGoogleId.mockResolvedValue(null);
    mockedRepo.buscarPorEmail.mockResolvedValue(null);
    mockedRepo.crearUsuarioConRol.mockResolvedValue(
      usuarioFake({
        email: 'ana@gmail.com',
        googleId: 'sub-google',
        verificado: true,
        contrasena: null,
      }),
    );

    const resultado = await loginConGoogle({
      googleId: 'sub-google',
      email: 'ana@gmail.com',
      nombre: 'Ana',
      apellido: 'Perez',
    });

    expect(resultado.usuario.email).toBe('ana@gmail.com');
    expect(mockedRepo.crearUsuarioConRol).toHaveBeenCalledOnce();
  });

  it('login con Google vincula la cuenta si el email ya existe', async () => {
    const existente = usuarioFake({ googleId: null });
    mockedRepo.buscarPorGoogleId.mockResolvedValue(null);
    mockedRepo.buscarPorEmail.mockResolvedValue(existente);
    mockedRepo.vincularGoogleId.mockResolvedValue({ ...existente, googleId: 'sub-google' });

    const resultado = await loginConGoogle({
      googleId: 'sub-google',
      email: 'ana@mail.com',
      nombre: 'Ana',
      apellido: 'Perez',
    });

    expect(resultado.usuario.id).toBe(10);
    expect(mockedRepo.vincularGoogleId).toHaveBeenCalledWith(10, 'sub-google', undefined);
  });

  it('login con Google reactiva una cuenta dada de baja por el mismo usuario', async () => {
    const dadaDeBaja = usuarioDadoDeBaja({
      googleId: 'sub-google',
      email: 'ana@gmail.com',
      contrasena: null,
      verificado: true,
    });
    const reactivada = usuarioFake({
      googleId: 'sub-google',
      email: 'ana@gmail.com',
      contrasena: null,
      verificado: true,
    });

    mockedRepo.buscarPorGoogleId.mockResolvedValue(dadaDeBaja);
    mockedRepo.reactivarCuenta.mockResolvedValue(reactivada);

    const resultado = await loginConGoogle({
      googleId: 'sub-google',
      email: 'ana@gmail.com',
      nombre: 'Ana',
      apellido: 'Perez',
    });

    expect(resultado.usuario.email).toBe('ana@gmail.com');
    expect(mockedRepo.reactivarCuenta).toHaveBeenCalledWith(10, 2, {});
    expect(mockedRepo.crearUsuarioConRol).not.toHaveBeenCalled();
  });

  it('login con Google no reactiva una cuenta dada de baja por un admin', async () => {
    mockedRepo.buscarPorGoogleId.mockResolvedValue(
      usuarioDadoDeBaja({ googleId: 'sub-google', usuarioBaja: 99 }),
    );

    await expect(
      loginConGoogle({
        googleId: 'sub-google',
        email: 'ana@gmail.com',
        nombre: 'Ana',
        apellido: 'Perez',
      }),
    ).rejects.toMatchObject({ codigo: 'CREDENCIALES_INVALIDAS', httpStatus: 401 });
    expect(mockedRepo.reactivarCuenta).not.toHaveBeenCalled();
    expect(mockedRepo.crearUsuarioConRol).not.toHaveBeenCalled();
  });

  it('registrar reactiva una cuenta dada de baja por el mismo usuario', async () => {
    const dadaDeBaja = usuarioDadoDeBaja({ contrasena: null, googleId: 'sub-google' });
    const reactivada = usuarioFake();

    mockedRepo.buscarPorEmail.mockResolvedValue(dadaDeBaja);
    mockedRepo.reactivarCuenta.mockResolvedValue(reactivada);

    const resultado = await registrar({
      nombre: 'Ana',
      apellido: 'Perez',
      email: 'ana@mail.com',
      password: 'secreto123',
      fechaNacimiento: '20/05/1995',
      telefono: '2615123456',
      rol: ROL_API.ADOPTANTE,
    });

    expect(resultado.usuario.id).toBe(10);
    expect(mockedRepo.reactivarCuenta).toHaveBeenCalledWith(
      10,
      2,
      expect.objectContaining({
        nombre: 'Ana',
        apellido: 'Perez',
        telefono: '2615123456',
      }),
    );
    expect(mockedRepo.crearUsuarioConRol).not.toHaveBeenCalled();
  });

  it('recuperar no revela si el email existe', async () => {
    mockedRepo.buscarPorEmail.mockResolvedValue(null);

    const resultado = await solicitarRecuperacion({ email: 'nadie@mail.com' });

    expect(resultado.mensaje).toContain('Si el correo está registrado');
    expect(resultado.codigo).toBeUndefined();
  });

  it('recuperar genera un código cuando el usuario existe', async () => {
    mockedRepo.buscarPorEmail.mockResolvedValue(usuarioFake());

    const resultado = await solicitarRecuperacion({ email: 'ana@mail.com' });

    expect(resultado.codigo).toMatch(/^\d{6}$/);
  });

  it('resetear cambia la contraseña con un código válido', async () => {
    const usuario = usuarioFake();
    mockedRepo.buscarPorEmail.mockResolvedValue(usuario);
    mockedRepo.buscarPorId.mockResolvedValue(usuario);
    mockedRepo.actualizarContrasena.mockResolvedValue(undefined);

    const { codigo } = await solicitarRecuperacion({ email: 'ana@mail.com' });
    await resetearPassword({ email: 'ana@mail.com', codigo: codigo!, password: 'nuevaClave1' });

    expect(mockedRepo.actualizarContrasena).toHaveBeenCalledWith(10, expect.any(String));
  });

  it('resetear rechaza un código inválido', async () => {
    await expect(
      resetearPassword({ email: 'ana@mail.com', codigo: '000000', password: 'nuevaClave1' }),
    ).rejects.toMatchObject({ codigo: 'CODIGO_INVALIDO', httpStatus: 400 });
  });
});
