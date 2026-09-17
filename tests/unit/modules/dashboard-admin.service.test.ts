import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../../src/modules/dashboard-admin/dashboard-admin.repository';
import * as service from '../../../src/modules/dashboard-admin/dashboard-admin.service';

vi.mock('../../../src/modules/dashboard-admin/dashboard-admin.repository');

const ROLES = [
  { id: 1, nombre: 'Administrador' },
  { id: 2, nombre: 'Refugio' },
  { id: 3, nombre: 'Adoptante' },
];

const ESTADOS_MASCOTA = [
  { id: 1, nombre: 'Disponible' },
  { id: 2, nombre: 'En_Tratamiento' },
  { id: 3, nombre: 'Adoptado' },
  { id: 4, nombre: 'Fallecido' },
  { id: 5, nombre: 'En_Transito' },
];

const ESTADOS_SOLICITUD = [
  { id: 1, nombre: 'Pendiente' },
  { id: 2, nombre: 'En_Revision' },
  { id: 3, nombre: 'Aprobada' },
  { id: 4, nombre: 'Rechazada' },
  { id: 5, nombre: 'Cancelada' },
];

function conteo(_all: number) {
  return { _count: { _all } };
}

const AHORA = new Date();
const ESTE_MES = new Date(AHORA.getFullYear(), AHORA.getMonth(), 15);
const MES_PASADO = new Date(AHORA.getFullYear(), AHORA.getMonth() - 1, 10);

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(repo.listarRoles).mockResolvedValue(ROLES as never);
  vi.mocked(repo.listarEstadosMascota).mockResolvedValue(ESTADOS_MASCOTA as never);
  vi.mocked(repo.listarEstadosSolicitud).mockResolvedValue(ESTADOS_SOLICITUD as never);

  vi.mocked(repo.contarUsuariosPorRol).mockResolvedValue([
    { rolId: 2, ...conteo(1) },
    { rolId: 3, ...conteo(1) },
  ] as never);
  vi.mocked(repo.contarUsuariosActivos).mockResolvedValue(3);
  vi.mocked(repo.contarRefugiosVerificados).mockResolvedValue(1);
  vi.mocked(repo.contarMascotasPorEstado).mockResolvedValue([
    { estadoMascotaId: 1, ...conteo(2) },
    { estadoMascotaId: 2, ...conteo(1) },
    { estadoMascotaId: 3, ...conteo(1) },
    { estadoMascotaId: 4, ...conteo(1) },
    { estadoMascotaId: 5, ...conteo(1) },
  ] as never);
  vi.mocked(repo.contarPublicacionesActivas).mockResolvedValue(5);
  vi.mocked(repo.contarSolicitudesPorEstado).mockResolvedValue([
    { estadoSolicitudId: 1, ...conteo(1) },
    { estadoSolicitudId: 3, ...conteo(1) },
    { estadoSolicitudId: 4, ...conteo(1) },
    { estadoSolicitudId: 5, ...conteo(1) },
  ] as never); // En_Revision (id 2) sin filas — debe quedar en 0
  vi.mocked(repo.contarCampaniasActivas).mockResolvedValue(1);
  vi.mocked(repo.sumarMontoDonadoDeclarado).mockResolvedValue(95000);
  vi.mocked(repo.contarReportesPendientes).mockResolvedValue(2);
  vi.mocked(repo.listarFechasPublicacionesActivas).mockResolvedValue([
    { fechaAlta: ESTE_MES },
    { fechaAlta: ESTE_MES },
    { fechaAlta: MES_PASADO },
  ] as never);
  vi.mocked(repo.listarFechasSolicitudesAprobadas).mockResolvedValue([
    { fechaAlta: ESTE_MES },
  ] as never);
});

describe('obtenerDashboard — kpis', () => {
  it('junta los conteos base en un solo objeto', async () => {
    const dashboard = await service.obtenerDashboard();

    expect(dashboard.kpis).toEqual({
      usuariosActivos: 3,
      mascotasRegistradas: 6,
      refugiosVerificados: 1,
      publicacionesActivas: 5,
      adopcionesConcretadas: 1,
      campaniasActivas: 1,
      montoDonadoDeclarado: 95000,
      reportesPendientes: 2,
    });
  });

  it('adopcionesConcretadas sale de solicitudesPorEstado, no de otra fuente', async () => {
    vi.mocked(repo.contarSolicitudesPorEstado).mockResolvedValue([
      { estadoSolicitudId: 3, ...conteo(4) },
    ] as never);

    const dashboard = await service.obtenerDashboard();

    expect(dashboard.kpis.adopcionesConcretadas).toBe(4);
  });
});

