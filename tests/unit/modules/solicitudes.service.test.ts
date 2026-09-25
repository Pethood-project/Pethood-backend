import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLAGS } from '../../../src/config/flags';
import { AppError } from '../../../src/middlewares/errorHandler';
import * as logAuditoria from '../../../src/shared/logAuditoria';
import * as repo from '../../../src/modules/solicitudes/solicitudes.repository';
import * as service from '../../../src/modules/solicitudes/solicitudes.service';

vi.mock('../../../src/modules/solicitudes/solicitudes.repository');
vi.mock('../../../src/shared/logAuditoria');

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
function historialFila(estadoObj: { id: number; nombre: string }, fechaAlta: Date) {
  return { estadoSolicitud: estadoObj, fechaAlta };
}

/** `usuario` tal como lo devuelve `buscarUsuarioConRefugio`. */
function usuario(id: number, refugioId: number | null) {
  return { id, refugioId, fechaBaja: null };
}

/**
 * Solicitud con detalle tal como la devuelve `buscarConDetalle`/`resolverSiPendiente`.
 * `mascotaRefugioId` null = mascota publicada por un adoptante particular
 * (`mascotaUsuarioId` es quien la publicó); no nulo = mascota de un refugio.
 */
function solicitudConDetalle(opciones: {
  mascotaRefugioId?: number | null;
  mascotaUsuarioId?: number;
  historial: { estado: { id: number; nombre: string }; fecha: Date }[];
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
      mascota: {
        id: 8,
        nombre: 'Toby',
        imagenUrl: '/img/toby.jpg',
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
      // `take: 1` sobre los hogares activos: un usuario tiene uno solo vigente.
      hogares: vigente ? [vigente] : [],
    },
    tipoSolicitud: { nombre: transito ? 'Transito' : 'Adopcion' },
    historicoEstados: historial.map((h) => historialFila(h.estado, h.fecha)),
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
      { id: 3, nombre: 'Aprobada', fecha: FECHA_RESPUESTA.toISOString() },
      { id: 1, nombre: 'Pendiente', fecha: FECHA_ALTA.toISOString() },
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

describe('resolverSolicitud', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
      }) as never,
    );
    vi.mocked(repo.buscarEstadoSolicitudPorNombre).mockResolvedValue(
      estado(3, 'Aprobada') as never,
    );
    vi.mocked(repo.resolverSiPendiente).mockResolvedValue(
      solicitudConDetalle({
        comentario: 'Bienvenido a la familia',
        fechaRespuesta: FECHA_RESPUESTA,
        historial: [
          { estado: estado(3, 'Aprobada'), fecha: FECHA_RESPUESTA },
          { estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA },
        ],
      }) as never,
    );
  });

  it('acepta una solicitud pendiente', async () => {
    const resultado = await service.resolverSolicitud(
      SOLICITUD,
      { estado: 'Aprobada', comentario: 'Bienvenido a la familia' },
      MIEMBRO_REFUGIO,
      'REFUGIO',
    );

    expect(resultado.estado.nombre).toBe('Aprobada');
    expect(repo.resolverSiPendiente).toHaveBeenCalledWith(
      SOLICITUD,
      3,
      'Bienvenido a la familia',
      MIEMBRO_REFUGIO,
    );
  });

  it('un adoptante particular puede resolver la solicitud de su propia mascota publicada', async () => {
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
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        ADOPTANTE_PUBLICADOR,
        'PERSONAL',
      ),
    ).resolves.toMatchObject({ estado: { nombre: 'Aprobada' } });
  });

  it('rechaza resolver una solicitud que ya no está pendiente (chequeo previo, sin llegar a la DB)', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        historial: [{ estado: estado(3, 'Aprobada'), fecha: FECHA_RESPUESTA }],
      }) as never,
    );

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Rechazada', comentario: null },
        MIEMBRO_REFUGIO,
        'REFUGIO',
      ),
    ).rejects.toMatchObject({ codigo: 'SOLICITUD_YA_RESUELTA', httpStatus: 409 });
    expect(repo.resolverSiPendiente).not.toHaveBeenCalled();
  });

  it('dos PATCH concurrentes: el que pierde la carrera atómica recibe 409, no pisa el histórico', async () => {
    // El chequeo previo la ve "Pendiente", pero para cuando la transacción Serializable
    // corre, el otro PATCH ya ganó — resolverSiPendiente devuelve null.
    vi.mocked(repo.resolverSiPendiente).mockResolvedValue(null as never);

    await expect(
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        MIEMBRO_REFUGIO,
        'REFUGIO',
      ),
    ).rejects.toMatchObject({ codigo: 'SOLICITUD_YA_RESUELTA', httpStatus: 409 });
  });

  it('un miembro de OTRO refugio no puede resolverla (404)', async () => {
    vi.mocked(repo.buscarConDetalle).mockResolvedValue(
      solicitudConDetalle({
        mascotaRefugioId: OTRO_REFUGIO_ID,
        historial: [{ estado: estado(1, 'Pendiente'), fecha: FECHA_ALTA }],
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
    expect(repo.resolverSiPendiente).not.toHaveBeenCalled();
  });

  it('un adoptante no puede resolver la solicitud de la mascota de OTRO adoptante (404)', async () => {
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
      service.resolverSolicitud(
        SOLICITUD,
        { estado: 'Aprobada', comentario: null },
        OTRO_ADOPTANTE,
        'PERSONAL',
      ),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO', httpStatus: 404 });
    expect(repo.resolverSiPendiente).not.toHaveBeenCalled();
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
      detalle: 'Pendiente -> Aprobada',
    });
  });

  it('no registra auditoría si pierde la carrera atómica', async () => {
    vi.mocked(repo.resolverSiPendiente).mockResolvedValue(null as never);

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
  ) {
    return {
      id: PUBLICACION,
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
    vi.mocked(repo.contarPendientesDeUsuario).mockResolvedValue(0);
    vi.mocked(repo.buscarVivaDeUsuarioEnPublicacion).mockResolvedValue(null as never);
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
    );
  });

  it('deriva tienePatio del espacio exterior elegido', async () => {
    await service.crearSolicitud(NUEVA, SOLICITANTE);

    expect(repo.crearConHogar).toHaveBeenCalledWith(
      SOLICITANTE,
      expect.anything(),
      expect.objectContaining({ espacioExterior: 'Patio', tienePatio: true }),
      expect.anything(),
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
    vi.mocked(repo.contarPendientesDeUsuario).mockResolvedValue(5);

    await expect(service.crearSolicitud(NUEVA, SOLICITANTE)).rejects.toMatchObject({
      codigo: 'LIMITE_SOLICITUDES',
      mensaje: 'No podés solicitar otra mascota',
    });
  });

  it('no se puede solicitar dos veces la misma publicación', async () => {
    vi.mocked(repo.buscarVivaDeUsuarioEnPublicacion).mockResolvedValue({ id: 99 } as never);

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
    vi.mocked(repo.contarPendientesDeUsuario).mockResolvedValue(2);
    vi.mocked(repo.buscarVivaDeUsuarioEnPublicacion).mockResolvedValue(null as never);
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
    vi.mocked(repo.contarPendientesDeUsuario).mockResolvedValue(5);

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
    vi.mocked(repo.buscarVivaDeUsuarioEnPublicacion).mockResolvedValue({ id: 1042 } as never);

    await expect(service.obtenerElegibilidad(SOLICITANTE, 40)).resolves.toMatchObject({
      motivo: 'YA_SOLICITADA',
      solicitudAbiertaId: 1042,
    });
  });

  it('sin publicación solo evalúa al usuario: sirve para habilitar el botón de un listado', async () => {
    vi.mocked(repo.contarPendientesDeUsuario).mockResolvedValue(5);

    await expect(service.obtenerElegibilidad(SOLICITANTE)).resolves.toMatchObject({
      motivo: 'LIMITE_ALCANZADO',
      solicitudAbiertaId: null,
    });
    expect(repo.buscarVivaDeUsuarioEnPublicacion).not.toHaveBeenCalled();
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
    expect(repo.resolverSiPendiente).not.toHaveBeenCalled();
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
    vi.mocked(repo.contarPendientesDeUsuario).mockResolvedValue(0);
    vi.mocked(repo.buscarVivaDeUsuarioEnPublicacion).mockResolvedValue(null as never);
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
