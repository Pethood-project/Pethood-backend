import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../../../src/modules/seguimiento/seguimiento.repository';
import * as service from '../../../../src/modules/seguimiento/seguimiento.service';
import { borrarImagen, guardarImagen } from '../../../../src/shared/storage';
import { registrarAuditoria } from '../../../../src/shared/logAuditoria';

vi.mock('../../../../src/modules/seguimiento/seguimiento.repository');
vi.mock('../../../../src/shared/storage');
vi.mock('../../../../src/shared/logAuditoria');

const AHORA = new Date('2026-06-10T12:00:00.000Z');
/** 9 días antes de AHORA: en adopción ya vencieron los pedidos de día 2 y día 7. */
const APROBACION = new Date('2026-06-01T12:00:00.000Z');

const ADOPTANTE = { id: 7, refugioId: null };
const PUBLICADOR = { id: 3, refugioId: null };
const STAFF_REFUGIO = { id: 9, refugioId: 1 };
const AJENO = { id: 99, refugioId: null };

const ARCHIVO = { buffer: Buffer.from('foto'), mimetype: 'image/jpeg' };
const FOTO_URL = '/api/v1/archivos/seguimientos/x.jpg';

interface OverridesPedido {
  descripcion?: string | null;
  fotoUrl?: string | null;
  plazo?: Date | null;
  fechaModificacion?: Date | null;
  fechaAlta?: Date;
  preguntaSeguimientoId?: number;
}

/** Un pedido ya respondido: descripción, foto y fecha de respuesta van siempre juntas. */
function pedidoRespondido(id: number, descripcion = 'Come dos veces por día y subió 300 g') {
  return pedido(id, {
    descripcion,
    fotoUrl: FOTO_URL,
    fechaModificacion: new Date('2026-06-05T10:00:00.000Z'),
  });
}

function pedido(id: number, overrides: OverridesPedido = {}) {
  return {
    id,
    descripcion: null,
    fotoUrl: null,
    // Por defecto el plazo está en el futuro: PENDIENTE.
    plazo: new Date('2026-06-30T12:00:00.000Z'),
    solicitudId: 1,
    preguntaSeguimientoId: 10,
    usuarioAlta: 1,
    fechaAlta: new Date('2026-06-03T12:00:00.000Z'),
    usuarioModificacion: null,
    fechaModificacion: null,
    usuarioBaja: null,
    fechaBaja: null,
    preguntaSeguimiento: { id: 10, texto: '¿Está comiendo bien?' },
    ...overrides,
  };
}

function solicitud(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    usuarioId: ADOPTANTE.id,
    publicacionId: 5,
    tipoSolicitud: { id: 1, nombre: 'Adopcion' },
    usuario: { id: ADOPTANTE.id, nombre: 'Ana', apellido: 'Gomez' },
    publicacion: {
      id: 5,
      usuarioId: PUBLICADOR.id,
      mascota: { id: 4, nombre: 'Rex', imagenUrl: null, refugioId: 1 },
    },
    historicoEstados: [{ id: 1, fechaAlta: APROBACION, estadoSolicitud: { nombre: 'Aprobada' } }],
    // Los dos pedidos que ya correspondían a los 9 días: así no se generan nuevos salvo que
    // el test lo busque a propósito.
    seguimientos: [pedido(30), pedido(31)],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(guardarImagen).mockResolvedValue(FOTO_URL);
  vi.mocked(repo.listarPreguntas).mockResolvedValue([{ id: 10, texto: '¿Está comiendo bien?' }]);
  vi.mocked(repo.crearPedidos).mockResolvedValue([] as never);
  vi.mocked(registrarAuditoria).mockResolvedValue(undefined);
});

