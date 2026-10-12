import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../src/middlewares/errorHandler';
import type { UsuarioPerfil } from '../../../../src/modules/usuarios/usuarios.repository';
import { ESTADO_USUARIO, ROL_API, ROL_DB } from '../../../../src/shared/roles';

vi.mock('../../../../src/modules/usuarios/usuarios.repository', () => ({
  buscarPerfil: vi.fn(),
  buscarPorEmail: vi.fn(),
  promedioValoracion: vi.fn(),
  contarMascotasDelAmbito: vi.fn(),
  actualizarPerfil: vi.fn(),
  actualizarUbicacion: vi.fn(),
  actualizarContrasena: vi.fn(),
  buscarHashContrasena: vi.fn(),
  buscarEstadoUsuarioPorNombre: vi.fn(),
  buscarEstadoSolicitudPorNombre: vi.fn(),
  darDeBajaCuenta: vi.fn(),
  guardarDni: vi.fn(),
  actualizarDocumentos: vi.fn(),
}));

// El servicio real encola en BullMQ y sin Redis (como en el CI) se cuelga.
vi.mock('../../../../src/modules/notificaciones/notificaciones.service');
vi.mock('../../../../src/shared/logAuditoria', () => ({
  registrarAuditoria: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/shared/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/shared/storage')>()),
  guardarImagen: vi.fn().mockResolvedValue('/api/v1/archivos/documentos-identidad/x.jpg'),
  borrarImagenes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/shared/imagenPerfil', () => ({
  persistirImagenPerfil: vi.fn(),
}));

import * as repo from '../../../../src/modules/usuarios/usuarios.repository';
import {
  actualizarPerfil,
  actualizarUbicacion,
  cambiarPassword,
  cargarDni,
  darDeBajaCuenta,
  obtenerPerfil,
  subirDocumentos,
} from '../../../../src/modules/usuarios/usuarios.service';
import * as imagenPerfil from '../../../../src/shared/imagenPerfil';

const mockedRepo = vi.mocked(repo);

function perfilFake(overrides: Partial<UsuarioPerfil> = {}): UsuarioPerfil {
  return {
    id: 10,
    nombre: 'Ana',
    apellido: 'Perez',
    email: 'ana@mail.com',
    contrasena: 'hash',
    telefono: '2615123456',
    dni: null,
    fechaNacimiento: new Date('1995-05-20'),
    googleId: null,
    verificado: false,
    imagenUrl: null,
    dniImagenUrl: null,
    selfieUrl: null,
    ubicacion: 'Palermo, CABA',
    refugioId: null,
    refugio: null,
    estadoId: 2,
    usuarioAlta: 1,
    fechaAlta: new Date(),
    usuarioModificacion: null,
    fechaModificacion: null,
    usuarioBaja: null,
    fechaBaja: null,
    estado: {
      id: 2,
      nombre: ESTADO_USUARIO.ACTIVO,
      descripcion: null,
      usuarioAlta: 1,
      fechaAlta: new Date(),
      usuarioModificacion: null,
      fechaModificacion: null,
      usuarioBaja: null,
      fechaBaja: null,
    },
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
    _count: { favoritos: 3 },
    ...overrides,
  };
}

