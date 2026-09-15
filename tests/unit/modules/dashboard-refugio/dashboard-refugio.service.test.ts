import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../src/middlewares/errorHandler';

vi.mock('../../../../src/modules/dashboard-refugio/dashboard-refugio.repository', () => ({
  buscarUsuarioConRefugio: vi.fn(),
  buscarRefugio: vi.fn(),
  contarMascotasEnRefugio: vi.fn(),
  listarEstadosSolicitud: vi.fn(),
  contarSolicitudesPorEstado: vi.fn(),
  contarSolicitudesCreadas: vi.fn(),
  listarDonaciones: vi.fn(),
  sumarObjetivoCampaniasActivas: vi.fn(),
  paginaSolicitudesParaExport: vi.fn(),
  listarEstadosMascota: vi.fn(),
  contarMascotasPorEstado: vi.fn(),
  listarPublicacionesActivas: vi.fn(),
  listarSolicitudesAbiertas: vi.fn(),
}));

import * as repo from '../../../../src/modules/dashboard-refugio/dashboard-refugio.repository';
import { obtenerDashboard } from '../../../../src/modules/dashboard-refugio/dashboard-refugio.service';

const mockedRepo = vi.mocked(repo);

const ESTADOS_SOLICITUD = [
  { id: 1, nombre: 'Pendiente' },
  { id: 2, nombre: 'En_Revision' },
  { id: 3, nombre: 'Aprobada' },
  { id: 4, nombre: 'Rechazada' },
  { id: 5, nombre: 'Cancelada' },
];

const ESTADOS_MASCOTA = [
  { id: 1, nombre: 'Disponible' },
  { id: 2, nombre: 'En_Tratamiento' },
  { id: 3, nombre: 'En_Transito' },
  { id: 4, nombre: 'Adoptado' },
  { id: 5, nombre: 'Fallecido' },
];

const PERIODO = { desde: '2026-03', hasta: '2026-08' };

beforeEach(() => {
  vi.clearAllMocks();
  mockedRepo.buscarUsuarioConRefugio.mockResolvedValue({
    id: 10,
    refugioId: 1,
  } as never);
  mockedRepo.buscarRefugio.mockResolvedValue({
    id: 1,
    nombre: 'Refugio Patitas',
    direccion: 'Av. Siempre Viva 123',
  } as never);
  mockedRepo.contarMascotasEnRefugio.mockResolvedValue(0);
  mockedRepo.listarEstadosSolicitud.mockResolvedValue(ESTADOS_SOLICITUD as never);
  mockedRepo.contarSolicitudesPorEstado.mockResolvedValue([] as never);
  mockedRepo.contarSolicitudesCreadas.mockResolvedValue(0);
  mockedRepo.listarDonaciones.mockResolvedValue([] as never);
  mockedRepo.sumarObjetivoCampaniasActivas.mockResolvedValue(0);
  mockedRepo.listarEstadosMascota.mockResolvedValue(ESTADOS_MASCOTA as never);
  mockedRepo.contarMascotasPorEstado.mockResolvedValue([] as never);
  mockedRepo.listarPublicacionesActivas.mockResolvedValue([] as never);
  mockedRepo.listarSolicitudesAbiertas.mockResolvedValue([] as never);
});