describe('obtenerSeguimientosDeSolicitud — acceso', () => {
  it('404 si la solicitud no existe', async () => {
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(null as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);

    await expect(
      service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO', httpStatus: 404 });
  });

  it('404 si la solicitud no está aprobada: sin aprobación no hay seguimiento', async () => {
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(
      solicitud({
        historicoEstados: [
          { id: 2, fechaAlta: APROBACION, estadoSolicitud: { nombre: 'Pendiente' } },
        ],
      }) as never,
    );
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);

    await expect(
      service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO', httpStatus: 404 });
  });

  it('403 si el usuario no es ni el adoptante ni el publicador', async () => {
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(solicitud() as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(AJENO as never);

    await expect(service.obtenerSeguimientosDeSolicitud(1, AJENO.id, AHORA)).rejects.toMatchObject({
      codigo: 'NO_AUTORIZADO',
      httpStatus: 403,
    });
  });

  it('el personal del refugio dueño de la mascota entra como PUBLICADOR', async () => {
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(solicitud() as never);
    vi.mocked(repo.buscarUsuario).mockResolvedValue(STAFF_REFUGIO as never);

    const detalle = await service.obtenerSeguimientosDeSolicitud(1, STAFF_REFUGIO.id, AHORA);

    expect(detalle.rol).toBe('PUBLICADOR');
    expect(detalle.puedeSubirActualizacion).toBe(false);
  });
});

describe('obtenerSeguimientosDeSolicitud — estados derivados (HU-9.2)', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
  });

  it('un pedido respondido figura COMPLETADO con su fecha de respuesta', async () => {
    const respondido = pedido(30, {
      descripcion: 'Come bien y juega',
      fechaModificacion: new Date('2026-06-05T10:00:00.000Z'),
    });
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(
      solicitud({ seguimientos: [respondido, pedido(31)] }) as never,
    );

    const detalle = await service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA);
    const item = detalle.seguimientos.find((seguimiento) => seguimiento.id === 30)!;

    expect(item.estado).toBe('COMPLETADO');
    expect(item.fechaRespuesta).toBe('2026-06-05T10:00:00.000Z');
  });

  it('un pedido sin responder con el plazo cumplido figura VENCIDO', async () => {
    const vencido = pedido(30, { plazo: new Date('2026-06-05T12:00:00.000Z') });
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(
      solicitud({ seguimientos: [vencido, pedido(31)] }) as never,
    );

    const detalle = await service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA);

    expect(detalle.seguimientos.find((seguimiento) => seguimiento.id === 30)!.estado).toBe(
      'VENCIDO',
    );
  });

  it('el adoptante puede subir mientras haya un pedido dentro del plazo', async () => {
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(solicitud() as never);

    const detalle = await service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA);

    expect(detalle.puedeSubirActualizacion).toBe(true);
  });

  it('sin pedidos pendientes el botón queda deshabilitado (GUI-21 lo pinta en gris)', async () => {
    const vencido = pedido(30, { plazo: new Date('2026-06-05T12:00:00.000Z') });
    const completo = pedido(31, { descripcion: 'Todo bien' });
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(
      solicitud({ seguimientos: [vencido, completo] }) as never,
    );

    const detalle = await service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA);

    expect(detalle.puedeSubirActualizacion).toBe(false);
  });

  it('una solicitud recién aprobada no tiene pedidos todavía', async () => {
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(
      solicitud({
        historicoEstados: [{ id: 1, fechaAlta: AHORA, estadoSolicitud: { nombre: 'Aprobada' } }],
        seguimientos: [],
      }) as never,
    );

    const detalle = await service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA);

    expect(detalle.seguimientos).toEqual([]);
    expect(detalle.puedeSubirActualizacion).toBe(false);
    expect(repo.crearPedidos).not.toHaveBeenCalled();
  });
});