describe('usuarios.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRepo.promedioValoracion.mockResolvedValue(4.8);
    mockedRepo.contarMascotasDelAmbito.mockResolvedValue(2);
  });

  it('devuelve el perfil propio con métricas', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(perfilFake());

    const perfil = await obtenerPerfil(10, 'PERSONAL');

    expect(perfil.roles).toEqual([ROL_API.ADOPTANTE]);
    expect(perfil.mascotas).toBe(2);
    expect(perfil.favoritos).toBe(3);
    expect(perfil.valoracion).toBe(4.8);
    expect(perfil.tienePassword).toBe(true);
  });

  it('cuenta las mascotas del perfil con el que se consulta (switch refugio/adoptante)', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(perfilFake());

    await obtenerPerfil(10, 'REFUGIO');

    expect(mockedRepo.contarMascotasDelAmbito).toHaveBeenCalledWith(
      expect.objectContaining({ id: 10 }),
      'REFUGIO',
    );
  });

  it('actualiza el perfil y persiste la foto', async () => {
    const actual = perfilFake();
    const actualizado = perfilFake({
      nombre: 'Anita',
      imagenUrl: '/api/v1/archivos/perfiles/a.jpg',
    });
    mockedRepo.buscarPerfil.mockResolvedValue(actual);
    mockedRepo.actualizarPerfil.mockResolvedValue(actualizado);
    vi.mocked(imagenPerfil.persistirImagenPerfil).mockResolvedValue(
      '/api/v1/archivos/perfiles/a.jpg',
    );

    const archivo = { buffer: Buffer.from('fake'), mimetype: 'image/jpeg' };
    const perfil = await actualizarPerfil(
      10,
      'PERSONAL',
      {
        nombre: 'Anita',
        apellido: 'Perez',
        email: 'ana@mail.com',
        telefono: '2615123456',
        ubicacion: 'Palermo, CABA',
      },
      archivo,
    );

    expect(imagenPerfil.persistirImagenPerfil).toHaveBeenCalledWith(archivo);
    expect(mockedRepo.actualizarPerfil).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ imagenUrl: '/api/v1/archivos/perfiles/a.jpg' }),
    );
    expect(perfil.nombre).toBe('Anita');
  });

  it('actualiza la ubicación desde un link de Maps y recalcula las coordenadas', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(perfilFake());
    mockedRepo.actualizarUbicacion.mockResolvedValue(perfilFake());

    await actualizarUbicacion(10, 'PERSONAL', 'https://www.google.com/maps?q=-32.889,-68.845');

    expect(mockedRepo.actualizarUbicacion).toHaveBeenCalledWith(10, {
      mapaUrl: 'https://www.google.com/maps?q=-32.889,-68.845',
      latitud: -32.889,
      longitud: -68.845,
    });
  });

  it('rechaza un link de mapa sin coordenadas', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(perfilFake());

    await expect(
      actualizarUbicacion(10, 'PERSONAL', 'https://www.google.com/'),
    ).rejects.toMatchObject({ codigo: 'LINK_MAPA_INVALIDO', httpStatus: 422 });
    expect(mockedRepo.actualizarUbicacion).not.toHaveBeenCalled();
  });

  it('rechaza cambiar el correo a uno ya usado por otro usuario', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(perfilFake());
    mockedRepo.buscarPorEmail.mockResolvedValue({ id: 99 });

    await expect(
      actualizarPerfil(10, 'PERSONAL', {
        nombre: 'Ana',
        apellido: 'Perez',
        email: 'otro@mail.com',
        telefono: '2615123456',
        ubicacion: 'Palermo, CABA',
      }),
    ).rejects.toMatchObject({ codigo: 'EMAIL_DUPLICADO', httpStatus: 409 });
  });

  it('cambiar password exige la actual si el usuario ya tiene una', async () => {
    mockedRepo.buscarHashContrasena.mockResolvedValue({ id: 10, contrasena: 'hash' });

    await expect(cambiarPassword(10, { passwordNueva: 'nuevaClave1' })).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('da de baja la cuenta y deja auditoría, también si el usuario es de Google', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(
      perfilFake({ googleId: 'google-abc', contrasena: null }),
    );
    mockedRepo.buscarEstadoUsuarioPorNombre.mockResolvedValue({ id: 4 } as never);
    mockedRepo.buscarEstadoSolicitudPorNombre.mockResolvedValue({ id: 5 } as never);
    mockedRepo.darDeBajaCuenta.mockResolvedValue(undefined);

    await darDeBajaCuenta(10);

    expect(mockedRepo.darDeBajaCuenta).toHaveBeenCalledWith(10, 4, 5);
  });

  it('no deja dar de baja una cuenta de administrador', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(
      perfilFake({
        roles: [
          {
            id: 1,
            usuarioId: 10,
            rolId: 1,
            usuarioAlta: 10,
            fechaAlta: new Date(),
            usuarioModificacion: null,
            fechaModificacion: null,
            usuarioBaja: null,
            fechaBaja: null,
            rol: {
              id: 1,
              nombre: ROL_DB.ADMIN,
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
      }),
    );

    await expect(darDeBajaCuenta(10)).rejects.toMatchObject({
      codigo: 'NO_SE_PUEDE_BAJAR_ADMIN',
      httpStatus: 403,
    });
    expect(mockedRepo.darDeBajaCuenta).not.toHaveBeenCalled();
  });
});

describe('cargarDni (spec 027)', () => {
  beforeEach(() => {
    mockedRepo.promedioValoracion.mockResolvedValue(null);
    mockedRepo.contarMascotasDelAmbito.mockResolvedValue(0);
  });

  it('sin DNI: lo guarda, audita y devuelve el perfil con el DNI', async () => {
    mockedRepo.buscarPerfil
      .mockResolvedValueOnce(perfilFake({ dni: null }))
      .mockResolvedValueOnce(perfilFake({ dni: '30123456' }));
    mockedRepo.guardarDni.mockResolvedValue(true);

    const perfil = await cargarDni(10, '30123456', 'PERSONAL');

    expect(mockedRepo.guardarDni).toHaveBeenCalledWith(10, '30123456');
    expect(perfil.dni).toBe('30123456');
  });

  it('con DNI ya cargado: DNI_YA_CARGADO y no guarda', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(perfilFake({ dni: '30123456' }));

    await expect(cargarDni(10, '40111222', 'PERSONAL')).rejects.toMatchObject({
      codigo: 'DNI_YA_CARGADO',
      httpStatus: 409,
    });
    expect(mockedRepo.guardarDni).not.toHaveBeenCalled();
  });

  it('si otro pedido lo cargó en el medio: DNI_YA_CARGADO', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(perfilFake({ dni: null }));
    mockedRepo.guardarDni.mockResolvedValue(false);

    await expect(cargarDni(10, '30123456', 'PERSONAL')).rejects.toMatchObject({
      codigo: 'DNI_YA_CARGADO',
    });
  });

  it('un DNI de otra cuenta: DNI_DUPLICADO', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(perfilFake({ dni: null }));
    mockedRepo.guardarDni.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
    );

    await expect(cargarDni(10, '30123456', 'PERSONAL')).rejects.toMatchObject({
      codigo: 'DNI_DUPLICADO',
      mensaje: 'Ya existe una cuenta con ese DNI.',
    });
  });
});

