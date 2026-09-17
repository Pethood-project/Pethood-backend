import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../src/middlewares/errorHandler';
import { ESTADO_USUARIO, ROL_DB } from '../../../../src/shared/roles';
import type { UsuarioAdmin } from '../../../../src/modules/admin-usuarios/admin-usuarios.repository';

vi.mock('../../../../src/modules/admin-usuarios/admin-usuarios.repository', () => ({
  buscarUsuario: vi.fn(),
  listarUsuarios: vi.fn(),
  buscarEstadoUsuarioPorNombre: vi.fn(),
  buscarRolPorNombre: vi.fn(),
  contarUsuariosActivosConRol: vi.fn(),
  cambiarEstadoUsuario: vi.fn(),
  verificarUsuario: vi.fn(),
  darDeBajaUsuario: vi.fn(),
  buscarVinculoRolActivo: vi.fn(),
  agregarRol: vi.fn(),
  quitarRol: vi.fn(),
  asignarRefugio: vi.fn(),
  buscarRefugio: vi.fn(),
}));

vi.mock('../../../../src/shared/logAuditoria', () => ({
  registrarAuditoria: vi.fn().mockResolvedValue(undefined),
}));

import * as repo from '../../../../src/modules/admin-usuarios/admin-usuarios.repository';
import * as service from '../../../../src/modules/admin-usuarios/admin-usuarios.service';

const mockedRepo = vi.mocked(repo);

function usuarioFake(overrides: Partial<UsuarioAdmin> = {}): UsuarioAdmin {
  return {
    id: 5,
    nombre: 'Ana',
    apellido: 'Perez',
    email: 'ana@mail.com',
    contrasena: 'hash',
    telefono: '2615123456',
    dni: '30111222',
    fechaNacimiento: null,
    googleId: null,
    verificado: false,
    imagenUrl: null,
    ubicacion: null,
    refugioId: null,
    estadoId: 1,
    usuarioAlta: 1,
    fechaAlta: new Date(),
    usuarioModificacion: null,
    fechaModificacion: null,
    usuarioBaja: null,
    fechaBaja: null,
    estado: {
      id: 1,
      nombre: ESTADO_USUARIO.ACTIVO,
      descripcion: null,
      usuarioAlta: 1,
      fechaAlta: new Date(),
      usuarioModificacion: null,
      fechaModificacion: null,
      usuarioBaja: null,
      fechaBaja: null,
    },
    refugio: null,
    roles: [],
    ...overrides,
  } as UsuarioAdmin;
}

function vinculoRol(rolNombre: string) {
  return {
    id: 99,
    usuarioId: 5,
    rolId: 1,
    usuarioAlta: 1,
    fechaAlta: new Date(),
    usuarioModificacion: null,
    fechaModificacion: null,
    usuarioBaja: null,
    fechaBaja: null,
    rol: {
      id: 1,
      nombre: rolNombre,
      descripcion: null,
      usuarioAlta: 1,
      fechaAlta: new Date(),
      usuarioModificacion: null,
      fechaModificacion: null,
      usuarioBaja: null,
      fechaBaja: null,
    },
  } as UsuarioAdmin['roles'][number];
}

beforeEach(() => {
  vi.clearAllMocks();
});

const estadoPendiente = {
  id: 5,
  nombre: ESTADO_USUARIO.PENDIENTE,
  descripcion: null,
  usuarioAlta: 1,
  fechaAlta: new Date(),
  usuarioModificacion: null,
  fechaModificacion: null,
  usuarioBaja: null,
  fechaBaja: null,
} as UsuarioAdmin['estado'];

describe('verificarUsuario', () => {
  it('rechaza con ESTADO_INVALIDO si el usuario no está en Pendiente_Verificacion', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue(usuarioFake());

    await expect(service.verificarUsuario(1, 5)).rejects.toMatchObject({
      codigo: 'ESTADO_INVALIDO',
    } satisfies Partial<AppError>);
  });

  it('rechaza con DATOS_INCOMPLETOS si falta dni o telefono', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue(usuarioFake({ dni: null, estado: estadoPendiente }));

    await expect(service.verificarUsuario(1, 5)).rejects.toMatchObject({
      codigo: 'DATOS_INCOMPLETOS',
    } satisfies Partial<AppError>);
  });

  it('verifica cuando está Pendiente_Verificacion con dni y telefono', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue(usuarioFake({ estado: estadoPendiente }));
    mockedRepo.buscarEstadoUsuarioPorNombre.mockResolvedValue({ id: 2 } as never);
    mockedRepo.verificarUsuario.mockResolvedValue(usuarioFake({ verificado: true }));

    const resultado = await service.verificarUsuario(1, 5);

    expect(resultado.verificado).toBe(true);
    expect(mockedRepo.verificarUsuario).toHaveBeenCalledWith(5, 1, 2);
  });
});

describe('blindaje de administradores', () => {
  it('no permite suspender a un usuario con rol ADMIN', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue(usuarioFake({ roles: [vinculoRol(ROL_DB.ADMIN)] }));

    await expect(service.suspenderUsuario(1, 5, 'motivo')).rejects.toMatchObject({
      codigo: 'NO_SE_PUEDE_SUSPENDER_ADMIN',
    });
  });

  it('no permite dar de baja a un usuario con rol ADMIN', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue(usuarioFake({ roles: [vinculoRol(ROL_DB.ADMIN)] }));

    await expect(service.bajaUsuario(1, 5, 'motivo')).rejects.toMatchObject({
      codigo: 'NO_SE_PUEDE_BAJAR_ADMIN',
    });
  });
});

describe('gestionarRoles — último administrador', () => {
  it('rechaza con ULTIMO_ADMINISTRADOR si no queda otro admin activo', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue(usuarioFake({ roles: [vinculoRol(ROL_DB.ADMIN)] }));
    mockedRepo.buscarRolPorNombre.mockResolvedValue({ id: 1, nombre: ROL_DB.ADMIN } as never);
    mockedRepo.contarUsuariosActivosConRol.mockResolvedValue(0);

    await expect(
      service.gestionarRoles(2, 5, {
        agregar: [],
        quitar: ['ADMIN'],
        refugioId: undefined,
      } as never),
    ).rejects.toMatchObject({ codigo: 'ULTIMO_ADMINISTRADOR' });

    expect(mockedRepo.quitarRol).not.toHaveBeenCalled();
  });

  it('permite quitar ADMIN si queda otro admin activo', async () => {
    mockedRepo.buscarUsuario
      .mockResolvedValueOnce(usuarioFake({ roles: [vinculoRol(ROL_DB.ADMIN)] }))
      .mockResolvedValueOnce(usuarioFake({ roles: [] }));
    mockedRepo.buscarRolPorNombre.mockResolvedValue({ id: 1, nombre: ROL_DB.ADMIN } as never);
    mockedRepo.contarUsuariosActivosConRol.mockResolvedValue(1);
    mockedRepo.buscarVinculoRolActivo.mockResolvedValue({ id: 99 } as never);

    await service.gestionarRoles(2, 5, {
      agregar: [],
      quitar: ['ADMIN'],
      refugioId: undefined,
    } as never);

    expect(mockedRepo.quitarRol).toHaveBeenCalledWith(99, 2);
  });
});
