import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLAGS } from '../../../src/config/flags';
import { AppError } from '../../../src/middlewares/errorHandler';
import * as logAuditoria from '../../../src/shared/logAuditoria';
import * as chats from '../../../src/modules/chats/chats.service';
import * as favoritos from '../../../src/modules/favoritos/favoritos.service';
import * as notificaciones from '../../../src/modules/notificaciones/notificaciones.service';
import * as preguntasAdopcion from '../../../src/modules/preguntas-adopcion/preguntas-adopcion.service';
import * as repo from '../../../src/modules/solicitudes/solicitudes.repository';
import * as service from '../../../src/modules/solicitudes/solicitudes.service';

vi.mock('../../../src/modules/solicitudes/solicitudes.repository');
vi.mock('../../../src/shared/logAuditoria');
// Avisos: el servicio real encola en BullMQ y consulta la base, y estos tests no los usan.
vi.mock('../../../src/modules/notificaciones/notificaciones.service');
vi.mock('../../../src/modules/favoritos/favoritos.service');
vi.mock('../../../src/modules/chats/chats.service');
vi.mock('../../../src/modules/preguntas-adopcion/preguntas-adopcion.service');

afterEach(() => {
  FLAGS.EXIGIR_VERIFICACION_PARA_SOLICITAR = false;
});

const REFUGIO_ID = 1;
const OTRO_REFUGIO_ID = 2;
const MIEMBRO_REFUGIO = 5;
const OTRO_MIEMBRO_MISMO_REFUGIO = 6;
const ADOPTANTE_PUBLICADOR = 20;
const OTRO_ADOPTANTE = 21;
const SOLICITANTE = 7;
const SOLICITUD = 12;
const HOGAR_DECLARADO = 30;

const FECHA_ALTA = new Date('2026-08-20T12:00:00.000Z');
const FECHA_RESPUESTA = new Date('2026-09-02T18:00:00.000Z');

function estado(id: number, nombre: string) {
  return { id, nombre };
}

/** Fila de Solicitud_Estado tal como la devuelve Prisma, más nueva primero. */
function historialFila(
  estadoObj: { id: number; nombre: string },
  fechaAlta: Date,
  motivo: string | null = null,
) {
  return { estadoSolicitud: estadoObj, fechaAlta, motivo };
}

/** `usuario` tal como lo devuelve `buscarUsuarioConRefugio`. */
function usuario(id: number, refugioId: number | null) {
  return { id, refugioId, fechaBaja: null };
}

/**
 * Solicitud con detalle tal como la devuelve `buscarConDetalle`/`transicionar`.
 * `mascotaRefugioId` null = mascota publicada por un adoptante particular
 * (`mascotaUsuarioId` es quien la publicó); no nulo = mascota de un refugio.
 */
function solicitudConDetalle(opciones: {
  mascotaRefugioId?: number | null;
  mascotaUsuarioId?: number;
  historial: { estado: { id: number; nombre: string }; fecha: Date; motivo?: string | null }[];
  comentario?: string | null;
  fechaRespuesta?: Date | null;
  /** Período de tránsito. Nulo en una adopción, que no lo tiene. */
  transito?: { inicio: Date; fin: Date } | null;
  /** Hogar declarado al enviar. Vacío en las solicitudes anteriores a HU-7.1. */
  conHogar?: boolean;
  /**
   * Hogar vigente HOY, si el solicitante se mudó después de enviar. Sin esto, el vigente es
   * el mismo que declaró y no hay cambio que avisar.
   */
  hogarVigente?: { id: number; direccion: string; fechaAlta: Date };
}) {
  const {
    mascotaRefugioId = REFUGIO_ID,
    mascotaUsuarioId = MIEMBRO_REFUGIO,
    historial,
    comentario = null,
    fechaRespuesta = null,
    transito = null,
    conHogar = true,
    hogarVigente,
  } = opciones;

  const declarado = conHogar ? hogar() : null;
  // Sin mudanza, el vigente y el declarado son la MISMA fila: mismo id.
  const vigente = hogarVigente ? { ...hogar(), ...hogarVigente } : declarado;

  return {
    id: SOLICITUD,
    publicacionId: 40,
    usuarioId: SOLICITANTE,
    motivacion: 'Tengo patio grande y experiencia con la raza.',
    comentario,
    fechaInicioTransito: transito?.inicio ?? null,
    fechaFinTransito: transito?.fin ?? null,
    fechaAlta: FECHA_ALTA,
    fechaRespuesta,
    publicacion: {
      requisitos: ['Casa con patio', 'Sin otros perros'],
      usuario: { id: mascotaUsuarioId, nombre: 'Carla', apellido: 'Gómez', imagenUrl: null },
      mascota: {
        refugio: mascotaRefugioId
          ? {
              id: mascotaRefugioId,
              nombre: 'Refugio Patitas',
              imagenUrl: '/api/v1/archivos/logo.jpg',
            }
          : null,
        id: 8,
        nombre: 'Toby',
        fechaNacimiento: new Date('2023-04-01T00:00:00.000Z'),
        genero: 'MACHO',
        peso: 12.5,
        tamanio: 'MEDIANO',
        castrado: true,
        descripcion: 'Muy jugueton',
        imagenUrl: '/img/toby.jpg',
        razaId: 4,
        refugioId: mascotaRefugioId,
        usuarioId: mascotaUsuarioId,
      },
    },
    // Lo que se declaró al enviar: es lo que el refugio evaluó.
    hogar: declarado,
    usuario: {
      id: SOLICITANTE,
      nombre: 'Ana',
      apellido: 'Pérez',
      imagenUrl: null,
      localidad: 'Godoy Cruz',
      provincia: 'Mendoza',
      verificado: true,
      fechaAlta: new Date('2026-03-02T12:00:00.000Z'),
      // `take: 1` sobre los hogares activos: un usuario tiene uno solo vigente.
      hogares: vigente ? [vigente] : [],
    },
    tipoSolicitud: { nombre: transito ? 'Transito' : 'Adopcion' },
    respuestas: [],
    mascotaAdoptadaId: null,
    notaInterna: null,
    historicoEstados: historial.map((h) => historialFila(h.estado, h.fecha, h.motivo)),
  };
}

/** Una versión del hogar del solicitante, tal como la devuelve Prisma. */
function hogar() {
  return {
    id: HOGAR_DECLARADO,
    fechaAlta: FECHA_ALTA,
    direccion: 'Av. Santa Fe 3450, Palermo',
    tipoVivienda: 'Casa',
    espacioExterior: 'Patio',
    tienePatio: true,
    tieneNinios: false,
    tieneMascotas: true,
    detalleMascotas: '1 gato y otros 2 perros grandes',
    experienciaPrevia: true,
    horasSolo: 8,
    descripcion: null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
    usuario(MIEMBRO_REFUGIO, REFUGIO_ID) as never,
  );
  vi.mocked(chats.asegurarChatDeSolicitud).mockResolvedValue(87);
  vi.mocked(chats.chatIdDeSolicitud).mockResolvedValue(87);
  vi.mocked(preguntasAdopcion.preguntasAplicables).mockResolvedValue([]);
  vi.mocked(favoritos.listarUsuariosConFavorito).mockResolvedValue([]);
  vi.mocked(repo.listarIdsMiembrosDeRefugio).mockResolvedValue([{ id: MIEMBRO_REFUGIO }]);
});

describe('resolución del actor (compartida por las tres operaciones)', () => {
  it('rechaza un usuario que no existe', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(null as never);

    await expect(
      service.listarRecibidas(MIEMBRO_REFUGIO, 'REFUGIO', { limite: 20, desplazamiento: 0 }),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO', httpStatus: 404 });
  });

  it('no exige refugio: un adoptante sin refugioId es un actor válido (mascota personal)', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(ADOPTANTE_PUBLICADOR, null) as never,
    );
    vi.mocked(repo.listarDelActor).mockResolvedValue([] as never);

    await expect(
      service.listarRecibidas(ADOPTANTE_PUBLICADOR, 'PERSONAL', { limite: 20, desplazamiento: 0 }),
    ).resolves.toEqual({ total: 0, solicitudes: [] });
    expect(repo.listarDelActor).toHaveBeenCalledWith({
      id: ADOPTANTE_PUBLICADOR,
      refugioId: null,
      ambito: 'PERSONAL',
    });
  });
});

