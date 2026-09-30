import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../src/middlewares/errorHandler';
import type { RefugioConEstado } from '../../../../src/modules/perfil-refugio/perfil-refugio.repository';

vi.mock('../../../../src/modules/perfil-refugio/perfil-refugio.repository', () => ({
  buscarUsuario: vi.fn(),
  buscarRefugio: vi.fn(),
  contarMascotasEnRefugio: vi.fn(),
  contarAdopciones: vi.fn(),
  listarEstadosVigentesDeSolicitudes: vi.fn(),
  valoracionDelRefugio: vi.fn(),
  actualizarRefugio: vi.fn(),
  actualizarUbicacion: vi.fn(),
}));

vi.mock('../../../../src/shared/logAuditoria', () => ({
  registrarAuditoria: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../src/shared/imagenPerfil', () => ({
  persistirImagenPerfil: vi.fn(),
}));

vi.mock('../../../../src/shared/geocoding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/shared/geocoding')>();
  return { ...actual, geocodificarDireccion: vi.fn() };
});

import * as repo from '../../../../src/modules/perfil-refugio/perfil-refugio.repository';
import {
  actualizarPerfil,
  actualizarUbicacion,
  obtenerPerfil,
} from '../../../../src/modules/perfil-refugio/perfil-refugio.service';
import { geocodificarDireccion } from '../../../../src/shared/geocoding';
import * as imagenPerfil from '../../../../src/shared/imagenPerfil';
import { registrarAuditoria } from '../../../../src/shared/logAuditoria';

const mockedRepo = vi.mocked(repo);

function refugioFake(overrides: Partial<RefugioConEstado> = {}): RefugioConEstado {
  return {
    id: 7,
    nombre: 'Refugio Esperanza',
    provincia: null,
    localidad: null,
    calleAltura: null,
    mapaUrl: null,
    latitud: null,
    longitud: null,
    ubicacionVerificada: false,
    telefono: '+541144445678',
    email: 'esperanza@refugio.com',
    descripcion: 'Rescate y adopción responsable.',
    verificado: true,
    imagenUrl: null,
    estadoId: 2,
    usuarioAlta: 1,
    fechaAlta: new Date(),
    usuarioModificacion: null,
    fechaModificacion: null,
    usuarioBaja: null,
    fechaBaja: null,
    estado: {
      id: 2,
      nombre: 'Activo',
      descripcion: null,
      usuarioAlta: 1,
      fechaAlta: new Date(),
      usuarioModificacion: null,
      fechaModificacion: null,
      usuarioBaja: null,
      fechaBaja: null,
    },
    ...overrides,
  } as RefugioConEstado;
}

const BODY = {
  nombre: 'Refugio Esperanza Norte',
  telefono: null,
  email: 'norte@refugio.com',
  descripcion: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedRepo.buscarUsuario.mockResolvedValue({ id: 10, refugioId: 7 });
  mockedRepo.buscarRefugio.mockResolvedValue(refugioFake());
  mockedRepo.contarMascotasEnRefugio.mockResolvedValue(24);
  mockedRepo.contarAdopciones.mockResolvedValue(156);
  mockedRepo.listarEstadosVigentesDeSolicitudes.mockResolvedValue([
    'Pendiente',
    'En_Revision',
    'Aprobada',
    'Rechazada',
    'Pendiente',
  ]);
  mockedRepo.valoracionDelRefugio.mockResolvedValue({ promedio: 4.8333, cantidad: 89 });
});

describe('obtenerPerfil', () => {
  it('devuelve los datos del refugio del usuario, no los del usuario', async () => {
    const perfil = await obtenerPerfil(10);

    expect(mockedRepo.buscarRefugio).toHaveBeenCalledWith(7);
    expect(perfil).toMatchObject({
      id: 7,
      nombre: 'Refugio Esperanza',
      estado: 'Activo',
      puedeEditar: true,
    });
  });

  it('cuenta como abiertas solo las solicitudes Pendiente o En_Revision', async () => {
    const perfil = await obtenerPerfil(10);

    expect(perfil.estadisticas).toEqual({
      enRefugio: 24,
      adopciones: 156,
      solicitudesAbiertas: 3,
    });
  });

  it('redondea la valoración a un decimal y la deja en null sin reseñas', async () => {
    expect((await obtenerPerfil(10)).valoracion).toEqual({ promedio: 4.8, cantidad: 89 });

    mockedRepo.valoracionDelRefugio.mockResolvedValue({ promedio: null, cantidad: 0 });
    expect((await obtenerPerfil(10)).valoracion).toEqual({ promedio: null, cantidad: 0 });
  });

  it('403 SIN_REFUGIO si el usuario no pertenece a un refugio', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue({ id: 10, refugioId: null });

    await expect(obtenerPerfil(10)).rejects.toMatchObject({
      codigo: 'SIN_REFUGIO',
      httpStatus: 403,
    });
  });

  it('404 REFUGIO_NO_ENCONTRADO si el refugio está dado de baja', async () => {
    mockedRepo.buscarRefugio.mockResolvedValue(null);

    await expect(obtenerPerfil(10)).rejects.toBeInstanceOf(AppError);
    await expect(obtenerPerfil(10)).rejects.toMatchObject({ codigo: 'REFUGIO_NO_ENCONTRADO' });
  });
});

