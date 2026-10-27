import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cerrarSolicitudesVencidas } from '../../../src/jobs/cancelar-solicitudes-vencidas.job';
import { USUARIO_SISTEMA_ID } from '../../../src/shared/auditoria';
import * as logAuditoria from '../../../src/shared/logAuditoria';
import * as notificaciones from '../../../src/modules/notificaciones/notificaciones.service';
import * as repo from '../../../src/modules/solicitudes/solicitudes.repository';

vi.mock('../../../src/modules/solicitudes/solicitudes.repository');
vi.mock('../../../src/modules/notificaciones/notificaciones.service');
vi.mock('../../../src/shared/logAuditoria');
// El service arrastra el chat, que abre conexiones: acá solo importa lo que el job le pide.
vi.mock('../../../src/modules/chats/chats.service');
vi.mock('../../../src/modules/favoritos/favoritos.service');

const AHORA = new Date('2026-09-02T12:00:00.000Z');
const ESTADO_CERRADA = { id: 7, nombre: 'Cerrada' };

function haceDias(dias: number): Date {
  return new Date(AHORA.getTime() - dias * 24 * 60 * 60 * 1000);
}

/**
 * Fila de `listarSinRespuestaConDetalle` tal como la devuelve Prisma. `desde` es cuándo
 * entró la solicitud en su estado vigente: es lo que cuenta el vencimiento.
 */
function solicitud(opciones: {
  id: number;
  estadoNombre: string;
  desde: Date;
  secuenciaDias: number;
  tipoNombre?: string;
}) {
  const { id, estadoNombre, desde, secuenciaDias, tipoNombre = 'Adopcion' } = opciones;

  return {
    id,
    usuarioId: 100,
    tipoSolicitud: { nombre: tipoNombre, secuenciaDias },
    historicoEstados: [{ estadoSolicitud: { id: 1, nombre: estadoNombre }, fechaAlta: desde }],
    publicacion: { id: 200, usuarioId: 300, mascota: { nombre: 'Rex', refugioId: null } },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repo.buscarEstadoSolicitudPorNombre).mockResolvedValue(ESTADO_CERRADA as never);
  vi.mocked(repo.transicionar).mockImplementation((id: number) =>
    Promise.resolve({
      id,
      usuarioId: 100,
      publicacion: { id: 200, usuarioId: 300, mascota: { nombre: 'Rex', refugioId: null } },
    } as never),
  );
});

describe('vencimiento', () => {
  it('cierra una Pendiente que superó secuenciaDias, con la causa y a nombre de SISTEMA', async () => {
    vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
      solicitud({ id: 1, estadoNombre: 'Pendiente', desde: haceDias(181), secuenciaDias: 180 }),
    ] as never);

    const cantidad = await cerrarSolicitudesVencidas(AHORA);

    expect(cantidad).toBe(1);
    expect(repo.transicionar).toHaveBeenCalledWith(1, {
      desde: ['Pendiente', 'En_Revision', 'Revisada'],
      estadoId: ESTADO_CERRADA.id,
      motivo: 'VENCIDA_SIN_RESPUESTA',
      usuarioId: USUARIO_SISTEMA_ID,
    });
  });

  it('NO cierra una que todavía no llegó a secuenciaDias', async () => {
    vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
      solicitud({ id: 1, estadoNombre: 'Pendiente', desde: haceDias(179), secuenciaDias: 180 }),
    ] as never);

    expect(await cerrarSolicitudesVencidas(AHORA)).toBe(0);
    expect(repo.transicionar).not.toHaveBeenCalled();
  });

  it('justo en el límite (exactamente secuenciaDias) ya se considera vencida', async () => {
    vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
      solicitud({ id: 1, estadoNombre: 'Pendiente', desde: haceDias(180), secuenciaDias: 180 }),
    ] as never);

    expect(await cerrarSolicitudesVencidas(AHORA)).toBe(1);
  });

  it('respeta secuenciaDias distinto por tipo (Transito con otra ventana)', async () => {
    vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
      // Vencida para un tipo de 30 días, pero NO alcanzaría los 180 de Adopcion.
      solicitud({
        id: 1,
        estadoNombre: 'Pendiente',
        desde: haceDias(31),
        secuenciaDias: 30,
        tipoNombre: 'Transito',
      }),
    ] as never);

    expect(await cerrarSolicitudesVencidas(AHORA)).toBe(1);
  });

  it.each(['En_Revision', 'Revisada'])(
    'también cierra una %s que lleva el plazo sin cambiar de estado',
    async (estadoNombre) => {
      vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
        solicitud({ id: 1, estadoNombre, desde: haceDias(300), secuenciaDias: 180 }),
      ] as never);

      expect(await cerrarSolicitudesVencidas(AHORA)).toBe(1);
    },
  );

  it('el plazo corre desde el último cambio de estado: una que se está moviendo no vence', async () => {
    vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
      // Llegó hace 300 días, pero se revisó hace 10: el reloj arrancó de nuevo.
      solicitud({ id: 1, estadoNombre: 'Revisada', desde: haceDias(10), secuenciaDias: 180 }),
    ] as never);

    expect(await cerrarSolicitudesVencidas(AHORA)).toBe(0);
  });

  it.each(['Aprobada', 'Rechazada', 'Cancelada', 'Cerrada'])(
    'NO toca una solicitud %s: ya terminó',
    async (estadoNombre) => {
      vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
        solicitud({ id: 1, estadoNombre, desde: haceDias(500), secuenciaDias: 180 }),
      ] as never);

      expect(await cerrarSolicitudesVencidas(AHORA)).toBe(0);
      expect(repo.transicionar).not.toHaveBeenCalled();
    },
  );

  it('cuenta varias solicitudes vencidas de una corrida', async () => {
    vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
      solicitud({ id: 1, estadoNombre: 'Pendiente', desde: haceDias(200), secuenciaDias: 180 }),
      solicitud({ id: 2, estadoNombre: 'Revisada', desde: haceDias(190), secuenciaDias: 180 }),
      solicitud({ id: 3, estadoNombre: 'Pendiente', desde: haceDias(10), secuenciaDias: 180 }),
    ] as never);

    expect(await cerrarSolicitudesVencidas(AHORA)).toBe(2);
  });

  it('falla si falta el estado "Cerrada" cuando hay algo para cerrar', async () => {
    vi.mocked(repo.buscarEstadoSolicitudPorNombre).mockResolvedValue(null as never);
    vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
      solicitud({ id: 1, estadoNombre: 'Pendiente', desde: haceDias(200), secuenciaDias: 180 }),
    ] as never);

    await expect(cerrarSolicitudesVencidas(AHORA)).rejects.toMatchObject({
      codigo: 'ERROR_INTERNO',
    });
  });
});