describe('listarRecibidas', () => {
  it('devuelve las solicitudes del actor con su estado vigente', async () => {
    vi.mocked(repo.listarDelActor).mockResolvedValue([
      solicitudConDetalle({ historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }] }),
    ] as never);

    const { total, solicitudes } = await service.listarRecibidas(MIEMBRO_REFUGIO, 'REFUGIO', {
      estados: [],
      limite: 20,
      desplazamiento: 0,
    });

    expect(total).toBe(1);
    expect(solicitudes[0]).toMatchObject({
      id: SOLICITUD,
      estado: { id: 1, nombre: 'Pendiente' },
      mascota: { id: 8, nombre: 'Toby' },
      solicitante: { id: SOLICITANTE, nombre: 'Ana', apellido: 'Pérez' },
    });
    expect(repo.listarDelActor).toHaveBeenCalledWith({
      id: MIEMBRO_REFUGIO,
      refugioId: REFUGIO_ID,
      ambito: 'REFUGIO',
    });
  });

  it('filtra por estado, contando solo lo que matchea', async () => {
    vi.mocked(repo.listarDelActor).mockResolvedValue([
      solicitudConDetalle({ historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }] }),
      solicitudConDetalle({
        historial: [{ estado: estado(3, 'Aprobada'), fecha: FECHA_RESPUESTA }],
      }),
    ] as never);

    const { total, solicitudes } = await service.listarRecibidas(MIEMBRO_REFUGIO, 'REFUGIO', {
      estado: 'Pendiente',
      estados: [],
      limite: 20,
      desplazamiento: 0,
    });

    expect(total).toBe(1);
    expect(solicitudes).toHaveLength(1);
    expect(solicitudes[0]!.estado.nombre).toBe('Pendiente');
  });

  it('filtra por tipo: solo adopciones o solo tránsitos', async () => {
    vi.mocked(repo.listarDelActor).mockResolvedValue([
      solicitudConDetalle({
        historial: [{ estado: estado(3, 'Aprobada'), fecha: FECHA_RESPUESTA }],
      }),
      solicitudConDetalle({
        transito: { inicio: FECHA_ALTA, fin: FECHA_RESPUESTA },
        historial: [{ estado: estado(3, 'Aprobada'), fecha: FECHA_RESPUESTA }],
      }),
    ] as never);

    const { total, solicitudes } = await service.listarRecibidas(MIEMBRO_REFUGIO, 'REFUGIO', {
      estados: ['Aprobada'],
      tipo: 'Adopcion',
      limite: 20,
      desplazamiento: 0,
    });

    expect(total).toBe(1);
    expect(solicitudes[0]!.tipoSolicitud).toBe('Adopcion');
  });

  it('filtra por varios estados a la vez (cualquiera de ellos)', async () => {
    vi.mocked(repo.listarDelActor).mockResolvedValue([
      solicitudConDetalle({ historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }] }),
      solicitudConDetalle({
        historial: [{ estado: estado(2, 'En_Revision'), fecha: FECHA_RESPUESTA }],
      }),
      solicitudConDetalle({
        historial: [{ estado: estado(3, 'Aprobada'), fecha: FECHA_RESPUESTA }],
      }),
    ] as never);

    const { total, solicitudes } = await service.listarRecibidas(MIEMBRO_REFUGIO, 'REFUGIO', {
      estados: ['Pendiente', 'En_Revision'],
      limite: 20,
      desplazamiento: 0,
    });

    expect(total).toBe(2);
    expect(solicitudes.map((s) => s.estado.nombre)).toEqual(['Pendiente', 'En_Revision']);
  });

  it('pagina con limite/desplazamiento sobre el total filtrado', async () => {
    vi.mocked(repo.listarDelActor).mockResolvedValue(
      Array.from({ length: 3 }, () =>
        solicitudConDetalle({ historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }] }),
      ).map((s, i) => ({ ...s, id: i + 1 })) as never,
    );

    const { total, solicitudes } = await service.listarRecibidas(MIEMBRO_REFUGIO, 'REFUGIO', {
      estados: [],
      limite: 1,
      desplazamiento: 1,
    });

    expect(total).toBe(3);
    expect(solicitudes).toHaveLength(1);
    expect(solicitudes[0]!.id).toBe(2);
  });

  it('demoradas: solo las abiertas que llevan 5 días o más en su estado vigente', async () => {
    const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);
    vi.mocked(repo.listarDelActor).mockResolvedValue(
      [
        solicitudConDetalle({ historial: [{ estado: estado(1, 'Pendiente'), fecha: hace(6) }] }),
        solicitudConDetalle({ historial: [{ estado: estado(1, 'Pendiente'), fecha: hace(2) }] }),
        solicitudConDetalle({ historial: [{ estado: estado(2, 'En_Revision'), fecha: hace(5) }] }),
        solicitudConDetalle({ historial: [{ estado: estado(3, 'Aprobada'), fecha: hace(30) }] }),
      ].map((s, i) => ({ ...s, id: i + 1 })) as never,
    );

    const { total, solicitudes } = await service.listarRecibidas(MIEMBRO_REFUGIO, 'REFUGIO', {
      estados: [],
      demoradas: true,
      limite: 20,
      desplazamiento: 0,
    });

    expect(total).toBe(2);
    expect(solicitudes.map((s) => s.id)).toEqual([1, 3]);
  });
});

describe('obtenerDetalle', () => {
  it('devuelve el historial completo, más reciente primero', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        comentario: 'Bienvenido a la familia',
        fechaRespuesta: FECHA_RESPUESTA,
        historial: [
          { estado: estado(3, 'Aprobada'), fecha: FECHA_RESPUESTA },
          { estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA },
        ],
      }) as never,
    );

    const detalle = await service.obtenerDetalle(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');

    expect(detalle.estado.nombre).toBe('Aprobada');
    expect(detalle.historial).toEqual([
      { id: 3, nombre: 'Aprobada', motivo: null, fecha: FECHA_RESPUESTA.toISOString() },
      { id: 1, nombre: 'Pendiente', motivo: null, fecha: FECHA_ALTA.toISOString() },
    ]);
  });

  it('rechaza una solicitud que no existe', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(null as never);

    await expect(
      service.obtenerDetalle(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO'),
    ).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('un miembro de OTRO refugio no puede ver la solicitud (404, no distingue de "no existe")', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        mascotaRefugioId: OTRO_REFUGIO_ID,
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
      }) as never,
    );

    await expect(
      service.obtenerDetalle(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO'),
    ).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('cualquier miembro del MISMO refugio puede ver la solicitud, no solo quien cargó la mascota', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(OTRO_MIEMBRO_MISMO_REFUGIO, REFUGIO_ID) as never,
    );
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      // La mascota la cargó MIEMBRO_REFUGIO, no OTRO_MIEMBRO_MISMO_REFUGIO.
      solicitudConDetalle({
        mascotaUsuarioId: MIEMBRO_REFUGIO,
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
      }) as never,
    );

    await expect(
      service.obtenerDetalle(SOLICITUD, OTRO_MIEMBRO_MISMO_REFUGIO, 'REFUGIO'),
    ).resolves.toMatchObject({ id: SOLICITUD });
  });

  it('un adoptante particular puede ver la solicitud de la mascota que él mismo publicó', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(ADOPTANTE_PUBLICADOR, null) as never,
    );
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        mascotaRefugioId: null,
        mascotaUsuarioId: ADOPTANTE_PUBLICADOR,
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
      }) as never,
    );

    await expect(
      service.obtenerDetalle(SOLICITUD, ADOPTANTE_PUBLICADOR, 'PERSONAL'),
    ).resolves.toMatchObject({
      id: SOLICITUD,
    });
  });

  it('un adoptante NO puede ver la solicitud de la mascota de OTRO adoptante (404)', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(OTRO_ADOPTANTE, null) as never,
    );
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        mascotaRefugioId: null,
        mascotaUsuarioId: ADOPTANTE_PUBLICADOR,
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
      }) as never,
    );

    await expect(
      service.obtenerDetalle(SOLICITUD, OTRO_ADOPTANTE, 'PERSONAL'),
    ).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });
});

const FECHA_REVISADA = new Date('2026-08-25T12:00:00.000Z');

const HISTORIAL_PENDIENTE = [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }];
const HISTORIAL_EN_REVISION = [
  { estado: estado(2, 'En_Revision'), fecha: FECHA_REVISADA },
  ...HISTORIAL_PENDIENTE,
];
const HISTORIAL_REVISADA = [
  { estado: estado(3, 'Revisada'), fecha: FECHA_REVISADA },
  ...HISTORIAL_PENDIENTE,
];

/** Catálogo de estados tal como lo devuelve el repository, por nombre. */
const CATALOGO_ESTADOS: Record<string, { id: number; nombre: string }> = {
  Pendiente: estado(1, 'Pendiente'),
  En_Revision: estado(2, 'En_Revision'),
  Revisada: estado(3, 'Revisada'),
  Aprobada: estado(4, 'Aprobada'),
  Rechazada: estado(5, 'Rechazada'),
  Cancelada: estado(6, 'Cancelada'),
  Cerrada: estado(7, 'Cerrada'),
};

function catalogoDeEstados() {
  vi.mocked(repo.buscarEstadoSolicitudPorNombre).mockImplementation((nombre: string) =>
    Promise.resolve(CATALOGO_ESTADOS[nombre] as never),
  );
}