describe('sincronización de pedidos', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
  });

  it('materializa los pedidos cuya fecha ya llegó, con plazo de 48 h', async () => {
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(solicitud({ seguimientos: [] }) as never);
    vi.mocked(repo.crearPedidos).mockResolvedValue([pedido(40), pedido(41)] as never);

    await service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA);

    const [pedidosCreados, usuarioAlta] = vi.mocked(repo.crearPedidos).mock.calls[0]!;
    // A los 9 días de aprobada corresponden los pedidos de día 2 y día 7.
    expect(pedidosCreados).toHaveLength(2);
    expect(pedidosCreados[0]!.fechaPedido).toEqual(new Date('2026-06-03T12:00:00.000Z'));
    expect(pedidosCreados[0]!.plazo).toEqual(new Date('2026-06-05T12:00:00.000Z'));
    // El pedido lo genera el sistema, no una persona.
    expect(usuarioAlta).toBe(1);
  });

  it('no vuelve a crear los pedidos que ya existen', async () => {
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(solicitud() as never);

    await service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA);

    expect(repo.crearPedidos).not.toHaveBeenCalled();
  });

  it('sin preguntas cargadas no rompe el listado, solo no genera pedidos', async () => {
    vi.mocked(repo.listarPreguntas).mockResolvedValue([]);
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(solicitud({ seguimientos: [] }) as never);

    const detalle = await service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA);

    expect(detalle.seguimientos).toEqual([]);
    expect(repo.crearPedidos).not.toHaveBeenCalled();
  });

  it('pasados 5 días del fin del tránsito da de baja los pedidos (HU-9.1)', async () => {
    const aprobacionVieja = new Date('2025-01-01T12:00:00.000Z');
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(
      solicitud({
        tipoSolicitud: { id: 2, nombre: 'Transito' },
        historicoEstados: [
          { id: 1, fechaAlta: aprobacionVieja, estadoSolicitud: { nombre: 'Aprobada' } },
        ],
      }) as never,
    );

    const detalle = await service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA);

    expect(repo.darDeBajaSeguimientosDeSolicitud).toHaveBeenCalledWith(1, 1);
    expect(detalle.seguimientos).toEqual([]);
  });
});

describe('aviso al publicador por seguimiento vencido (HU-9.1)', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
  });

  it('notifica a quien publicó, con el mensaje literal y el nombre de la mascota', async () => {
    const vencido = pedido(30, { plazo: new Date('2026-06-05T12:00:00.000Z') });
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(
      solicitud({ seguimientos: [vencido, pedido(31)] }) as never,
    );

    await service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA);

    expect(repo.crearNotificacion).toHaveBeenCalledWith({
      tipo: 'SEGUIMIENTO_VENCIDO',
      mensaje: 'Actualización de seguimiento no enviado — Rex',
      usuarioId: PUBLICADOR.id,
      usuarioAlta: 1,
    });
    expect(repo.marcarVencidosNotificados).toHaveBeenCalledWith([30], 1);
  });

  it('no repite el aviso de un vencido que ya se notificó', async () => {
    const yaAvisado = pedido(30, {
      plazo: new Date('2026-06-05T12:00:00.000Z'),
      fechaModificacion: new Date('2026-06-06T00:00:00.000Z'),
    });
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(
      solicitud({ seguimientos: [yaAvisado, pedido(31)] }) as never,
    );

    await service.obtenerSeguimientosDeSolicitud(1, ADOPTANTE.id, AHORA);

    expect(repo.crearNotificacion).not.toHaveBeenCalled();
  });
});