describe('carrera con una resolución humana', () => {
  it('si un refugio la resolvió un instante antes que el cron, no cuenta como cerrada ni audita', async () => {
    vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
      solicitud({ id: 1, estadoNombre: 'Pendiente', desde: haceDias(200), secuenciaDias: 180 }),
    ] as never);
    vi.mocked(repo.transicionar).mockResolvedValue(null as never);

    const cantidad = await cerrarSolicitudesVencidas(AHORA);

    expect(cantidad).toBe(0);
    expect(logAuditoria.registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe('auditoría y avisos', () => {
  beforeEach(() => {
    vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
      solicitud({ id: 7, estadoNombre: 'Pendiente', desde: haceDias(200), secuenciaDias: 180 }),
    ] as never);
  });

  it('registra el cierre a nombre de SISTEMA con su causa', async () => {
    await cerrarSolicitudesVencidas(AHORA);

    expect(logAuditoria.registrarAuditoria).toHaveBeenCalledWith({
      usuarioId: USUARIO_SISTEMA_ID,
      accion: 'CERRAR',
      entidad: 'Solicitud',
      entidadId: 7,
      detalle: 'Cerrada (VENCIDA_SIN_RESPUESTA)',
    });
  });

  it('le avisa al solicitante, sin culparlo, y a quien publicó', async () => {
    await cerrarSolicitudesVencidas(AHORA);

    const avisos = vi.mocked(notificaciones.notificar).mock.calls.map(([aviso]) => aviso);
    const alSolicitante = avisos.find((aviso) => aviso.usuarioId === 100);
    const alPublicador = avisos.find((aviso) => aviso.usuarioId === 300);

    expect(alSolicitante).toMatchObject({ tipo: 'SOLICITUD_CERRADA' });
    expect(alSolicitante?.mensaje).toContain('No es por vos');
    expect(alPublicador).toMatchObject({ tipo: 'SOLICITUD_CERRADA_VENCIDA' });
  });

  it('avisa 14 días antes que se va a cerrar sola, una sola vez por solicitud', async () => {
    vi.mocked(repo.listarSinRespuestaConDetalle).mockResolvedValue([
      solicitud({ id: 8, estadoNombre: 'Revisada', desde: haceDias(170), secuenciaDias: 180 }),
    ] as never);

    await cerrarSolicitudesVencidas(AHORA);

    expect(notificaciones.notificarUnaVez).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: 100,
        tipo: 'SOLICITUD_PROXIMA_A_VENCER',
        entidadId: 8,
      }),
    );
    expect(repo.transicionar).not.toHaveBeenCalled();
  });
});