describe('resolverSolicitud', () => {
  const ESTADO_MASCOTA_ADOPTADO = estado(3, 'Adoptado');
  const ESTADO_PUBLICACION_FINALIZADA = estado(3, 'Finalizada');

  function resultadoAprobacion(solicitud: unknown) {
    return {
      solicitud,
      mascotaAdoptadaId: 99,
      solicitudesCerradas: [13, 14],
    };
  }

  function aprobada() {
    return solicitudConDetalle({
      comentario: 'Bienvenido a la familia',
      fechaRespuesta: FECHA_RESPUESTA,
      historial: [
        { estado: CATALOGO_ESTADOS.Aprobada!, fecha: FECHA_RESPUESTA },
        ...HISTORIAL_REVISADA,
      ],
    });
  }

  beforeEach(() => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_REVISADA }) as never,
    );
    catalogoDeEstados();
    vi.mocked(repo.buscarEstadoMascotaPorNombre).mockResolvedValue(
      ESTADO_MASCOTA_ADOPTADO as never,
    );
    vi.mocked(repo.buscarEstadoPublicacionPorNombre).mockResolvedValue(
      ESTADO_PUBLICACION_FINALIZADA as never,
    );
    vi.mocked(repo.listarAbiertasDePublicacion).mockResolvedValue([]);
    vi.mocked(repo.transicionar).mockResolvedValue(aprobada() as never);
    vi.mocked(repo.aprobarAdopcion).mockImplementation(() =>
      Promise.resolve(resultadoAprobacion(aprobada()) as never),
    );
  });

  it('acepta una solicitud de adopción revisada y le crea la mascota al adoptante', async () => {
    const resultado = await service.resolverSolicitud(
      SOLICITUD,
      { estado: 'Aprobada', comentario: 'Bienvenido a la familia' },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(resultado.estado.nombre).toBe('Aprobada');
    expect(repo.aprobarAdopcion).toHaveBeenCalledWith(
      SOLICITUD,
      MIEMBRO_REFUGIO,
      expect.objectContaining({
        estadoAprobadaId: CATALOGO_ESTADOS.Aprobada!.id,
        estadoCerradaId: CATALOGO_ESTADOS.Cerrada!.id,
        estadoMascotaAdoptadoId: ESTADO_MASCOTA_ADOPTADO.id,
        estadoPublicacionFinalizadaId: ESTADO_PUBLICACION_FINALIZADA.id,
        adoptanteId: SOLICITANTE,
        mascotaOrigenId: 8,
        publicacionId: 40,
        mascotaOrigen: expect.objectContaining({ nombre: 'Toby', razaId: 4 }),
      }),
    );
  });

  it.each([
    ['Pendiente', HISTORIAL_PENDIENTE],
    ['En_Revision', HISTORIAL_EN_REVISION],
  ])('no se puede aceptar una solicitud %s: falta marcarla como revisada', async (_, historial) => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(solicitudConDetalle({ historial }) as never);

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        MIEMBRO_REFUGIO,
        'REFUGIO',
      ),
    ).rejects.toMatchObject({ codigo: 'REVISION_PENDIENTE', httpStatus: 409 });
    expect(repo.transicionar).not.toHaveBeenCalled();
    expect(repo.aprobarAdopcion).not.toHaveBeenCalled();
  });

  it.each([
    ['Pendiente', HISTORIAL_PENDIENTE],
    ['En_Revision', HISTORIAL_EN_REVISION],
    ['Revisada', HISTORIAL_REVISADA],
  ])('rechazar se puede desde %s, con motivo, y no crea mascota', async (_, historial) => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(solicitudConDetalle({ historial }) as never);

    await service.resolverSolicitud(
      SOLICITUD,
      { estado: 'Rechazada', motivo: 'NO_CUMPLE_REQUISITOS', comentario: 'Buscamos patio cerrado' },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(repo.transicionar).toHaveBeenCalledWith(SOLICITUD, {
      desde: ['Pendiente', 'En_Revision', 'Revisada'],
      estadoId: CATALOGO_ESTADOS.Rechazada!.id,
      motivo: 'NO_CUMPLE_REQUISITOS',
      usuarioId: MIEMBRO_REFUGIO,
      respuesta: { comentario: 'Buscamos patio cerrado' },
    });
    expect(repo.aprobarAdopcion).not.toHaveBeenCalled();
  });

  it('rechazar saca la mascota de los favoritos de quien la pidió y le avisa', async () => {
    vi.mocked(repo.transicionar).mockResolvedValue(
      solicitudConDetalle({
        fechaRespuesta: FECHA_RESPUESTA,
        historial: [
          { estado: CATALOGO_ESTADOS.Rechazada!, fecha: FECHA_RESPUESTA },
          ...HISTORIAL_REVISADA,
        ],
      }) as never,
    );

    await service.resolverSolicitud(
      SOLICITUD,
      { estado: 'Rechazada', motivo: 'NO_CUMPLE_REQUISITOS', comentario: null },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(favoritos.quitarFavorito).toHaveBeenCalledWith(8, SOLICITANTE);
    expect(notificaciones.notificar).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: SOLICITANTE, tipo: 'SOLICITUD_RECHAZADA' }),
    );
  });

  it('aceptar una adopción saca la mascota de los favoritos de todos, después de avisarles', async () => {
    vi.mocked(favoritos.listarUsuariosConFavorito).mockResolvedValue([61, 62]);

    await service.resolverSolicitud(
      SOLICITUD,
      { estado: 'Aprobada', comentario: null },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(notificaciones.notificar).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: SOLICITANTE, tipo: 'SOLICITUD_ACEPTADA' }),
    );
    expect(notificaciones.notificar).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: 61, tipo: 'FAVORITO_ADOPTADO' }),
    );
    expect(favoritos.retirarDeTodosLosFavoritos).toHaveBeenCalledWith(8);

    const ultimoAviso = Math.max(...vi.mocked(notificaciones.notificar).mock.invocationCallOrder);
    const retiro = vi.mocked(favoritos.retirarDeTodosLosFavoritos).mock.invocationCallOrder[0]!;
    expect(retiro).toBeGreaterThan(ultimoAviso);
  });
  it('aprobar una solicitud de TRÁNSITO revisada no crea mascota ni finaliza la publicación', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        transito: { inicio: FECHA_ALTA, fin: FECHA_RESPUESTA },
        historial: HISTORIAL_REVISADA,
      }) as never,
    );

    await service.resolverSolicitud(
      SOLICITUD,
      { estado: 'Aprobada', comentario: null },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(repo.transicionar).toHaveBeenCalledWith(
      SOLICITUD,
      expect.objectContaining({ desde: ['Revisada'], estadoId: CATALOGO_ESTADOS.Aprobada!.id }),
    );
    expect(repo.aprobarAdopcion).not.toHaveBeenCalled();
  });

  it('un adoptante particular puede resolver la solicitud de su propia mascota publicada', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(ADOPTANTE_PUBLICADOR, null) as never,
    );
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        mascotaRefugioId: null,
        mascotaUsuarioId: ADOPTANTE_PUBLICADOR,
        historial: HISTORIAL_REVISADA,
      }) as never,
    );

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        ADOPTANTE_PUBLICADOR,
        'PERSONAL',
      ),
    ).resolves.toMatchObject({ estado: { nombre: 'Aprobada' } });
  });

  it.each(['Aprobada', 'Rechazada', 'Cancelada', 'Cerrada'])(
    'una solicitud %s ya no admite cambios (chequeo previo, sin llegar a la DB)',
    async (final) => {
      vi.mocked(repo.buscarConDetalle).mockResolvedValue(
        solicitudConDetalle({
          historial: [{ estado: CATALOGO_ESTADOS[final]!, fecha: FECHA_RESPUESTA }],
        }) as never,
      );

      await expect(
        service.resolverSolicitud(
          SOLICITUD,
          { estado: 'Rechazada', motivo: 'OTRO', comentario: null },
          MIEMBRO_REFUGIO,
          'REFUGIO',
        ),
      ).rejects.toMatchObject({ codigo: 'SOLICITUD_YA_RESUELTA', httpStatus: 409 });
      expect(repo.transicionar).not.toHaveBeenCalled();
      expect(repo.aprobarAdopcion).not.toHaveBeenCalled();
    },
  );

  it('dos acciones concurrentes: la que pierde la carrera atómica recibe 409, no pisa el histórico', async () => {
    // El chequeo previo la ve "Revisada", pero para cuando la transacción Serializable
    // corre, la otra acción ya ganó — el repository devuelve null.
    vi.mocked(repo.aprobarAdopcion).mockResolvedValue(null as never);
    vi.mocked(repo.transicionar).mockResolvedValue(null as never);

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        MIEMBRO_REFUGIO,
        'REFUGIO',
      ),
    ).rejects.toMatchObject({ codigo: 'SOLICITUD_YA_RESUELTA', httpStatus: 409 });

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Rechazada', motivo: 'OTRO', comentario: null },
        MIEMBRO_REFUGIO,
        'REFUGIO',
      ),
    ).rejects.toMatchObject({ codigo: 'SOLICITUD_YA_RESUELTA', httpStatus: 409 });
  });

  it('un miembro de OTRO refugio no puede resolverla (404)', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        mascotaRefugioId: OTRO_REFUGIO_ID,
        historial: HISTORIAL_REVISADA,
      }) as never,
    );

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        MIEMBRO_REFUGIO,
        'REFUGIO',
      ),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO', httpStatus: 404 });
    expect(repo.transicionar).not.toHaveBeenCalled();
    expect(repo.aprobarAdopcion).not.toHaveBeenCalled();
  });

  it('un adoptante no puede resolver la solicitud de la mascota de OTRO adoptante (404)', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(OTRO_ADOPTANTE, null) as never,
    );
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        mascotaRefugioId: null,
        mascotaUsuarioId: ADOPTANTE_PUBLICADOR,
        historial: HISTORIAL_REVISADA,
      }) as never,
    );

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        OTRO_ADOPTANTE,
        'PERSONAL',
      ),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO', httpStatus: 404 });
    expect(repo.transicionar).not.toHaveBeenCalled();
    expect(repo.aprobarAdopcion).not.toHaveBeenCalled();
  });

  it('revienta con un error interno si el catálogo no tiene el estado destino', async () => {
    vi.mocked(repo.buscarEstadoSolicitudPorNombre).mockResolvedValue(null as never);

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        MIEMBRO_REFUGIO,
        'REFUGIO',
      ),
    ).rejects.toMatchObject({ codigo: 'ERROR_INTERNO', httpStatus: 500 });
  });

  it('registra la auditoría con el estado anterior y el nuevo', async () => {
    await service.resolverSolicitud(
      SOLICITUD,
      { estado: 'Aprobada', comentario: null },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(logAuditoria.registrarAuditoria).toHaveBeenCalledWith({
      usuarioId: MIEMBRO_REFUGIO,
      accion: 'APROBAR',
      entidad: 'Solicitud',
      entidadId: SOLICITUD,
      detalle: 'Revisada -> Aprobada (adopción, mascota 8 -> usuario 7)',
    });
  });

  it('el rechazo audita el estado anterior y el motivo', async () => {
    await service.resolverSolicitud(
      SOLICITUD,
      { estado: 'Rechazada', motivo: 'SIN_CONTACTO', comentario: null },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(logAuditoria.registrarAuditoria).toHaveBeenCalledWith({
      usuarioId: MIEMBRO_REFUGIO,
      accion: 'RECHAZAR',
      entidad: 'Solicitud',
      entidadId: SOLICITUD,
      detalle: 'Revisada -> Rechazada (SIN_CONTACTO)',
    });
  });

  it('audita la mascota creada, los cambios de estado y los cierres automáticos', async () => {
    await service.resolverSolicitud(
      SOLICITUD,
      { estado: 'Aprobada', comentario: null },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(logAuditoria.registrarAuditoria).toHaveBeenCalledWith({
      usuarioId: MIEMBRO_REFUGIO,
      accion: 'CREAR',
      entidad: 'Mascota',
      entidadId: 99,
      detalle: `adoptada por usuario ${SOLICITANTE} (solicitud ${SOLICITUD})`,
    });
    expect(logAuditoria.registrarAuditoria).toHaveBeenCalledWith({
      usuarioId: MIEMBRO_REFUGIO,
      accion: 'CAMBIAR_ESTADO',
      entidad: 'Publicacion',
      entidadId: 40,
      detalle: 'Finalizada (adopción aprobada)',
    });
    expect(logAuditoria.registrarAuditoria).toHaveBeenCalledWith({
      usuarioId: MIEMBRO_REFUGIO,
      accion: 'CERRAR',
      entidad: 'Solicitud',
      entidadId: 13,
      detalle: 'Cerrada (ADOPTADA_POR_OTRA_PERSONA) al aprobarse otra solicitud de la publicación',
    });
  });

  it('les avisa con tacto a quienes quedaron afuera: la mascota ya encontró su hogar', async () => {
    vi.mocked(repo.listarAbiertasDePublicacion).mockResolvedValue([
      { id: 13, usuarioId: 31 },
      { id: 14, usuarioId: 32 },
    ]);

    await service.resolverSolicitud(
      SOLICITUD,
      { estado: 'Aprobada', comentario: null },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(notificaciones.notificar).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: 31,
        tipo: 'SOLICITUD_MASCOTA_ADOPTADA_POR_OTRO',
        mensaje: expect.stringContaining('ya encontró su hogar'),
      }),
    );
  });

  it('no registra auditoría si pierde la carrera atómica', async () => {
    vi.mocked(repo.aprobarAdopcion).mockResolvedValue(null as never);

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        MIEMBRO_REFUGIO,
        'REFUGIO',
      ),
    ).rejects.toMatchObject({ codigo: 'SOLICITUD_YA_RESUELTA' });
    expect(logAuditoria.registrarAuditoria).not.toHaveBeenCalled();
  });

  it('los errores son AppError, así el errorHandler los traduce al formato de la API', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(null as never);

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        MIEMBRO_REFUGIO,
        'REFUGIO',
      ),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('iniciarRevision', () => {
  beforeEach(() => {
    catalogoDeEstados();
    vi.mocked(repo.transicionar).mockResolvedValue(
      solicitudConDetalle({
        historial: [
          { estado: CATALOGO_ESTADOS.En_Revision!, fecha: FECHA_REVISADA },
          ...HISTORIAL_PENDIENTE,
        ],
      }) as never,
    );
  });

  it('una solicitud Pendiente pasa a En_Revision', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_PENDIENTE }) as never,
    );

    const resultado = await service.iniciarRevision(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');

    expect(resultado.estado.nombre).toBe('En_Revision');
    expect(repo.transicionar).toHaveBeenCalledWith(SOLICITUD, {
      desde: ['Pendiente'],
      estadoId: CATALOGO_ESTADOS.En_Revision!.id,
      usuarioId: MIEMBRO_REFUGIO,
    });
  });

  it.each([
    ['En_Revision', HISTORIAL_EN_REVISION],
    ['Revisada', HISTORIAL_REVISADA],
    ['Aprobada', [{ estado: CATALOGO_ESTADOS.Aprobada!, fecha: FECHA_RESPUESTA }]],
  ])(
    'es idempotente: con la solicitud %s devuelve el detalle sin escribir',
    async (_, historial) => {
      vi.mocked(repo.buscarConDetalle).mockResolvedValue(
        solicitudConDetalle({ historial }) as never,
      );

      await expect(
        service.iniciarRevision(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO'),
      ).resolves.toMatchObject({ id: SOLICITUD });
      expect(repo.transicionar).not.toHaveBeenCalled();
    },
  );

  it('si otra persona del refugio la abrió un instante antes, devuelve lo vigente', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_PENDIENTE }) as never,
    );
    vi.mocked(repo.transicionar).mockResolvedValue(null as never);

    await expect(
      service.iniciarRevision(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO'),
    ).resolves.toMatchObject({ id: SOLICITUD });
    expect(logAuditoria.registrarAuditoria).not.toHaveBeenCalled();
  });

  it('el solicitante no la dispara: es de quien publicó (404)', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuario(SOLICITANTE, null) as never);
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_PENDIENTE }) as never,
    );

    await expect(service.iniciarRevision(SOLICITUD, SOLICITANTE, 'PERSONAL')).rejects.toMatchObject(
      { codigo: 'NO_ENCONTRADO', httpStatus: 404 },
    );
    expect(repo.transicionar).not.toHaveBeenCalled();
  });
});