describe('actualizarPerfil', () => {
  it('actualiza el refugio del usuario y registra la auditoría', async () => {
    mockedRepo.actualizarRefugio.mockResolvedValue(refugioFake({ nombre: BODY.nombre }));

    const perfil = await actualizarPerfil(10, BODY);

    expect(mockedRepo.actualizarRefugio).toHaveBeenCalledWith(7, 10, {
      ...BODY,
      imagenUrl: undefined,
      mapaUrl: undefined,
      latitud: undefined,
      longitud: undefined,
    });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'EDITAR_PERFIL_REFUGIO',
        entidad: 'Refugio',
        entidadId: 7,
      }),
    );
    expect(perfil.nombre).toBe(BODY.nombre);
  });

  it('persiste la foto nueva cuando viene una', async () => {
    vi.mocked(imagenPerfil.persistirImagenPerfil).mockResolvedValue('/archivos/perfiles/r.webp');
    mockedRepo.actualizarRefugio.mockResolvedValue(refugioFake());

    await actualizarPerfil(10, BODY, {
      buffer: Buffer.from(''),
      mimetype: 'image/webp',
      originalname: 'r.webp',
      size: 0,
    } as never);

    expect(mockedRepo.actualizarRefugio).toHaveBeenCalledWith(
      7,
      10,
      expect.objectContaining({ imagenUrl: '/archivos/perfiles/r.webp' }),
    );
  });

  it('no toca nada si el usuario no pertenece a un refugio', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue({ id: 10, refugioId: null });

    await expect(actualizarPerfil(10, BODY)).rejects.toMatchObject({ codigo: 'SIN_REFUGIO' });
    expect(mockedRepo.actualizarRefugio).not.toHaveBeenCalled();
  });

  it('geocodifica la dirección y persiste coordenadas + URL de Maps', async () => {
    const conDireccion = {
      ...BODY,
      provincia: 'Mendoza',
      localidad: 'Godoy Cruz',
      calleAltura: 'San Martín 123',
    };
    vi.mocked(geocodificarDireccion).mockResolvedValue({
      latitud: -32.889,
      longitud: -68.845,
      mapaUrl: 'https://www.google.com/maps?q=-32.889,-68.845',
    });
    mockedRepo.actualizarRefugio.mockResolvedValue(refugioFake());

    await actualizarPerfil(10, conDireccion);

    expect(geocodificarDireccion).toHaveBeenCalledWith({
      calleAltura: 'San Martín 123',
      localidad: 'Godoy Cruz',
      provincia: 'Mendoza',
    });
    expect(mockedRepo.actualizarRefugio).toHaveBeenCalledWith(
      7,
      10,
      expect.objectContaining({
        mapaUrl: 'https://www.google.com/maps?q=-32.889,-68.845',
        latitud: -32.889,
        longitud: -68.845,
      }),
    );
  });

  it('422 DIRECCION_NO_GEOCODIFICADA si la dirección completa no se pudo ubicar', async () => {
    const conDireccion = {
      ...BODY,
      provincia: 'Mendoza',
      localidad: 'Godoy Cruz',
      calleAltura: 'San Martín 123',
    };
    vi.mocked(geocodificarDireccion).mockResolvedValue(null);

    await expect(actualizarPerfil(10, conDireccion)).rejects.toMatchObject({
      codigo: 'DIRECCION_NO_GEOCODIFICADA',
      httpStatus: 422,
    });
    expect(mockedRepo.actualizarRefugio).not.toHaveBeenCalled();
  });

  it('actualiza la ubicación desde un link de Maps y recalcula las coordenadas', async () => {
    mockedRepo.actualizarUbicacion.mockResolvedValue(refugioFake());

    await actualizarUbicacion(10, 'https://www.google.com/maps?q=-32.889,-68.845');

    expect(mockedRepo.actualizarUbicacion).toHaveBeenCalledWith(7, 10, {
      mapaUrl: 'https://www.google.com/maps?q=-32.889,-68.845',
      latitud: -32.889,
      longitud: -68.845,
    });
  });

  it('rechaza un link de mapa sin coordenadas', async () => {
    await expect(actualizarUbicacion(10, 'https://www.google.com/')).rejects.toMatchObject({
      codigo: 'LINK_MAPA_INVALIDO',
      httpStatus: 422,
    });
    expect(mockedRepo.actualizarUbicacion).not.toHaveBeenCalled();
  });
});