describe('subirActualizacion (HU-9.1)', () => {
  const DATOS = { descripcion: 'Está comiendo bien y subió de peso' };

  beforeEach(() => {
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(solicitud() as never);
  });

  it('guarda la actualización y devuelve el mensaje literal de la HU', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(pedido(30) as never);
    vi.mocked(repo.responderSeguimiento).mockResolvedValue(
      pedido(30, {
        descripcion: DATOS.descripcion,
        fechaModificacion: AHORA,
      }) as never,
    );

    const resultado = await service.subirActualizacion(
      30,
      DATOS,
      { usuarioId: ADOPTANTE.id, archivo: ARCHIVO },
      AHORA,
    );

    expect(resultado.mensaje).toBe('seguimiento cargado con exito');
    expect(resultado.seguimiento.estado).toBe('COMPLETADO');
    expect(repo.responderSeguimiento).toHaveBeenCalledWith(
      30,
      { descripcion: DATOS.descripcion, fotoUrl: FOTO_URL },
      ADOPTANTE.id,
    );
  });

  it('403 si lo intenta el publicador: solo responde quien tiene la mascota', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(PUBLICADOR as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(pedido(30) as never);

    await expect(
      service.subirActualizacion(30, DATOS, { usuarioId: PUBLICADOR.id, archivo: ARCHIVO }, AHORA),
    ).rejects.toMatchObject({ codigo: 'NO_AUTORIZADO', httpStatus: 403 });

    expect(guardarImagen).not.toHaveBeenCalled();
  });

  it('409 si el plazo de 48 h ya venció', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(
      pedido(30, { plazo: new Date('2026-06-05T12:00:00.000Z') }) as never,
    );

    await expect(
      service.subirActualizacion(30, DATOS, { usuarioId: ADOPTANTE.id, archivo: ARCHIVO }, AHORA),
    ).rejects.toMatchObject({ codigo: 'SEGUIMIENTO_VENCIDO', httpStatus: 409 });
  });

  it('409 si ese seguimiento ya fue respondido', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(
      pedido(30, { descripcion: 'Ya respondí' }) as never,
    );

    await expect(
      service.subirActualizacion(30, DATOS, { usuarioId: ADOPTANTE.id, archivo: ARCHIVO }, AHORA),
    ).rejects.toMatchObject({ codigo: 'SEGUIMIENTO_COMPLETADO', httpStatus: 409 });
  });

  it('400 con el texto literal si no viene la foto de evidencia', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(pedido(30) as never);

    await expect(
      service.subirActualizacion(30, DATOS, { usuarioId: ADOPTANTE.id }, AHORA),
    ).rejects.toMatchObject({ codigo: 'VALIDACION', mensaje: 'Adjuntar imagen de prueba' });
  });

  it('404 si el seguimiento no existe', async () => {
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(null as never);

    await expect(
      service.subirActualizacion(30, DATOS, { usuarioId: ADOPTANTE.id, archivo: ARCHIVO }, AHORA),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO', httpStatus: 404 });
  });

  it('borra la foto del storage si falla la escritura en base', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(pedido(30) as never);
    vi.mocked(repo.responderSeguimiento).mockRejectedValue(new Error('base caída'));

    await expect(
      service.subirActualizacion(30, DATOS, { usuarioId: ADOPTANTE.id, archivo: ARCHIVO }, AHORA),
    ).rejects.toThrow('base caída');

    expect(borrarImagen).toHaveBeenCalledWith(FOTO_URL);
  });
});