describe('marcarRevisada', () => {
  beforeEach(() => {
    catalogoDeEstados();
    vi.mocked(repo.transicionar).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_REVISADA }) as never,
    );
  });

  it.each([
    ['Pendiente', HISTORIAL_PENDIENTE],
    ['En_Revision', HISTORIAL_EN_REVISION],
  ])('una solicitud %s pasa a Revisada y avisa al solicitante', async (_, historial) => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(solicitudConDetalle({ historial }) as never);

    const resultado = await service.marcarRevisada(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');

    expect(resultado.estado.nombre).toBe('Revisada');
    expect(repo.transicionar).toHaveBeenCalledWith(SOLICITUD, {
      desde: ['Pendiente', 'En_Revision'],
      estadoId: CATALOGO_ESTADOS.Revisada!.id,
      usuarioId: MIEMBRO_REFUGIO,
    });
    expect(notificaciones.notificar).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: SOLICITANTE, tipo: 'SOLICITUD_REVISADA' }),
    );
  });

  it('el aviso no entusiasma de más: revisada no es aceptada', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_PENDIENTE }) as never,
    );

    await service.marcarRevisada(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');

    const aviso = vi.mocked(notificaciones.notificar).mock.calls[0]![0];
    expect(aviso.mensaje).toBe(
      'Ya revisaron tu solicitud por Toby. En cuanto tengan una decisión te avisamos.',
    );
  });

  it('si ya está Revisada devuelve el detalle sin escribir ni avisar de nuevo', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_REVISADA }) as never,
    );

    await expect(
      service.marcarRevisada(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO'),
    ).resolves.toMatchObject({ estado: { nombre: 'Revisada' } });
    expect(repo.transicionar).not.toHaveBeenCalled();
    expect(notificaciones.notificar).not.toHaveBeenCalled();
  });

  it.each(['Aprobada', 'Rechazada', 'Cancelada', 'Cerrada'])(
    '409 si la solicitud ya está %s',
    async (final) => {
      vi.mocked(repo.buscarConDetalle).mockResolvedValue(
        solicitudConDetalle({
          historial: [{ estado: CATALOGO_ESTADOS[final]!, fecha: FECHA_RESPUESTA }],
        }) as never,
      );

      await expect(
        service.marcarRevisada(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO'),
      ).rejects.toMatchObject({ codigo: 'SOLICITUD_YA_RESUELTA', httpStatus: 409 });
      expect(repo.transicionar).not.toHaveBeenCalled();
    },
  );

  it('409 si pierde la carrera contra otra acción', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_PENDIENTE }) as never,
    );
    vi.mocked(repo.transicionar).mockResolvedValue(null as never);

    await expect(
      service.marcarRevisada(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO'),
    ).rejects.toMatchObject({ codigo: 'SOLICITUD_YA_RESUELTA' });
  });
});

describe('retirarSolicitud', () => {
  beforeEach(() => {
    catalogoDeEstados();
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuario(SOLICITANTE, null) as never);
    vi.mocked(repo.listarIdsMiembrosDeRefugio).mockResolvedValue([{ id: MIEMBRO_REFUGIO }]);
    vi.mocked(repo.transicionar).mockResolvedValue(
      solicitudConDetalle({
        historial: [
          {
            estado: CATALOGO_ESTADOS.Cancelada!,
            fecha: FECHA_RESPUESTA,
            motivo: 'RETIRADA_POR_SOLICITANTE',
          },
          ...HISTORIAL_REVISADA,
        ],
      }) as never,
    );
  });

  it.each([
    ['Pendiente', HISTORIAL_PENDIENTE],
    ['En_Revision', HISTORIAL_EN_REVISION],
    ['Revisada', HISTORIAL_REVISADA],
  ])(
    'el solicitante retira una solicitud %s: queda Cancelada con su causa',
    async (_, historial) => {
      vi.mocked(repo.buscarConDetalle).mockResolvedValue(
        solicitudConDetalle({ historial }) as never,
      );

      const resultado = await service.retirarSolicitud(SOLICITUD, SOLICITANTE, 'PERSONAL');

      expect(resultado.estado.nombre).toBe('Cancelada');
      expect(resultado.motivo).toBe('RETIRADA_POR_SOLICITANTE');
      expect(repo.transicionar).toHaveBeenCalledWith(SOLICITUD, {
        desde: ['Pendiente', 'En_Revision', 'Revisada'],
        estadoId: CATALOGO_ESTADOS.Cancelada!.id,
        motivo: 'RETIRADA_POR_SOLICITANTE',
        usuarioId: SOLICITANTE,
      });
      expect(logAuditoria.registrarAuditoria).toHaveBeenCalledWith(
        expect.objectContaining({ accion: 'RETIRAR', entidadId: SOLICITUD }),
      );
    },
  );

  it('le avisa al refugio en la bandeja, sin push ni mail', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_PENDIENTE }) as never,
    );

    await service.retirarSolicitud(SOLICITUD, SOLICITANTE, 'PERSONAL');

    const aviso = vi.mocked(notificaciones.notificar).mock.calls[0]![0];
    expect(aviso).toMatchObject({ usuarioId: MIEMBRO_REFUGIO, tipo: 'SOLICITUD_RETIRADA' });
    expect(aviso.canal).toBeUndefined();
  });

  it.each(['Aprobada', 'Rechazada', 'Cancelada', 'Cerrada'])(
    '409 si la solicitud ya está %s',
    async (final) => {
      vi.mocked(repo.buscarConDetalle).mockResolvedValue(
        solicitudConDetalle({
          historial: [{ estado: CATALOGO_ESTADOS[final]!, fecha: FECHA_RESPUESTA }],
        }) as never,
      );

      await expect(
        service.retirarSolicitud(SOLICITUD, SOLICITANTE, 'PERSONAL'),
      ).rejects.toMatchObject({ codigo: 'SOLICITUD_YA_RESUELTA', httpStatus: 409 });
      expect(repo.transicionar).not.toHaveBeenCalled();
    },
  );

  it('una solicitud ajena no se puede retirar (404)', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(OTRO_ADOPTANTE, null) as never,
    );
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_PENDIENTE }) as never,
    );

    await expect(
      service.retirarSolicitud(SOLICITUD, OTRO_ADOPTANTE, 'PERSONAL'),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO', httpStatus: 404 });
  });

  it('quien publicó la mascota tampoco puede retirarla por el solicitante (404)', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(MIEMBRO_REFUGIO, REFUGIO_ID) as never,
    );
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_PENDIENTE }) as never,
    );

    await expect(
      service.retirarSolicitud(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO'),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO', httpStatus: 404 });
  });

  it('409 si pierde la carrera contra otra acción', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_PENDIENTE }) as never,
    );
    vi.mocked(repo.transicionar).mockResolvedValue(null as never);

    await expect(
      service.retirarSolicitud(SOLICITUD, SOLICITANTE, 'PERSONAL'),
    ).rejects.toMatchObject({ codigo: 'SOLICITUD_YA_RESUELTA' });
  });
});