describe('obtenerDashboard', () => {
  it('lanza SIN_REFUGIO si el usuario no tiene refugio asignado', async () => {
    mockedRepo.buscarUsuarioConRefugio.mockResolvedValue({ id: 10, refugioId: null } as never);

    await expect(obtenerDashboard(10, PERIODO)).rejects.toMatchObject({
      codigo: 'SIN_REFUGIO',
    } satisfies Partial<AppError>);
  });

  it('lanza NO_ENCONTRADO si el usuario no existe', async () => {
    mockedRepo.buscarUsuarioConRefugio.mockResolvedValue(null);

    await expect(obtenerDashboard(10, PERIODO)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
    } satisfies Partial<AppError>);
  });

  it('usa direccion del refugio como localidad y arma kpis en 0 sin datos', async () => {
    const dashboard = await obtenerDashboard(10, PERIODO);

    expect(dashboard.refugio).toEqual({
      nombre: 'Refugio Patitas',
      localidad: 'Av. Siempre Viva 123',
    });
    expect(dashboard.kpis).toEqual({
      animalesAdoptados: 0,
      solicitudesCreadas: 0,
      animalesEnRefugio: 0,
      montoDonado: 0,
      objetivoDonaciones: 0,
      solicitudesDemoradas: 0,
    });
    expect(dashboard.mascotasPorEstado).toEqual({
      Disponible: 0,
      En_Tratamiento: 0,
      En_Transito: 0,
      Adoptado: 0,
      Fallecido: 0,
    });
    expect(dashboard.publicacionesPorAntiguedad).toEqual({
      '0-15 días': 0,
      '15-30 días': 0,
      '30-60 días': 0,
      '+60 días': 0,
    });
    expect(dashboard.solicitudesDemoradasDetalle).toEqual([]);
    expect(dashboard.publicacionesDemasiadoAntiguas).toEqual([]);
  });

  it('arma el porcentaje de solicitudesPorEstado a partir de contarSolicitudesPorEstado', async () => {
    mockedRepo.contarSolicitudesPorEstado.mockResolvedValue([
      { estadoSolicitudId: 3, _count: { _all: 4 } },
      { estadoSolicitudId: 1, _count: { _all: 1 } },
    ] as never);

    const dashboard = await obtenerDashboard(10, PERIODO);

    const aprobada = dashboard.solicitudesPorEstado.find((s) => s.estado === 'Aprobada');
    expect(aprobada).toEqual({ estado: 'Aprobada', cantidad: 4, porcentaje: 80 });
  });

  it('agrupa donaciones por mes calendario dentro del período, con objetivo constante', async () => {
    mockedRepo.sumarObjetivoCampaniasActivas.mockResolvedValue(60000);
    mockedRepo.listarDonaciones.mockResolvedValue([
      { fechaAlta: new Date(2026, 2, 10), monto: 5000 },
      { fechaAlta: new Date(2026, 2, 20), monto: 3000 },
      { fechaAlta: new Date(2026, 7, 1), monto: 7000 },
    ] as never);

    const dashboard = await obtenerDashboard(10, PERIODO);

    expect(dashboard.donacionesPorMes).toHaveLength(6);
    expect(dashboard.donacionesPorMes[0]).toEqual({
      mes: 'Mar 2026',
      monto: 8000,
      objetivo: 60000,
    });
    expect(dashboard.donacionesPorMes[5]).toEqual({
      mes: 'Ago 2026',
      monto: 7000,
      objetivo: 60000,
    });
    expect(dashboard.kpis.montoDonado).toBe(15000);
    expect(dashboard.kpis.objetivoDonaciones).toBe(60000);
  });

  it('calcula mascotasPorEstado y kpis.animalesAdoptados a partir de contarMascotasPorEstado (snapshot, no de solicitudes)', async () => {
    mockedRepo.contarMascotasPorEstado.mockResolvedValue([
      { estadoMascotaId: 1, _count: { _all: 2 } },
      { estadoMascotaId: 4, _count: { _all: 5 } },
    ] as never);
    // Ninguna solicitud "Aprobada" en el período: animalesAdoptados NO debe salir de acá.
    mockedRepo.contarSolicitudesPorEstado.mockResolvedValue([] as never);

    const dashboard = await obtenerDashboard(10, PERIODO);

    expect(dashboard.mascotasPorEstado).toEqual({
      Disponible: 2,
      En_Tratamiento: 0,
      En_Transito: 0,
      Adoptado: 5,
      Fallecido: 0,
    });
    expect(dashboard.kpis.animalesAdoptados).toBe(5);
  });

  it('agrupa publicacionesPorAntiguedad en buckets y lista las de más de 60 días, más antiguas primero', async () => {
    const hoy = new Date();
    const diasAtras = (dias: number) => new Date(hoy.getTime() - dias * 86_400_000);
    mockedRepo.listarPublicacionesActivas.mockResolvedValue([
      { id: 1, fechaAlta: diasAtras(2), mascota: { nombre: 'Kiwi' } },
      { id: 2, fechaAlta: diasAtras(20), mascota: { nombre: 'Manchas' } },
      { id: 3, fechaAlta: diasAtras(45), mascota: { nombre: 'Simba' } },
      { id: 4, fechaAlta: diasAtras(70), mascota: { nombre: 'Coco' } },
      { id: 5, fechaAlta: diasAtras(90), mascota: { nombre: 'Pipo' } },
    ] as never);

    const dashboard = await obtenerDashboard(10, PERIODO);

    expect(dashboard.publicacionesPorAntiguedad).toEqual({
      '0-15 días': 1,
      '15-30 días': 1,
      '30-60 días': 1,
      '+60 días': 2,
    });
    expect(dashboard.publicacionesDemasiadoAntiguas).toEqual([
      { id: 5, mascota: 'Pipo', dias: 90 },
      { id: 4, mascota: 'Coco', dias: 70 },
    ]);
  });

  it('lista solo las solicitudes abiertas demoradas más de UMBRAL_DEMORA_DIAS, más antiguas primero', async () => {
    const hoy = new Date();
    const diasAtras = (dias: number) => new Date(hoy.getTime() - dias * 86_400_000);
    mockedRepo.listarSolicitudesAbiertas.mockResolvedValue([
      {
        id: 1,
        publicacion: { mascota: { nombre: 'Firulais' } },
        historicoEstados: [{ fechaAlta: diasAtras(2), estadoSolicitud: { nombre: 'Pendiente' } }],
      },
      {
        id: 2,
        publicacion: { mascota: { nombre: 'Michi' } },
        historicoEstados: [
          { fechaAlta: diasAtras(12), estadoSolicitud: { nombre: 'En_Revision' } },
        ],
      },
      {
        id: 3,
        publicacion: { mascota: { nombre: 'Rocky' } },
        historicoEstados: [{ fechaAlta: diasAtras(20), estadoSolicitud: { nombre: 'Aprobada' } }],
      },
    ] as never);

    const dashboard = await obtenerDashboard(10, PERIODO);

    expect(dashboard.kpis.solicitudesDemoradas).toBe(1);
    expect(dashboard.solicitudesDemoradasDetalle).toEqual([{ id: 2, mascota: 'Michi', dias: 12 }]);
  });
});