describe('obtenerActualizacion (HU-9.3)', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarSolicitud).mockResolvedValue(
      solicitud({ seguimientos: [pedidoRespondido(30), pedido(31)] }) as never,
    );
  });

  it('el publicador ve pregunta, descripción e imagen de una actualización completada', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(PUBLICADOR as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(pedidoRespondido(30) as never);

    const actualizacion = await service.obtenerActualizacion(30, PUBLICADOR.id, AHORA);

    expect(actualizacion.rol).toBe('PUBLICADOR');
    expect(actualizacion.estado).toBe('COMPLETADO');
    expect(actualizacion.pregunta).toBe('¿Está comiendo bien?');
    expect(actualizacion.descripcion).toBe('Come dos veces por día y subió 300 g');
    expect(actualizacion.fotoUrl).not.toBeNull();
    // Completada: no lleva mensaje de faltante, se muestra el contenido real.
    expect(actualizacion.mensaje).toBeNull();
  });

  it('sin completar y dentro del plazo muestra solo la pregunta con el texto literal', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(PUBLICADOR as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(pedido(31) as never);

    const actualizacion = await service.obtenerActualizacion(31, PUBLICADOR.id, AHORA);

    expect(actualizacion.estado).toBe('PENDIENTE');
    expect(actualizacion.mensaje).toBe('Aún no se sube actualización de este seguimiento');
    expect(actualizacion.descripcion).toBeNull();
    expect(actualizacion.fotoUrl).toBeNull();
  });

  it('sin completar y pasado el plazo muestra el otro texto literal', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(PUBLICADOR as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(
      pedido(31, { plazo: new Date('2026-06-05T12:00:00.000Z') }) as never,
    );

    const actualizacion = await service.obtenerActualizacion(31, PUBLICADOR.id, AHORA);

    expect(actualizacion.estado).toBe('VENCIDO');
    expect(actualizacion.mensaje).toBe('No se subió actualización de seguimiento');
    expect(actualizacion.descripcion).toBeNull();
  });

  it('el adoptante puede releer lo que él mismo cargó', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(pedidoRespondido(30) as never);

    const actualizacion = await service.obtenerActualizacion(30, ADOPTANTE.id, AHORA);

    expect(actualizacion.rol).toBe('ADOPTANTE');
    expect(actualizacion.estado).toBe('COMPLETADO');
    expect(actualizacion.descripcion).toBe('Come dos veces por día y subió 300 g');
  });

  it('trae el contexto de la mascota, porque se puede entrar desde una notificación', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(STAFF_REFUGIO as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(pedido(31) as never);

    const actualizacion = await service.obtenerActualizacion(31, STAFF_REFUGIO.id, AHORA);

    expect(actualizacion.mascota.nombre).toBe('Rex');
    expect(actualizacion.adoptante).toEqual({ id: ADOPTANTE.id, nombre: 'Ana', apellido: 'Gomez' });
    expect(actualizacion.solicitudId).toBe(1);
    expect(actualizacion.tipo).toBe('Adopcion');
  });

  it('404 si el seguimiento no existe', async () => {
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(null as never);

    await expect(service.obtenerActualizacion(999, PUBLICADOR.id, AHORA)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('403 si el usuario no tiene nada que ver con la solicitud', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(AJENO as never);
    vi.mocked(repo.buscarSeguimiento).mockResolvedValue(pedido(30) as never);

    await expect(service.obtenerActualizacion(30, AJENO.id, AHORA)).rejects.toMatchObject({
      codigo: 'NO_AUTORIZADO',
      httpStatus: 403,
    });
  });
});

describe('listarMisSeguimientos (HU-9.2)', () => {
  it('resume cada solicitud con sus totales y el pedido pendiente', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    const vencido = pedido(30, { plazo: new Date('2026-06-05T12:00:00.000Z') });
    vi.mocked(repo.listarSolicitudesDeUsuario).mockResolvedValue([
      solicitud({ seguimientos: [vencido, pedido(31)] }),
    ] as never);

    const [resumen] = await service.listarMisSeguimientos(ADOPTANTE.id, AHORA);

    expect(resumen!.rol).toBe('ADOPTANTE');
    expect(resumen!.totales).toEqual({ completados: 0, vencidos: 1, pendientes: 1 });
    expect(resumen!.pendiente!.id).toBe(31);
    expect(resumen!.mascota.nombre).toBe('Rex');
  });

  it('descarta las solicitudes que no están aprobadas', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(ADOPTANTE as never);
    vi.mocked(repo.listarSolicitudesDeUsuario).mockResolvedValue([
      solicitud({
        historicoEstados: [
          { id: 2, fechaAlta: APROBACION, estadoSolicitud: { nombre: 'Rechazada' } },
        ],
      }),
    ] as never);

    expect(await service.listarMisSeguimientos(ADOPTANTE.id, AHORA)).toEqual([]);
  });
});