describe('cierres automáticos', () => {
  const SISTEMA = 1;

  beforeEach(() => {
    catalogoDeEstados();
    vi.mocked(repo.transicionar).mockImplementation((id: number) =>
      Promise.resolve({
        ...solicitudConDetalle({
          historial: [
            { estado: CATALOGO_ESTADOS.Cerrada!, fecha: FECHA_RESPUESTA },
            ...HISTORIAL_REVISADA,
          ],
        }),
        id,
      } as never),
    );
  });

  it('cierra cada solicitud abierta con la causa y avisa a su solicitante', async () => {
    const cerradas = await service.cerrarSolicitudes(
      [{ id: 13 }, { id: 14 }],
      'MASCOTA_FALLECIDA',
      SISTEMA,
    );

    expect(cerradas).toEqual([13, 14]);
    expect(repo.transicionar).toHaveBeenCalledWith(13, {
      desde: ['Pendiente', 'En_Revision', 'Revisada'],
      estadoId: CATALOGO_ESTADOS.Cerrada!.id,
      motivo: 'MASCOTA_FALLECIDA',
      usuarioId: SISTEMA,
    });
    expect(notificaciones.notificar).toHaveBeenCalledTimes(2);
  });

  it('una que otra acción resolvió un instante antes se saltea, sin error', async () => {
    vi.mocked(repo.transicionar)
      .mockResolvedValueOnce(null as never)
      .mockImplementationOnce((id: number) =>
        Promise.resolve({ ...solicitudConDetalle({ historial: HISTORIAL_REVISADA }), id } as never),
      );

    const cerradas = await service.cerrarSolicitudes(
      [{ id: 13 }, { id: 14 }],
      'VENCIDA_SIN_RESPUESTA',
      SISTEMA,
    );

    expect(cerradas).toEqual([14]);
  });

  it('sin solicitudes abiertas no toca el catálogo ni escribe', async () => {
    await expect(service.cerrarSolicitudes([], 'MASCOTA_FALLECIDA', SISTEMA)).resolves.toEqual([]);
    expect(repo.buscarEstadoSolicitudPorNombre).not.toHaveBeenCalled();
  });

  it('el texto de cada causa es amable y no culpa al solicitante', async () => {
    await service.cerrarSolicitudes([{ id: 13 }], 'VENCIDA_SIN_RESPUESTA', SISTEMA);
    await service.cerrarSolicitudes([{ id: 14 }], 'MASCOTA_FALLECIDA', SISTEMA);

    const textos = vi.mocked(notificaciones.notificar).mock.calls.map(([aviso]) => aviso.mensaje);
    expect(textos[0]).toContain('No es por vos');
    expect(textos[1]).toContain('Con mucha tristeza');
    expect(textos.join(' ')).not.toMatch(/rechaz/i);
  });

  it('cerrarAbiertasDePublicacion cierra todas las abiertas de esa publicación', async () => {
    vi.mocked(repo.listarAbiertasDePublicacion).mockResolvedValue([
      { id: 13, usuarioId: 31 },
      { id: 14, usuarioId: 32 },
    ]);

    await expect(
      service.cerrarAbiertasDePublicacion(40, 'PUBLICACION_RETIRADA', MIEMBRO_REFUGIO),
    ).resolves.toEqual([13, 14]);
    expect(repo.listarAbiertasDePublicacion).toHaveBeenCalledWith(40);
  });

  it('si el cierre falla no revienta a quien finalizó la publicación: se loguea', async () => {
    vi.mocked(repo.listarAbiertasDePublicacion).mockRejectedValue(new Error('base caída'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      service.cerrarAbiertasDePublicacion(40, 'PUBLICACION_RETIRADA', MIEMBRO_REFUGIO),
    ).resolves.toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('crear del lado del solicitante (HU-7.1)', () => {
  const PUBLICACION = 40;

  const HOGAR_DTO = {
    direccion: 'Av. Santa Fe 3450, Palermo',
    tipoVivienda: 'Casa' as const,
    espacioExterior: 'Patio' as const,
    tieneNinios: false,
    tieneMascotas: true,
    detalleMascotas: '1 gato y otros 2 perros grandes',
    experienciaPrevia: true,
    horasSolo: 8 as const,
    descripcion: null,
  };

  const NUEVA = {
    publicacionId: PUBLICACION,
    tipoSolicitud: 'Adopcion' as const,
    motivacion: 'Vivimos en una casa con patio y ya criamos perros grandes.',
    fechaInicioTransito: null,
    fechaFinTransito: null,
    hogar: HOGAR_DTO,
  };

  /** Publicación solicitable: viva, de otro dueño y con la mascota "Disponible". */
  function publicacionDisponible(
    estadoMascota = 'Disponible',
    duenio = MIEMBRO_REFUGIO,
    refugioId: number | null = null,
    estadoPublicacion = 'Activa',
  ) {
    return {
      id: PUBLICACION,
      historicoEstados: [{ estadoPublicacion: { nombre: estadoPublicacion } }],
      mascota: {
        id: 8,
        usuarioId: duenio,
        refugioId,
        historicoEstados: [{ estadoMascota: { nombre: estadoMascota } }],
      },
    };
  }

  beforeEach(() => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({
      ...usuario(SOLICITANTE, null),
      verificado: true,
    } as never);
    vi.mocked(repo.contarAbiertasDeUsuario).mockResolvedValue(0);
    vi.mocked(repo.buscarAbiertaDeUsuarioEnPublicacion).mockResolvedValue(null as never);
    vi.mocked(repo.buscarPublicacionParaSolicitar).mockResolvedValue(
      publicacionDisponible() as never,
    );
    vi.mocked(repo.buscarTipoSolicitudPorNombre).mockResolvedValue({ id: 1 } as never);
    vi.mocked(repo.buscarEstadoSolicitudPorNombre).mockResolvedValue({ id: 1 } as never);
    vi.mocked(repo.crearConHogar).mockResolvedValue(
      solicitudConDetalle({ historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }] }),
    );
  });

  it('crea la solicitud con el hogar y el estado inicial Pendiente', async () => {
    const creada = await service.crearSolicitud(NUEVA, SOLICITANTE);

    expect(creada.estado.nombre).toBe('Pendiente');
    expect(repo.crearConHogar).toHaveBeenCalledWith(
      SOLICITANTE,
      expect.objectContaining({ publicacionId: PUBLICACION, tipoSolicitudId: 1 }),
      expect.objectContaining({ direccion: HOGAR_DTO.direccion }),
      1,
      [],
    );
  });

  it('deriva tienePatio del espacio exterior elegido', async () => {
    await service.crearSolicitud(NUEVA, SOLICITANTE);

    expect(repo.crearConHogar).toHaveBeenCalledWith(
      SOLICITANTE,
      expect.anything(),
      expect.objectContaining({ espacioExterior: 'Patio', tienePatio: true }),
      expect.anything(),
      [],
    );

    vi.mocked(repo.crearConHogar).mockClear();
    await service.crearSolicitud(
      { ...NUEVA, hogar: { ...HOGAR_DTO, espacioExterior: 'Balcon' } },
      SOLICITANTE,
    );

    expect(repo.crearConHogar).toHaveBeenCalledWith(
      SOLICITANTE,
      expect.anything(),
      expect.objectContaining({ espacioExterior: 'Balcon', tienePatio: false }),
      expect.anything(),
      [],
    );
  });

  it('descarta el detalle de mascotas si respondió que no tiene', async () => {
    await service.crearSolicitud(
      { ...NUEVA, hogar: { ...HOGAR_DTO, tieneMascotas: false } },
      SOLICITANTE,
    );

    expect(repo.crearConHogar).toHaveBeenCalledWith(
      SOLICITANTE,
      expect.anything(),
      expect.objectContaining({ tieneMascotas: false, detalleMascotas: null }),
      expect.anything(),
      [],
    );
  });

  it('un usuario sin verificar recibe el texto literal de la HU', async () => {
    FLAGS.EXIGIR_VERIFICACION_PARA_SOLICITAR = true;
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({
      ...usuario(SOLICITANTE, null),
      verificado: false,
    } as never);

    await expect(service.crearSolicitud(NUEVA, SOLICITANTE)).rejects.toMatchObject({
      codigo: 'USUARIO_NO_VERIFICADO',
      mensaje: 'Tenés que verificarte antes de solicitar una adopción',
    });
    expect(repo.crearConHogar).not.toHaveBeenCalled();
  });

  it('con la verificación desactivada un usuario sin verificar puede solicitar', async () => {
    FLAGS.EXIGIR_VERIFICACION_PARA_SOLICITAR = false;
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({
      ...usuario(SOLICITANTE, null),
      verificado: false,
    } as never);

    await expect(service.crearSolicitud(NUEVA, SOLICITANTE)).resolves.toMatchObject({
      estado: { nombre: 'Pendiente' },
    });
    expect(repo.crearConHogar).toHaveBeenCalled();
  });

  it('con 5 pendientes recibe el texto literal de la HU', async () => {
    vi.mocked(repo.contarAbiertasDeUsuario).mockResolvedValue(5);

    await expect(service.crearSolicitud(NUEVA, SOLICITANTE)).rejects.toMatchObject({
      codigo: 'LIMITE_SOLICITUDES',
      mensaje: 'No podés solicitar otra mascota',
    });
  });

  it('no se puede solicitar dos veces la misma publicación', async () => {
    vi.mocked(repo.buscarAbiertaDeUsuarioEnPublicacion).mockResolvedValue({ id: 99 } as never);

    await expect(service.crearSolicitud(NUEVA, SOLICITANTE)).rejects.toMatchObject({
      codigo: 'SOLICITUD_DUPLICADA',
    });
  });

  it('no se puede solicitar la propia mascota', async () => {
    vi.mocked(repo.buscarPublicacionParaSolicitar).mockResolvedValue(
      publicacionDisponible('Disponible', SOLICITANTE) as never,
    );

    await expect(service.crearSolicitud(NUEVA, SOLICITANTE)).rejects.toMatchObject({
      codigo: 'PUBLICACION_PROPIA',
    });
  });

  it('tampoco se puede solicitar una mascota del propio refugio, aunque la haya cargado otro miembro: desde el perfil personal lo del refugio no se ve', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({
      ...usuario(SOLICITANTE, 1),
      verificado: true,
    } as never);
    vi.mocked(repo.buscarPublicacionParaSolicitar).mockResolvedValue(
      publicacionDisponible('Disponible', MIEMBRO_REFUGIO, 1) as never,
    );

    await expect(service.crearSolicitud(NUEVA, SOLICITANTE)).rejects.toMatchObject({
      codigo: 'PUBLICACION_PROPIA',
    });
  });

  it('no se puede solicitar una mascota que ya no está disponible', async () => {
    vi.mocked(repo.buscarPublicacionParaSolicitar).mockResolvedValue(
      publicacionDisponible('Adoptado') as never,
    );

    await expect(service.crearSolicitud(NUEVA, SOLICITANTE)).rejects.toMatchObject({
      codigo: 'MASCOTA_NO_DISPONIBLE',
    });
  });

  it('no se puede solicitar sobre una publicación pausada, aunque la mascota esté disponible', async () => {
    vi.mocked(repo.buscarPublicacionParaSolicitar).mockResolvedValue(
      publicacionDisponible('Disponible', MIEMBRO_REFUGIO, null, 'Pausada') as never,
    );

    await expect(service.crearSolicitud(NUEVA, SOLICITANTE)).rejects.toMatchObject({
      codigo: 'PUBLICACION_NO_ACTIVA',
      httpStatus: 409,
    });
    expect(repo.crearConHogar).not.toHaveBeenCalled();
  });

  it('devuelve el período de tránsito como día de calendario, no como instante', async () => {
    vi.mocked(repo.crearConHogar).mockResolvedValue(
      solicitudConDetalle({
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
        transito: { inicio: new Date(2026, 8, 15), fin: new Date(2026, 11, 15) },
      }),
    );

    const creada = await service.crearSolicitud(
      { ...NUEVA, tipoSolicitud: 'Transito' },
      SOLICITANTE,
    );

    expect(creada.transito).toEqual({ fechaInicio: '2026-09-15', fechaFin: '2026-12-15' });
  });

  it('el hogar declarado viaja en el detalle, para que lo lea quien resuelve', async () => {
    const creada = await service.crearSolicitud(NUEVA, SOLICITANTE);

    expect(creada.hogar).toMatchObject({
      direccion: 'Av. Santa Fe 3450, Palermo',
      espacioExterior: 'Patio',
      horasSolo: 8,
    });
  });

  it('una solicitud anterior a HU-7.1 no tiene hogar y no rompe el detalle', async () => {
    vi.mocked(repo.crearConHogar).mockResolvedValue(
      solicitudConDetalle({
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
        conHogar: false,
      }),
    );

    const creada = await service.crearSolicitud(NUEVA, SOLICITANTE);

    expect(creada.hogar).toBeNull();
  });
});

describe('visibilidad del solicitante (HU-7.3)', () => {
  function ajena() {
    return solicitudConDetalle({
      mascotaRefugioId: OTRO_REFUGIO_ID,
      mascotaUsuarioId: OTRO_ADOPTANTE,
      historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
    });
  }

  beforeEach(() => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuario(SOLICITANTE, null) as never);
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(ajena());
  });

  it('ve el detalle de su propia solicitud aunque no publique la mascota', async () => {
    await expect(service.obtenerDetalle(SOLICITUD, SOLICITANTE, 'PERSONAL')).resolves.toMatchObject(
      {
        id: SOLICITUD,
      },
    );
  });

  it('pero no puede resolverla: eso es de quien publicó la mascota', async () => {
    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        SOLICITANTE,
        'PERSONAL',
      ),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });

  it('un tercero que no es ninguna de las dos puntas recibe 404', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(OTRO_MIEMBRO_MISMO_REFUGIO, OTRO_REFUGIO_ID + 10) as never,
    );

    await expect(
      service.obtenerDetalle(SOLICITUD, OTRO_MIEMBRO_MISMO_REFUGIO, 'REFUGIO'),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });
});

