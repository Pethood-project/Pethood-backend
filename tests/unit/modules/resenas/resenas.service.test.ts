import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../src/middlewares/errorHandler';

vi.mock('../../../../src/modules/resenas/resenas.repository', () => ({
  buscarUsuario: vi.fn(),
  buscarSolicitudConPartes: vi.fn(),
  buscarActivaDeAutor: vi.fn(),
  buscarResena: vi.fn(),
  crear: vi.fn(),
  darDeBaja: vi.fn(),
  listarDeUsuario: vi.fn(),
  listarDeRefugio: vi.fn(),
  listarTransaccionesDelActor: vi.fn(),
  listarSolicitudesResenadas: vi.fn(),
}));

vi.mock('../../../../src/shared/logAuditoria', () => ({
  registrarAuditoria: vi.fn().mockResolvedValue(undefined),
}));

import * as repo from '../../../../src/modules/resenas/resenas.repository';
import { crearResena, listarDeUsuario } from '../../../../src/modules/resenas/resenas.service';

const mockedRepo = vi.mocked(repo);

/** Transacción aprobada donde el actor (id 5) es el solicitante y el refugio (id 9) publicó. */
function solicitudAprobadaDeRefugio() {
  return {
    id: 42,
    usuarioId: 5,
    tipoSolicitud: { nombre: 'Adopcion' },
    usuario: { id: 5, nombre: 'Ana', apellido: 'Pérez', imagenUrl: null },
    publicacion: {
      mascota: {
        id: 3,
        nombre: 'Estrella',
        imagenUrl: null,
        refugioId: 9,
        refugio: { id: 9, nombre: 'Refugio Esperanza', imagenUrl: null },
        usuario: { id: 1, nombre: 'Bruno', apellido: 'Gómez', imagenUrl: null },
      },
    },
    historicoEstados: [{ estadoSolicitud: { nombre: 'Aprobada' } }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('crearResena', () => {
  it('registra la reseña del solicitante hacia el refugio y la marca con su flujo', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue({ id: 5, refugioId: null });
    mockedRepo.buscarSolicitudConPartes.mockResolvedValue(solicitudAprobadaDeRefugio() as never);
    mockedRepo.buscarActivaDeAutor.mockResolvedValue(null);
    mockedRepo.crear.mockResolvedValue({
      id: 100,
      puntuacion: 5,
      comentario: 'Muy atentos',
      fechaAlta: new Date('2026-09-27T12:00:00Z'),
      refugioReportadoId: 9,
      usuarioReportadoId: null,
      usuarioAutorId: 5,
      autor: { id: 5, nombre: 'Ana', apellido: 'Pérez', imagenUrl: null },
      solicitud: {
        usuarioId: 5,
        tipoSolicitud: { nombre: 'Adopcion' },
        publicacion: { mascota: { refugioId: 9 } },
      },
    } as never);

    const resena = await crearResena(
      { solicitudId: 42, puntuacion: 5, comentario: 'Muy atentos' },
      5,
    );

    expect(resena.receptor).toBe('REFUGIO');
    expect(resena.flujo).toBe('ADOPTANTE_A_REFUGIO');
    expect(mockedRepo.crear).toHaveBeenCalledWith(
      expect.objectContaining({ refugioReportadoId: 9, usuarioReportadoId: null, solicitudId: 42 }),
    );
  });

  it('rechaza una transacción que todavía no está aprobada', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue({ id: 5, refugioId: null });
    mockedRepo.buscarSolicitudConPartes.mockResolvedValue({
      ...solicitudAprobadaDeRefugio(),
      historicoEstados: [{ estadoSolicitud: { nombre: 'Pendiente' } }],
    } as never);

    await expect(
      crearResena({ solicitudId: 42, puntuacion: 5, comentario: null }, 5),
    ).rejects.toMatchObject({ codigo: 'TRANSACCION_NO_FINALIZADA' });
    expect(mockedRepo.crear).not.toHaveBeenCalled();
  });

  it('rechaza a quien no participó de la transacción', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue({ id: 77, refugioId: null });
    mockedRepo.buscarSolicitudConPartes.mockResolvedValue(solicitudAprobadaDeRefugio() as never);

    await expect(
      crearResena({ solicitudId: 42, puntuacion: 5, comentario: null }, 77),
    ).rejects.toBeInstanceOf(AppError);
    expect(mockedRepo.crear).not.toHaveBeenCalled();
  });

  it('rechaza una segunda reseña del mismo autor sobre la misma transacción', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue({ id: 5, refugioId: null });
    mockedRepo.buscarSolicitudConPartes.mockResolvedValue(solicitudAprobadaDeRefugio() as never);
    mockedRepo.buscarActivaDeAutor.mockResolvedValue({ id: 100 });

    await expect(
      crearResena({ solicitudId: 42, puntuacion: 4, comentario: null }, 5),
    ).rejects.toMatchObject({ codigo: 'RESENA_DUPLICADA' });
  });
});

describe('listarDeUsuario', () => {
  it('calcula promedio y desglose de las reseñas recibidas', async () => {
    mockedRepo.buscarUsuario.mockResolvedValue({ id: 5, refugioId: null });
    mockedRepo.listarDeUsuario.mockResolvedValue([
      {
        id: 1,
        puntuacion: 5,
        comentario: null,
        fechaAlta: new Date(),
        refugioReportadoId: null,
        usuarioReportadoId: 5,
        usuarioAutorId: 9,
        autor: { id: 9, nombre: 'Bruno', apellido: 'Gómez', imagenUrl: null },
        solicitud: null,
      },
      {
        id: 2,
        puntuacion: 4,
        comentario: null,
        fechaAlta: new Date(),
        refugioReportadoId: null,
        usuarioReportadoId: 5,
        usuarioAutorId: 9,
        autor: { id: 9, nombre: 'Bruno', apellido: 'Gómez', imagenUrl: null },
        solicitud: null,
      },
    ] as never);

    const resumen = await listarDeUsuario(5);

    expect(resumen.promedio).toBe(4.5);
    expect(resumen.cantidad).toBe(2);
    expect(resumen.distribucion.find((fila) => fila.puntuacion === 5)?.cantidad).toBe(1);
    expect(resumen.resenas).toHaveLength(2);
  });
});
