/**
 * Integración: crear una solicitud de adopción dispara una notificación real al publicador
 * (HU-4.2, spec 004). Mismo criterio que el resto de `tests/integration/`: se mockea SOLO el
 * repository de cada módulo — `solicitudes.service`, `notificaciones.service` y
 * `notificaciones.repository` (la escritura final) son el código real. Así se prueba la
 * integración real entre los dos módulos (el cross-import de servicios) sin necesitar base
 * de datos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as solicitudesRepo from '../../../src/modules/solicitudes/solicitudes.repository';
import * as solicitudesService from '../../../src/modules/solicitudes/solicitudes.service';
import * as notificacionesRepo from '../../../src/modules/notificaciones/notificaciones.repository';
import * as chatsRepo from '../../../src/modules/chats/chats.repository';

vi.mock('../../../src/modules/solicitudes/solicitudes.repository');
vi.mock('../../../src/modules/notificaciones/notificaciones.repository');
vi.mock('../../../src/modules/chats/chats.repository');
vi.mock('../../../src/shared/logAuditoria');

const SOLICITANTE = 7;
const PUBLICADOR = 20;
const REFUGIO_ID = 1;
const MIEMBRO_REFUGIO_A = 5;
const MIEMBRO_REFUGIO_B = 6;

const NUEVA = {
  publicacionId: 40,
  tipoSolicitud: 'Adopcion' as const,
  motivacion: 'Tengo experiencia con la raza y patio grande.',
  fechaInicioTransito: null,
  fechaFinTransito: null,
  hogar: {
    direccion: 'Av. Siempre Viva 742',
    tipoVivienda: 'Casa' as const,
    espacioExterior: 'Patio' as const,
    tieneMascotas: false,
    detalleMascotas: null,
    tieneNinios: false,
    experienciaPrevia: true,
    horasSolo: 4 as const,
    descripcion: null,
  },
};

function solicitudCreada(mascotaRefugioId: number | null) {
  return {
    id: 99,
    publicacionId: NUEVA.publicacionId,
    usuarioId: SOLICITANTE,
    motivacion: NUEVA.motivacion,
    comentario: null,
    fechaInicioTransito: null,
    fechaFinTransito: null,
    fechaAlta: new Date('2026-09-01T12:00:00.000Z'),
    fechaRespuesta: null,
    hogar: null,
    usuario: { id: SOLICITANTE, nombre: 'Ana', apellido: 'Pérez', hogares: [] },
    publicacion: {
      id: NUEVA.publicacionId,
      usuarioId: PUBLICADOR,
      mascota: { id: 8, nombre: 'Toby', imagenUrl: null, refugioId: mascotaRefugioId },
    },
    tipoSolicitud: { nombre: 'Adopcion' },
    historicoEstados: [
      { estadoSolicitud: { id: 1, nombre: 'Pendiente' }, fechaAlta: new Date('2026-09-01T12:00:00.000Z') },
    ],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(solicitudesRepo.buscarUsuarioConRefugio).mockResolvedValue({
    id: SOLICITANTE,
    refugioId: null,
    fechaBaja: null,
    verificado: true,
  } as never);
  vi.mocked(solicitudesRepo.contarPendientesDeUsuario).mockResolvedValue(0);
  vi.mocked(solicitudesRepo.buscarVivaDeUsuarioEnPublicacion).mockResolvedValue(null as never);
  vi.mocked(solicitudesRepo.buscarTipoSolicitudPorNombre).mockResolvedValue({ id: 1 } as never);
  vi.mocked(solicitudesRepo.buscarEstadoSolicitudPorNombre).mockResolvedValue({ id: 1 } as never);
  vi.mocked(chatsRepo.buscarChatEntre).mockResolvedValue(null as never);
  vi.mocked(notificacionesRepo.crear).mockImplementation(
    (datos) =>
      Promise.resolve({
        id: 1,
        tipo: datos.tipo,
        mensaje: datos.mensaje,
        leido: false,
        entidadTipo: datos.entidadTipo ?? null,
        entidadId: datos.entidadId ?? null,
        fechaAlta: new Date(),
      }) as never,
  );
  vi.mocked(notificacionesRepo.contarNoLeidas).mockResolvedValue(0);
});

describe('crear una solicitud notifica al publicador (HU-4.2)', () => {
  it('mascota de un refugio: se guarda una notificación en bandeja para CADA miembro activo', async () => {
    vi.mocked(solicitudesRepo.buscarPublicacionParaSolicitar).mockResolvedValue({
      mascota: { usuarioId: null, refugioId: REFUGIO_ID, historicoEstados: [{ estadoMascota: { nombre: 'Disponible' } }] },
      historicoEstados: [{ estadoPublicacion: { nombre: 'Activa' } }],
    } as never);
    vi.mocked(solicitudesRepo.crearConHogar).mockResolvedValue(
      solicitudCreada(REFUGIO_ID) as never,
    );
    vi.mocked(solicitudesRepo.listarIdsMiembrosDeRefugio).mockResolvedValue([
      { id: MIEMBRO_REFUGIO_A },
      { id: MIEMBRO_REFUGIO_B },
    ] as never);

    await solicitudesService.crearSolicitud(NUEVA, SOLICITANTE);

    expect(notificacionesRepo.crear).toHaveBeenCalledTimes(2);
    expect(notificacionesRepo.crear).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: MIEMBRO_REFUGIO_A,
        tipo: 'SOLICITUD_NUEVA',
        entidadTipo: 'SOLICITUD',
        entidadId: 99,
        mensaje: expect.stringContaining('Ana Pérez'),
      }),
    );
    expect(notificacionesRepo.crear).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: MIEMBRO_REFUGIO_B }),
    );
  });

  it('mascota personal (sin refugio): se avisa solo a quien publicó', async () => {
    vi.mocked(solicitudesRepo.buscarPublicacionParaSolicitar).mockResolvedValue({
      mascota: { usuarioId: PUBLICADOR, refugioId: null, historicoEstados: [{ estadoMascota: { nombre: 'Disponible' } }] },
      historicoEstados: [{ estadoPublicacion: { nombre: 'Activa' } }],
    } as never);
    vi.mocked(solicitudesRepo.crearConHogar).mockResolvedValue(solicitudCreada(null) as never);

    await solicitudesService.crearSolicitud(NUEVA, SOLICITANTE);

    expect(notificacionesRepo.crear).toHaveBeenCalledTimes(1);
    expect(notificacionesRepo.crear).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: PUBLICADOR, tipo: 'SOLICITUD_NUEVA' }),
    );
    // Sin refugio, no hace falta resolver miembros.
    expect(solicitudesRepo.listarIdsMiembrosDeRefugio).not.toHaveBeenCalled();
  });
});