describe('obtenerElegibilidad (chequeo previo de HU-7.1)', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({
      ...usuario(SOLICITANTE, null),
      verificado: true,
    } as never);
    vi.mocked(repo.contarAbiertasDeUsuario).mockResolvedValue(2);
    vi.mocked(repo.buscarAbiertaDeUsuarioEnPublicacion).mockResolvedValue(null as never);
  });

  it('habilita el formulario cuando se cumplen las precondiciones', async () => {
    await expect(service.obtenerElegibilidad(SOLICITANTE, 40)).resolves.toMatchObject({
      puedeSolicitar: true,
      motivo: null,
      pendientes: 2,
      maximo: 5,
    });
  });

  it('la falta de verificación gana sobre el resto de los motivos', async () => {
    FLAGS.EXIGIR_VERIFICACION_PARA_SOLICITAR = true;
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({
      ...usuario(SOLICITANTE, null),
      verificado: false,
    } as never);
    vi.mocked(repo.contarAbiertasDeUsuario).mockResolvedValue(5);

    await expect(service.obtenerElegibilidad(SOLICITANTE, 40)).resolves.toMatchObject({
      motivo: 'NO_VERIFICADO',
      mensaje: 'Tenés que verificarte antes de solicitar una adopción',
    });
  });

  it('con la verificación desactivada no bloquea a un usuario sin verificar', async () => {
    FLAGS.EXIGIR_VERIFICACION_PARA_SOLICITAR = false;
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({
      ...usuario(SOLICITANTE, null),
      verificado: false,
    } as never);

    await expect(service.obtenerElegibilidad(SOLICITANTE, 40)).resolves.toMatchObject({
      puedeSolicitar: true,
      motivo: null,
    });
  });

  it('devuelve la solicitud abierta, para el CTA de ver la solicitud', async () => {
    vi.mocked(repo.buscarAbiertaDeUsuarioEnPublicacion).mockResolvedValue({ id: 1042 } as never);

    await expect(service.obtenerElegibilidad(SOLICITANTE, 40)).resolves.toMatchObject({
      motivo: 'YA_SOLICITADA',
      solicitudAbiertaId: 1042,
    });
  });

  it('sin publicación solo evalúa al usuario: sirve para habilitar el botón de un listado', async () => {
    vi.mocked(repo.contarAbiertasDeUsuario).mockResolvedValue(5);

    await expect(service.obtenerElegibilidad(SOLICITANTE)).resolves.toMatchObject({
      motivo: 'LIMITE_ALCANZADO',
      solicitudAbiertaId: null,
    });
    expect(repo.buscarAbiertaDeUsuarioEnPublicacion).not.toHaveBeenCalled();
  });

  it('sobre la propia mascota, PUBLICACION_PROPIA gana sobre el resto de los motivos', async () => {
    vi.mocked(repo.buscarPublicacionParaSolicitar).mockResolvedValue({
      id: 40,
      mascota: { id: 8, usuarioId: SOLICITANTE, refugioId: null, historicoEstados: [] },
    } as never);

    await expect(service.obtenerElegibilidad(SOLICITANTE, 40)).resolves.toMatchObject({
      puedeSolicitar: false,
      motivo: 'PUBLICACION_PROPIA',
      mensaje: 'No podés solicitar tu propia mascota',
    });
  });

  it('bloquea sobre una publicación del propio refugio, aunque la haya cargado otro miembro', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({
      ...usuario(SOLICITANTE, 1),
      verificado: true,
    } as never);
    vi.mocked(repo.buscarPublicacionParaSolicitar).mockResolvedValue({
      id: 40,
      mascota: { id: 8, usuarioId: MIEMBRO_REFUGIO, refugioId: 1, historicoEstados: [] },
    } as never);

    await expect(service.obtenerElegibilidad(SOLICITANTE, 40)).resolves.toMatchObject({
      motivo: 'PUBLICACION_PROPIA',
    });
  });
});

