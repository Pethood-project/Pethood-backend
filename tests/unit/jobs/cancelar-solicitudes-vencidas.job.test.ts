import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelarSolicitudesVencidas } from '../../../src/jobs/cancelar-solicitudes-vencidas.job';
import { USUARIO_SISTEMA_ID } from '../../../src/shared/auditoria';
import * as logAuditoria from '../../../src/shared/logAuditoria';
import * as repo from '../../../src/modules/solicitudes/solicitudes.repository';

vi.mock('../../../src/modules/solicitudes/solicitudes.repository');
vi.mock('../../../src/shared/logAuditoria');

const AHORA = new Date('2026-09-02T12:00:00.000Z');
const ESTADO_CANCELADA = { id: 5, nombre: 'Cancelada' };

function haceDias(dias: number): Date {
  return new Date(AHORA.getTime() - dias * 24 * 60 * 60 * 1000);
}

/** Fila de `listarSinRespuesta` tal como la devuelve Prisma. */
function solicitud(opciones: {
  id: number;
  estadoNombre: string;
  fechaAlta: Date;
  secuenciaDias: number;
  tipoNombre?: string;
}) {
  const { id, estadoNombre, fechaAlta, secuenciaDias, tipoNombre = 'Adopcion' } = opciones;

  return {
    id,
    tipoSolicitud: { nombre: tipoNombre, secuenciaDias },
    historicoEstados: [{ estadoSolicitud: { id: 1, nombre: estadoNombre }, fechaAlta }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repo.buscarEstadoSolicitudPorNombre).mockResolvedValue(ESTADO_CANCELADA as never);
  vi.mocked(repo.cancelarSiPendiente).mockResolvedValue(true as never);
});

it('tira si falta el estado "Cancelada" en el catálogo', async () => {
  vi.mocked(repo.buscarEstadoSolicitudPorNombre).mockResolvedValue(null as never);
  vi.mocked(repo.listarSinRespuesta).mockResolvedValue([] as never);

  await expect(cancelarSolicitudesVencidas(AHORA)).rejects.toThrow(
    'Falta el estado "Cancelada" en el catálogo EstadoSolicitud',
  );
});

describe('vencimiento', () => {
  it('cancela una Pendiente que superó secuenciaDias', async () => {
    vi.mocked(repo.listarSinRespuesta).mockResolvedValue([
      solicitud({ id: 1, estadoNombre: 'Pendiente', fechaAlta: haceDias(181), secuenciaDias: 180 }),
    ] as never);

    const cantidad = await cancelarSolicitudesVencidas(AHORA);

    expect(cantidad).toBe(1);
    expect(repo.cancelarSiPendiente).toHaveBeenCalledWith(
      1,
      ESTADO_CANCELADA.id,
      USUARIO_SISTEMA_ID,
    );
  });

  it('NO cancela una Pendiente que todavía no llegó a secuenciaDias', async () => {
    vi.mocked(repo.listarSinRespuesta).mockResolvedValue([
      solicitud({ id: 1, estadoNombre: 'Pendiente', fechaAlta: haceDias(179), secuenciaDias: 180 }),
    ] as never);

    const cantidad = await cancelarSolicitudesVencidas(AHORA);

    expect(cantidad).toBe(0);
    expect(repo.cancelarSiPendiente).not.toHaveBeenCalled();
  });

  it('justo en el límite (exactamente secuenciaDias) ya se considera vencida', async () => {
    vi.mocked(repo.listarSinRespuesta).mockResolvedValue([
      solicitud({ id: 1, estadoNombre: 'Pendiente', fechaAlta: haceDias(180), secuenciaDias: 180 }),
    ] as never);

    expect(await cancelarSolicitudesVencidas(AHORA)).toBe(1);
  });

  it('respeta secuenciaDias distinto por tipo (Transito con otra ventana)', async () => {
    vi.mocked(repo.listarSinRespuesta).mockResolvedValue([
      // Vencida para un tipo de 30 días, pero NO alcanzaría los 180 de Adopcion.
      solicitud({
        id: 1,
        estadoNombre: 'Pendiente',
        fechaAlta: haceDias(31),
        secuenciaDias: 30,
        tipoNombre: 'Transito',
      }),
    ] as never);

    expect(await cancelarSolicitudesVencidas(AHORA)).toBe(1);
  });

  it('NO cancela una solicitud que ya no está Pendiente (ej. En_Revision), aunque no tenga respuesta', async () => {
    vi.mocked(repo.listarSinRespuesta).mockResolvedValue([
      solicitud({
        id: 1,
        estadoNombre: 'En_Revision',
        fechaAlta: haceDias(300),
        secuenciaDias: 180,
      }),
    ] as never);

    const cantidad = await cancelarSolicitudesVencidas(AHORA);

    expect(cantidad).toBe(0);
    expect(repo.cancelarSiPendiente).not.toHaveBeenCalled();
  });

  it('cuenta varias solicitudes vencidas de una corrida', async () => {
    vi.mocked(repo.listarSinRespuesta).mockResolvedValue([
      solicitud({ id: 1, estadoNombre: 'Pendiente', fechaAlta: haceDias(200), secuenciaDias: 180 }),
      solicitud({ id: 2, estadoNombre: 'Pendiente', fechaAlta: haceDias(190), secuenciaDias: 180 }),
      solicitud({ id: 3, estadoNombre: 'Pendiente', fechaAlta: haceDias(10), secuenciaDias: 180 }),
    ] as never);

    expect(await cancelarSolicitudesVencidas(AHORA)).toBe(2);
  });
});

describe('carrera con una resolución humana', () => {
  it('si un refugio la resolvió un instante antes que el cron, no cuenta como cancelada ni audita', async () => {
    vi.mocked(repo.listarSinRespuesta).mockResolvedValue([
      solicitud({ id: 1, estadoNombre: 'Pendiente', fechaAlta: haceDias(200), secuenciaDias: 180 }),
    ] as never);
    vi.mocked(repo.cancelarSiPendiente).mockResolvedValue(false as never);

    const cantidad = await cancelarSolicitudesVencidas(AHORA);

    expect(cantidad).toBe(0);
    expect(logAuditoria.registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe('auditoría', () => {
  it('registra el detalle con el tipo y la ventana usada', async () => {
    vi.mocked(repo.listarSinRespuesta).mockResolvedValue([
      solicitud({
        id: 7,
        estadoNombre: 'Pendiente',
        fechaAlta: haceDias(200),
        secuenciaDias: 180,
        tipoNombre: 'Adopcion',
      }),
    ] as never);

    await cancelarSolicitudesVencidas(AHORA);

    expect(logAuditoria.registrarAuditoria).toHaveBeenCalledWith({
      usuarioId: USUARIO_SISTEMA_ID,
      accion: 'CANCELAR',
      entidad: 'Solicitud',
      entidadId: 7,
      detalle: 'Pendiente -> Cancelada (vencida, tipo=Adopcion, secuenciaDias=180)',
    });
  });
});