describe('obtenerDashboard — desgloses', () => {
  it('completa con 0 los roles sin usuarios asignados (Administrador)', async () => {
    const dashboard = await service.obtenerDashboard();

    expect(dashboard.usuariosPorRol).toEqual({ Administrador: 0, Refugio: 1, Adoptante: 1 });
  });

  it('completa con 0 un estado de solicitud sin filas y calcula porcentaje sobre el total', async () => {
    const dashboard = await service.obtenerDashboard();

    expect(dashboard.solicitudesPorEstado).toEqual([
      { estado: 'Pendiente', cantidad: 1, porcentaje: 25 },
      { estado: 'En_Revision', cantidad: 0, porcentaje: 0 },
      { estado: 'Aprobada', cantidad: 1, porcentaje: 25 },
      { estado: 'Rechazada', cantidad: 1, porcentaje: 25 },
      { estado: 'Cancelada', cantidad: 1, porcentaje: 25 },
    ]);
  });

  it('el porcentaje es 0 en todos los estados si no hay ninguna solicitud (no divide por 0)', async () => {
    vi.mocked(repo.contarSolicitudesPorEstado).mockResolvedValue([] as never);

    const dashboard = await service.obtenerDashboard();

    expect(dashboard.solicitudesPorEstado.every((s) => s.porcentaje === 0)).toBe(true);
  });
});

describe('obtenerDashboard — publicacionesPorMes', () => {
  it('devuelve 6 meses en orden cronológico, con el mes actual al final', async () => {
    const dashboard = await service.obtenerDashboard();

    expect(dashboard.publicacionesPorMes).toHaveLength(6);
    expect(dashboard.publicacionesPorMes.at(-1)).toEqual({
      mes: expect.any(String),
      publicaciones: 2,
      adopciones: 1,
    });
  });

  it('el mes anterior al actual tiene sus publicaciones, sin adopciones', async () => {
    const dashboard = await service.obtenerDashboard();

    expect(dashboard.publicacionesPorMes.at(-2)).toEqual({
      mes: expect.any(String),
      publicaciones: 1,
      adopciones: 0,
    });
  });

  it('meses sin datos quedan en 0, no se omiten', async () => {
    const dashboard = await service.obtenerDashboard();

    expect(dashboard.publicacionesPorMes.slice(0, 4)).toEqual(
      Array.from({ length: 4 }, () => ({
        mes: expect.any(String),
        publicaciones: 0,
        adopciones: 0,
      })),
    );
  });
});