describe('switch refugio/adoptante — cada perfil ve solo lo suyo', () => {
  it('desde la vista de refugio no se ve una solicitud que el miembro mandó como adoptante', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuario(SOLICITANTE, 1) as never);
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        mascotaRefugioId: 99,
        mascotaUsuarioId: OTRO_ADOPTANTE,
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
      }) as never,
    );

    await expect(service.obtenerDetalle(SOLICITUD, SOLICITANTE, 'REFUGIO')).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
    });
  });

  it('desde el perfil personal no se resuelve una solicitud de una mascota del refugio', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(MIEMBRO_REFUGIO, REFUGIO_ID) as never,
    );
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
      }) as never,
    );

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        MIEMBRO_REFUGIO,
        'PERSONAL',
      ),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    expect(repo.transicionar).not.toHaveBeenCalled();
  });

  it('las recibidas del perfil personal piden solo las de sus mascotas personales', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(MIEMBRO_REFUGIO, REFUGIO_ID) as never,
    );
    vi.mocked(repo.listarDelActor).mockResolvedValue([] as never);

    await service.listarRecibidas(MIEMBRO_REFUGIO, 'PERSONAL', { limite: 20, desplazamiento: 0 });

    expect(repo.listarDelActor).toHaveBeenCalledWith({
      id: MIEMBRO_REFUGIO,
      refugioId: REFUGIO_ID,
      ambito: 'PERSONAL',
    });
  });
});

describe('versionado del hogar (mudanza posterior al envío)', () => {
  const HOGAR_NUEVO = 31;
  const FECHA_MUDANZA = new Date('2026-10-12T09:00:00.000Z');

  beforeEach(() => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(MIEMBRO_REFUGIO, REFUGIO_ID) as never,
    );
  });

  it('sin mudanza no hay nada que avisar', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }] }),
    );

    const detalle = await service.obtenerDetalle(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');

    expect(detalle.cambioDeHogar).toBeNull();
    expect(detalle.hogar?.direccion).toBe('Av. Santa Fe 3450, Palermo');
  });

  it('el detalle conserva lo declarado y avisa del domicilio actual', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
        hogarVigente: {
          id: HOGAR_NUEVO,
          direccion: 'Belgrano 800, Caballito',
          fechaAlta: FECHA_MUDANZA,
        },
      }),
    );

    const detalle = await service.obtenerDetalle(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');

    // Lo que el refugio evaluó no se reescribe...
    expect(detalle.hogar?.direccion).toBe('Av. Santa Fe 3450, Palermo');
    // ...y además ve dónde dice estar ahora, con la fecha del cambio.
    expect(detalle.cambioDeHogar).toMatchObject({
      hogar: { direccion: 'Belgrano 800, Caballito' },
      fechaCambio: FECHA_MUDANZA.toISOString(),
    });
  });

  it('una solicitud sin hogar declarado no inventa un cambio', async () => {
    // Solicitudes anteriores a HU-7.1: no hay contra qué comparar el hogar vigente.
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
        conHogar: false,
      }),
    );

    const detalle = await service.obtenerDetalle(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');

    expect(detalle.hogar).toBeNull();
    expect(detalle.cambioDeHogar).toBeNull();
  });
});

describe('elegibilidad: precarga del paso 2', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({
      ...usuario(SOLICITANTE, null),
      verificado: true,
    } as never);
    vi.mocked(repo.contarAbiertasDeUsuario).mockResolvedValue(0);
    vi.mocked(repo.buscarAbiertaDeUsuarioEnPublicacion).mockResolvedValue(null as never);
  });

  it('devuelve el hogar vigente, para que el paso 2 arranque como resumen', async () => {
    vi.mocked(repo.buscarHogarActivo).mockResolvedValue(hogar() as never);

    const elegibilidad = await service.obtenerElegibilidad(SOLICITANTE, 40);

    expect(elegibilidad.hogar).toMatchObject({
      direccion: 'Av. Santa Fe 3450, Palermo',
      espacioExterior: 'Patio',
      horasSolo: 8,
    });
  });

  it('la primera solicitud del usuario no tiene nada que precargar', async () => {
    vi.mocked(repo.buscarHogarActivo).mockResolvedValue(null as never);

    await expect(service.obtenerElegibilidad(SOLICITANTE, 40)).resolves.toMatchObject({
      puedeSolicitar: true,
      hogar: null,
    });
  });
});

describe('preguntas del refugio en el formulario', () => {
  const PUBLICACION = 40;
  const REFUGIO_PUBLICADOR = 3;
  const ESPECIE_PERRO = 2;

  const NUEVA = {
    publicacionId: PUBLICACION,
    tipoSolicitud: 'Adopcion' as const,
    motivacion: 'Vivimos en una casa con patio y ya criamos perros grandes.',
    fechaInicioTransito: null,
    fechaFinTransito: null,
    hogar: {
      direccion: 'Av. Santa Fe 3450, Palermo',
      tipoVivienda: 'Casa' as const,
      espacioExterior: 'Patio' as const,
      tieneNinios: false,
      tieneMascotas: false,
      detalleMascotas: null,
      experienciaPrevia: true,
      horasSolo: 8 as const,
      descripcion: null,
    },
  };

  function pregunta(
    parcial: Partial<{
      id: number;
      texto: string;
      tipo: 'TEXTO' | 'SI_NO' | 'OPCIONES';
      opciones: string[];
      obligatoria: boolean;
    }> & { id: number },
  ) {
    return {
      texto: `Pregunta ${parcial.id}`,
      tipo: 'TEXTO' as const,
      opciones: [],
      obligatoria: false,
      ...parcial,
    };
  }

  /** Publicación de un refugio con una mascota de la especie dada. */
  function publicacionDeRefugio(refugioId: number | null = REFUGIO_PUBLICADOR) {
    return {
      id: PUBLICACION,
      historicoEstados: [{ estadoPublicacion: { nombre: 'Activa' } }],
      mascota: {
        id: 8,
        usuarioId: MIEMBRO_REFUGIO,
        refugioId,
        raza: { especieId: ESPECIE_PERRO },
        historicoEstados: [{ estadoMascota: { nombre: 'Disponible' } }],
      },
    };
  }

  beforeEach(() => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({
      ...usuario(SOLICITANTE, null),
      verificado: true,
    } as never);
    vi.mocked(repo.contarAbiertasDeUsuario).mockResolvedValue(0);
    vi.mocked(repo.buscarAbiertaDeUsuarioEnPublicacion).mockResolvedValue(null as never);
    vi.mocked(repo.buscarPublicacionParaSolicitar).mockResolvedValue(
      publicacionDeRefugio() as never,
    );
    vi.mocked(repo.buscarTipoSolicitudPorNombre).mockResolvedValue({ id: 1 } as never);
    vi.mocked(repo.buscarEstadoSolicitudPorNombre).mockResolvedValue({ id: 1 } as never);
    vi.mocked(repo.buscarHogarActivo).mockResolvedValue(null as never);
    vi.mocked(repo.crearConHogar).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_PENDIENTE }) as never,
    );
  });

  describe('elegibilidad', () => {
    it('trae las preguntas aplicables a la especie de la mascota', async () => {
      const preguntas = [pregunta({ id: 7, obligatoria: true })];
      vi.mocked(preguntasAdopcion.preguntasAplicables).mockResolvedValue(preguntas);

      const resultado = await service.obtenerElegibilidad(SOLICITANTE, PUBLICACION);

      expect(preguntasAdopcion.preguntasAplicables).toHaveBeenCalledWith(
        REFUGIO_PUBLICADOR,
        ESPECIE_PERRO,
      );
      expect(resultado.preguntas).toEqual(preguntas);
    });

    it('una mascota de un adoptante particular no tiene preguntas propias', async () => {
      vi.mocked(repo.buscarPublicacionParaSolicitar).mockResolvedValue(
        publicacionDeRefugio(null) as never,
      );

      const resultado = await service.obtenerElegibilidad(SOLICITANTE, PUBLICACION);

      expect(resultado.preguntas).toEqual([]);
      expect(preguntasAdopcion.preguntasAplicables).not.toHaveBeenCalled();
    });

    it('si no puede solicitar no se consultan: no va a abrir el formulario', async () => {
      vi.mocked(repo.contarAbiertasDeUsuario).mockResolvedValue(5);

      const resultado = await service.obtenerElegibilidad(SOLICITANTE, PUBLICACION);

      expect(resultado.puedeSolicitar).toBe(false);
      expect(resultado.preguntas).toEqual([]);
      expect(preguntasAdopcion.preguntasAplicables).not.toHaveBeenCalled();
    });

    it('sin publicación solo se evalúa al usuario', async () => {
      const resultado = await service.obtenerElegibilidad(SOLICITANTE);

      expect(resultado.preguntas).toEqual([]);
    });
  });

  describe('alta', () => {
    it('guarda cada respuesta con la copia del texto que se preguntó, en el orden del refugio', async () => {
      vi.mocked(preguntasAdopcion.preguntasAplicables).mockResolvedValue([
        pregunta({ id: 7, texto: '¿Tenés veterinario cerca?', tipo: 'SI_NO', obligatoria: true }),
        pregunta({ id: 9, texto: '¿Qué harías si se enferma?' }),
      ]);

      await service.crearSolicitud(
        {
          ...NUEVA,
          respuestas: [
            { preguntaId: 9, respuesta: '  Lo llevaría al veterinario  ' },
            { preguntaId: 7, respuesta: 'Sí' },
          ],
        },
        SOLICITANTE,
      );

      expect(repo.crearConHogar).toHaveBeenCalledWith(
        SOLICITANTE,
        expect.anything(),
        expect.anything(),
        1,
        [
          { preguntaAdopcionId: 7, preguntaTexto: '¿Tenés veterinario cerca?', respuesta: 'Sí' },
          {
            preguntaAdopcionId: 9,
            preguntaTexto: '¿Qué harías si se enferma?',
            respuesta: 'Lo llevaría al veterinario',
          },
        ],
      );
    });

    it('una pregunta opcional sin responder no se guarda', async () => {
      vi.mocked(preguntasAdopcion.preguntasAplicables).mockResolvedValue([pregunta({ id: 9 })]);

      await service.crearSolicitud(
        { ...NUEVA, respuestas: [{ preguntaId: 9, respuesta: '' }] },
        SOLICITANTE,
      );

      expect(repo.crearConHogar).toHaveBeenCalledWith(
        SOLICITANTE,
        expect.anything(),
        expect.anything(),
        1,
        [],
      );
    });

    it('una obligatoria que el formulario no mandó significa que no la conocía: 409', async () => {
      vi.mocked(preguntasAdopcion.preguntasAplicables).mockResolvedValue([
        pregunta({ id: 7, obligatoria: true }),
      ]);

      await expect(
        service.crearSolicitud({ ...NUEVA, respuestas: [] }, SOLICITANTE),
      ).rejects.toMatchObject({
        codigo: 'PREGUNTAS_DESACTUALIZADAS',
        httpStatus: 409,
      });
      expect(repo.crearConHogar).not.toHaveBeenCalled();
    });

    it('una obligatoria en blanco dice cuál falta', async () => {
      vi.mocked(preguntasAdopcion.preguntasAplicables).mockResolvedValue([
        pregunta({ id: 7, texto: '¿Tenés veterinario cerca?', obligatoria: true }),
      ]);

      await expect(
        service.crearSolicitud(
          { ...NUEVA, respuestas: [{ preguntaId: 7, respuesta: '   ' }] },
          SOLICITANTE,
        ),
      ).rejects.toMatchObject({
        codigo: 'RESPUESTAS_INVALIDAS',
        mensaje: 'Falta responder: ¿Tenés veterinario cerca?',
        httpStatus: 400,
      });
    });

    it('SI_NO solo acepta "Sí" o "No"', async () => {
      vi.mocked(preguntasAdopcion.preguntasAplicables).mockResolvedValue([
        pregunta({ id: 7, tipo: 'SI_NO' }),
      ]);

      await expect(
        service.crearSolicitud(
          { ...NUEVA, respuestas: [{ preguntaId: 7, respuesta: 'Tal vez' }] },
          SOLICITANTE,
        ),
      ).rejects.toMatchObject({ codigo: 'RESPUESTAS_INVALIDAS' });
    });

    it('OPCIONES solo acepta una de las opciones ofrecidas', async () => {
      vi.mocked(preguntasAdopcion.preguntasAplicables).mockResolvedValue([
        pregunta({ id: 7, tipo: 'OPCIONES', opciones: ['Casa', 'Departamento'] }),
      ]);

      await expect(
        service.crearSolicitud(
          { ...NUEVA, respuestas: [{ preguntaId: 7, respuesta: 'Carpa' }] },
          SOLICITANTE,
        ),
      ).rejects.toMatchObject({ codigo: 'RESPUESTAS_INVALIDAS' });

      await expect(
        service.crearSolicitud(
          { ...NUEVA, respuestas: [{ preguntaId: 7, respuesta: 'Casa' }] },
          SOLICITANTE,
        ),
      ).resolves.toBeDefined();
    });

    it('ignora la respuesta a una pregunta que ya no aplica', async () => {
      vi.mocked(preguntasAdopcion.preguntasAplicables).mockResolvedValue([]);

      await service.crearSolicitud(
        { ...NUEVA, respuestas: [{ preguntaId: 99, respuesta: 'Lo que sea' }] },
        SOLICITANTE,
      );

      expect(repo.crearConHogar).toHaveBeenCalledWith(
        SOLICITANTE,
        expect.anything(),
        expect.anything(),
        1,
        [],
      );
    });

    it('con una mascota de un particular no consulta preguntas ni guarda respuestas', async () => {
      vi.mocked(repo.buscarPublicacionParaSolicitar).mockResolvedValue(
        publicacionDeRefugio(null) as never,
      );

      await service.crearSolicitud(
        { ...NUEVA, respuestas: [{ preguntaId: 7, respuesta: 'Sí' }] },
        SOLICITANTE,
      );

      expect(preguntasAdopcion.preguntasAplicables).not.toHaveBeenCalled();
      expect(repo.crearConHogar).toHaveBeenCalledWith(
        SOLICITANTE,
        expect.anything(),
        expect.anything(),
        1,
        [],
      );
    });
  });
});