describe('subirDocumentos (spec 002.1)', () => {
  const archivo = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', size: 1 } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rechaza si no viene ningún archivo', async () => {
    await expect(subirDocumentos(10, {})).rejects.toMatchObject({ codigo: 'VALIDACION' });
    expect(mockedRepo.actualizarDocumentos).not.toHaveBeenCalled();
  });

  it('rechaza si la cuenta está suspendida', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(
      perfilFake({ estado: { ...perfilFake().estado, nombre: ESTADO_USUARIO.SUSPENDIDO } }),
    );

    await expect(subirDocumentos(10, { selfie: [archivo] })).rejects.toMatchObject({
      codigo: 'CUENTA_NO_ACTIVA',
    } satisfies Partial<AppError>);
  });

  it('rechaza (y no deja archivos) si la cuenta deja de calificar entre el chequeo y la escritura', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(perfilFake());
    mockedRepo.actualizarDocumentos.mockResolvedValue(null);

    await expect(subirDocumentos(10, { selfie: [archivo] })).rejects.toMatchObject({
      codigo: 'CUENTA_NO_ACTIVA',
    } satisfies Partial<AppError>);
  });

  it('guarda DNI y selfie sin tocar el estado ni `verificado`', async () => {
    mockedRepo.buscarPerfil.mockResolvedValue(perfilFake({ verificado: true }));
    mockedRepo.actualizarDocumentos.mockResolvedValue(
      perfilFake({
        dniImagenUrl: '/api/v1/archivos/documentos-identidad/x.jpg',
        selfieUrl: '/api/v1/archivos/documentos-identidad/x.jpg',
      }),
    );

    const resultado = await subirDocumentos(10, { dni_imagen: [archivo], selfie: [archivo] });

    expect(mockedRepo.actualizarDocumentos).toHaveBeenCalledWith(
      10,
      {
        dniImagenUrl: '/api/v1/archivos/documentos-identidad/x.jpg',
        selfieUrl: '/api/v1/archivos/documentos-identidad/x.jpg',
      },
      [ESTADO_USUARIO.PENDIENTE, ESTADO_USUARIO.ACTIVO],
    );
    // Namespace privado: la URL sale firmada.
    expect(resultado.dniImagenUrl).toContain('sig=');
  });
});