describe('exportarEntidad — paginado por cursor', () => {
  function usuario(id: number) {
    return {
      id,
      nombre: `Usuario${id}`,
      apellido: 'Apellido',
      email: `u${id}@test.com`,
      dni: `1000000${id}`,
      verificado: true,
      estado: { nombre: 'Activo' },
      fechaAlta: new Date('2026-01-01'),
    };
  }

  it('trae todas las filas iterando páginas hasta que una viene corta', async () => {
    // FILAS_POR_PAGINA es 500 en el service: para simular "página llena" sin sembrar 500
    // filas de fixture, la primera respuesta simula el límite (500 filas) y la segunda,
    // la página corta que corta el loop.
    const paginaLlena = Array.from({ length: 500 }, (_, i) => usuario(i + 1));
    const paginaCorta = [usuario(501)];

    vi.mocked(repo.paginaUsuariosParaExport)
      .mockResolvedValueOnce(paginaLlena as never)
      .mockResolvedValueOnce(paginaCorta as never);

    const { filas } = service.exportarEntidad('usuarios');
    const todas = [];
    for await (const fila of filas()) {
      todas.push(fila);
    }

    expect(todas).toHaveLength(501);
    expect(repo.paginaUsuariosParaExport).toHaveBeenCalledTimes(2);
    expect(repo.paginaUsuariosParaExport).toHaveBeenNthCalledWith(1, undefined, 500);
    expect(repo.paginaUsuariosParaExport).toHaveBeenNthCalledWith(2, 500, 500);
  });

  it('sin filas no llama al repository más de una vez', async () => {
    vi.mocked(repo.paginaUsuariosParaExport).mockResolvedValue([] as never);

    const { filas, headers } = service.exportarEntidad('usuarios');
    const todas = [];
    for await (const fila of filas()) {
      todas.push(fila);
    }

    expect(todas).toEqual([]);
    expect(headers).toEqual([
      'id',
      'nombre',
      'apellido',
      'email',
      'dni',
      'verificado',
      'estado',
      'fechaAlta',
    ]);
    expect(repo.paginaUsuariosParaExport).toHaveBeenCalledTimes(1);
  });

  it('mascotas sin estado vigente no rompen el export, van con estado vacío', async () => {
    const fechaAlta = new Date('2026-01-01');
    vi.mocked(repo.paginaMascotasParaExport)
      .mockResolvedValueOnce([
        {
          id: 1,
          nombre: 'Firulais',
          refugioId: 1,
          usuarioId: 2,
          fechaAlta,
          raza: { nombre: 'Mestizo', especie: { nombre: 'Perro' } },
          historicoEstados: [],
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const { filas } = service.exportarEntidad('mascotas');
    const todas = [];
    for await (const fila of filas()) {
      todas.push(fila);
    }

    expect(todas).toEqual([[1, 'Firulais', 'Perro', 'Mestizo', '', 1, 2, fechaAlta]]);
  });

  it('publicaciones exportan sus columnas en orden', async () => {
    const fechaAlta = new Date('2026-01-01');
    vi.mocked(repo.paginaPublicacionesParaExport)
      .mockResolvedValueOnce([
        {
          id: 1,
          titulo: 'Se busca hogar',
          mascotaId: 1,
          usuarioId: 2,
          ubicacion: 'Mendoza',
          fechaAlta,
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const { filas } = service.exportarEntidad('publicaciones');
    const todas = [];
    for await (const fila of filas()) {
      todas.push(fila);
    }

    expect(todas).toEqual([[1, 'Se busca hogar', 1, 2, 'Mendoza', fechaAlta]]);
  });

  it('solicitudes sin historial de estado no rompen el export, van con estado vacío', async () => {
    const fechaAlta = new Date('2026-01-01');
    vi.mocked(repo.paginaSolicitudesParaExport)
      .mockResolvedValueOnce([
        {
          id: 1,
          tipoSolicitud: { nombre: 'Adopcion' },
          publicacionId: 1,
          usuarioId: 2,
          fechaAlta,
          historicoEstados: [],
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const { filas } = service.exportarEntidad('solicitudes');
    const todas = [];
    for await (const fila of filas()) {
      todas.push(fila);
    }

    expect(todas).toEqual([[1, 'Adopcion', 1, 2, '', fechaAlta]]);
  });

  it('campanias con objetivo nulo no rompen el export, van con objetivo vacío', async () => {
    const fechaInicio = new Date('2026-01-01');
    const fechaFin = new Date('2026-06-01');
    vi.mocked(repo.paginaCampaniasParaExport)
      .mockResolvedValueOnce([
        {
          id: 1,
          titulo: 'Campaña sin objetivo',
          objetivo: null,
          estadoCampania: { nombre: 'Activa' },
          refugioId: 1,
          fechaInicio,
          fechaFin,
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const { filas } = service.exportarEntidad('campanias');
    const todas = [];
    for await (const fila of filas()) {
      todas.push(fila);
    }

    expect(todas).toEqual([[1, 'Campaña sin objetivo', '', 'Activa', 1, fechaInicio, fechaFin]]);
  });

  it('campanias con objetivo numérico lo serializa como string', async () => {
    const fechaInicio = new Date('2026-01-01');
    const fechaFin = new Date('2026-06-01');
    vi.mocked(repo.paginaCampaniasParaExport)
      .mockResolvedValueOnce([
        {
          id: 1,
          titulo: 'Campaña con objetivo',
          objetivo: { toString: () => '50000' },
          estadoCampania: { nombre: 'Activa' },
          refugioId: 1,
          fechaInicio,
          fechaFin,
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const { filas } = service.exportarEntidad('campanias');
    const todas = [];
    for await (const fila of filas()) {
      todas.push(fila);
    }

    expect(todas).toEqual([
      [1, 'Campaña con objetivo', '50000', 'Activa', 1, fechaInicio, fechaFin],
    ]);
  });
});