describe('detalle según quién lo mira', () => {
  const conExtras = () => ({
    ...solicitudConDetalle({ historial: HISTORIAL_REVISADA }),
    notaInterna: 'Hablé con ella por teléfono, muy buena onda.',
    mascotaAdoptadaId: 99,
    respuestas: [{ preguntaTexto: '¿Tenés veterinario cerca?', respuesta: 'Sí' }],
  });

  beforeEach(() => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(conExtras() as never);
  });

  it('quien publicó ve la nota privada y no la mascota adoptada', async () => {
    const detalle = await service.obtenerDetalle(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');

    expect(detalle.notaInterna).toBe('Hablé con ella por teléfono, muy buena onda.');
    expect(detalle.mascotaAdoptadaId).toBeNull();
  });

  it('el solicitante nunca recibe la nota privada, ni siquiera la clave', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuario(SOLICITANTE, null) as never);

    const detalle = await service.obtenerDetalle(SOLICITUD, SOLICITANTE, 'PERSONAL');

    expect('notaInterna' in detalle).toBe(false);
    expect(JSON.stringify(detalle)).not.toContain('buena onda');
    expect(detalle.mascotaAdoptadaId).toBe(99);
  });

  it('dice quién publicó: el refugio, o la persona si la mascota es particular', async () => {
    const delRefugio = await service.obtenerDetalle(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');
    expect(delRefugio.publicador).toEqual({
      nombre: 'Refugio Patitas',
      imagenUrl: '/api/v1/archivos/logo.jpg',
      esRefugio: true,
    });

    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuario(ADOPTANTE_PUBLICADOR, null) as never,
    );
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        mascotaRefugioId: null,
        mascotaUsuarioId: ADOPTANTE_PUBLICADOR,
        historial: HISTORIAL_REVISADA,
      }) as never,
    );

    const particular = await service.obtenerDetalle(SOLICITUD, ADOPTANTE_PUBLICADOR, 'PERSONAL');
    expect(particular.publicador).toEqual({
      nombre: 'Carla Gómez',
      imagenUrl: null,
      esRefugio: false,
    });
  });

  it('suma lo que necesita quien evalúa: requisitos, respuestas, perfil y conversación', async () => {
    const detalle = await service.obtenerDetalle(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');

    expect(detalle.mascota.requisitos).toEqual(['Casa con patio', 'Sin otros perros']);
    expect(detalle.mascota.genero).toBe('MACHO');
    expect(detalle.respuestas).toEqual([
      { pregunta: '¿Tenés veterinario cerca?', respuesta: 'Sí' },
    ]);
    expect(detalle.solicitante).toMatchObject({
      localidad: 'Godoy Cruz',
      provincia: 'Mendoza',
      verificado: true,
      miembroDesde: '2026-03-02',
    });
    expect(detalle.chatId).toBe(87);
  });

  it('del solicitante muestra una lista blanca: ni documento ni contacto', async () => {
    const detalle = await service.obtenerDetalle(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');

    expect(Object.keys(detalle.solicitante).sort()).toEqual([
      'apellido',
      'id',
      'imagenUrl',
      'localidad',
      'miembroDesde',
      'nombre',
      'provincia',
      'verificado',
    ]);
  });

  it('si la sala no existe o no se pudo leer, chatId va null', async () => {
    vi.mocked(chats.chatIdDeSolicitud).mockRejectedValue(new Error('base caída'));

    const detalle = await service.obtenerDetalle(SOLICITUD, MIEMBRO_REFUGIO, 'REFUGIO');

    expect(detalle.chatId).toBeNull();
  });
});

describe('guardarNota', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({ historial: HISTORIAL_REVISADA }) as never,
    );
    vi.mocked(repo.guardarNota).mockImplementation(
      (_id: number, texto: string | null) =>
        Promise.resolve({
          ...solicitudConDetalle({ historial: HISTORIAL_REVISADA }),
          notaInterna: texto,
        }) as never,
    );
  });

  it('quien publicó la guarda y la recibe de vuelta', async () => {
    const detalle = await service.guardarNota(
      SOLICITUD,
      { texto: 'Tiene experiencia con la raza.' },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(repo.guardarNota).toHaveBeenCalledWith(
      SOLICITUD,
      'Tiene experiencia con la raza.',
      MIEMBRO_REFUGIO,
    );
    expect(detalle.notaInterna).toBe('Tiene experiencia con la raza.');
  });

  it('con null la borra', async () => {
    const detalle = await service.guardarNota(
      SOLICITUD,
      { texto: null },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(repo.guardarNota).toHaveBeenCalledWith(SOLICITUD, null, MIEMBRO_REFUGIO);
    expect(detalle.notaInterna).toBeNull();
  });

  it('el solicitante no puede escribirla: no es suya (404)', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuario(SOLICITANTE, null) as never);

    await expect(
      service.guardarNota(SOLICITUD, { texto: 'Quiero adoptarlo' }, SOLICITANTE, 'PERSONAL'),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO', httpStatus: 404 });
    expect(repo.guardarNota).not.toHaveBeenCalled();
  });

  it('un miembro de otro refugio tampoco (404)', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        mascotaRefugioId: OTRO_REFUGIO_ID,
        historial: HISTORIAL_REVISADA,
      }) as never,
    );

    await expect(
      service.guardarNota(SOLICITUD, { texto: 'x' }, MIEMBRO_REFUGIO, 'REFUGIO'),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });
});
