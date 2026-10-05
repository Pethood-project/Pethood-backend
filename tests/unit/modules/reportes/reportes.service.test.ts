import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../src/middlewares/errorHandler';

vi.mock('../../../../src/modules/reportes/reportes.repository', () => ({
  buscarUsuario: vi.fn(),
  contarPendientesDelUsuario: vi.fn(),
  buscarPendienteDuplicado: vi.fn(),
  crear: vi.fn(),
  esViolacionDeUnicidad: vi.fn(),
  buscarReporte: vi.fn(),
  listar: vi.fn(),
  listarDeObjeto: vi.fn(),
  listarPersonas: vi.fn(),
  resolver: vi.fn(),
  esParticipanteDelChat: vi.fn(),
  ventanaDeMensajes: vi.fn(),
  contarPorObjeto: vi.fn(),
  BUSCAR_OBJETO: {
    PUBLICACION: vi.fn(),
    USUARIO: vi.fn(),
    REFUGIO: vi.fn(),
    RESENA: vi.fn(),
    ANIMAL_PERDIDO: vi.fn(),
    CAMPANIA: vi.fn(),
    MENSAJE: vi.fn(),
  },
}));

vi.mock('../../../../src/shared/logAuditoria', () => ({
  registrarAuditoria: vi.fn().mockResolvedValue(undefined),
}));

import * as repo from '../../../../src/modules/reportes/reportes.repository';
import {
  crearReporte,
  obtener,
  resolver,
  VENTANA_CONTEXTO_MENSAJES,
} from '../../../../src/modules/reportes/reportes.service';

const mockedRepo = vi.mocked(repo);
const buscar = mockedRepo.BUSCAR_OBJETO;

const ACTOR = { id: 5, refugioId: 9 };
const MOTIVO = 'La foto no corresponde.';

function publicacionAjena() {
  return {
    titulo: 'Firulais',
    usuarioId: 1,
    fechaBaja: null,
    mascota: { refugioId: null },
  } as never;
}

/** Filas completas, como las devuelve el repository (el service arma la vista con todo). */
function usuarioFila(cambios: Record<string, unknown> = {}) {
  return {
    id: 4,
    nombre: 'Ana',
    apellido: 'Pérez',
    email: 'ana@x.com',
    telefono: null,
    imagenUrl: null,
    verificado: true,
    provincia: null,
    localidad: null,
    fechaAlta: new Date('2026-03-02T00:00:00Z'),
    fechaBaja: null,
    estado: { nombre: 'Activo' },
    refugio: null,
    ...cambios,
  } as never;
}

function refugioFila(cambios: Record<string, unknown> = {}) {
  return {
    id: 9,
    nombre: 'Patitas',
    imagenUrl: null,
    fechaBaja: null,
    estado: { nombre: 'Activo' },
    ...cambios,
  } as never;
}

function campaniaFila(cambios: Record<string, unknown> = {}) {
  return {
    titulo: 'Techo',
    descripcion: 'Para los caniles',
    objetivo: '10000',
    fechaInicio: new Date('2026-09-01T00:00:00Z'),
    fechaFin: new Date('2026-12-01T00:00:00Z'),
    imagenUrl: null,
    refugioId: 9,
    fechaBaja: null,
    estadoCampania: { nombre: 'Activa' },
    refugio: { id: 9, nombre: 'Patitas' },
    donaciones: [],
    ...cambios,
  } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedRepo.contarPorObjeto.mockResolvedValue(new Map());
  mockedRepo.buscarUsuario.mockResolvedValue(ACTOR as never);
  mockedRepo.buscarPendienteDuplicado.mockResolvedValue(null);
  mockedRepo.contarPendientesDelUsuario.mockResolvedValue(0);
  mockedRepo.crear.mockResolvedValue({
    id: 70,
    tipo: 'PUBLICACION',
    objetoId: 12,
    motivo: MOTIVO,
    fechaAlta: new Date('2026-10-01'),
  } as never);
});

async function codigoDeError(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (err) {
    return (err as AppError).codigo;
  }
  return 'SIN_ERROR';
}

describe('crearReporte', () => {
  it('crea el reporte de una publicación ajena', async () => {
    buscar.PUBLICACION.mockResolvedValue(publicacionAjena());

    const reporte = await crearReporte(5, { tipo: 'PUBLICACION', objetoId: 12, motivo: MOTIVO });

    expect(reporte).toMatchObject({ id: 70, tipo: 'PUBLICACION', resuelto: false });
    expect(mockedRepo.crear).toHaveBeenCalledWith({
      usuarioId: 5,
      tipo: 'PUBLICACION',
      objetoId: 12,
      motivo: MOTIVO,
    });
  });

  it('responde NO_ENCONTRADO si el objeto no existe o está de baja', async () => {
    buscar.USUARIO.mockResolvedValue(null);

    expect(
      await codigoDeError(crearReporte(5, { tipo: 'USUARIO', objetoId: 3, motivo: MOTIVO })),
    ).toBe('NO_ENCONTRADO');
    expect(mockedRepo.crear).not.toHaveBeenCalled();
  });

  it('no deja reportarse a uno mismo', async () => {
    buscar.USUARIO.mockResolvedValue(usuarioFila({ id: 5 }));

    expect(
      await codigoDeError(crearReporte(5, { tipo: 'USUARIO', objetoId: 5, motivo: MOTIVO })),
    ).toBe('REPORTE_PROPIO');
  });

  it('no deja reportar la publicación de un refugio al que se pertenece', async () => {
    buscar.PUBLICACION.mockResolvedValue({
      titulo: 'Rocky',
      usuarioId: 2,
      fechaBaja: null,
      mascota: { refugioId: 9 },
    } as never);

    expect(
      await codigoDeError(crearReporte(5, { tipo: 'PUBLICACION', objetoId: 1, motivo: MOTIVO })),
    ).toBe('REPORTE_PROPIO');
  });

  it('no deja reportar el propio refugio ni su campaña, pero sí uno ajeno', async () => {
    buscar.REFUGIO.mockResolvedValue(refugioFila());
    expect(
      await codigoDeError(crearReporte(5, { tipo: 'REFUGIO', objetoId: 9, motivo: MOTIVO })),
    ).toBe('REPORTE_PROPIO');

    buscar.CAMPANIA.mockResolvedValue(campaniaFila());
    expect(
      await codigoDeError(crearReporte(5, { tipo: 'CAMPANIA', objetoId: 2, motivo: MOTIVO })),
    ).toBe('REPORTE_PROPIO');

    buscar.CAMPANIA.mockResolvedValue(campaniaFila({ refugioId: 4 }));
    await expect(
      crearReporte(5, { tipo: 'CAMPANIA', objetoId: 3, motivo: MOTIVO }),
    ).resolves.toBeDefined();
  });

  it('rechaza un segundo reporte pendiente del mismo objeto', async () => {
    buscar.PUBLICACION.mockResolvedValue(publicacionAjena());
    mockedRepo.buscarPendienteDuplicado.mockResolvedValue({ id: 1 } as never);

    expect(
      await codigoDeError(crearReporte(5, { tipo: 'PUBLICACION', objetoId: 12, motivo: MOTIVO })),
    ).toBe('REPORTE_DUPLICADO');
  });

  it('traduce la violación del índice único (carrera) a REPORTE_DUPLICADO', async () => {
    buscar.PUBLICACION.mockResolvedValue(publicacionAjena());
    mockedRepo.crear.mockRejectedValue(new Error('P2002'));
    mockedRepo.esViolacionDeUnicidad.mockReturnValue(true);

    expect(
      await codigoDeError(crearReporte(5, { tipo: 'PUBLICACION', objetoId: 12, motivo: MOTIVO })),
    ).toBe('REPORTE_DUPLICADO');
  });

  it('corta en 5 reportes pendientes', async () => {
    buscar.PUBLICACION.mockResolvedValue(publicacionAjena());
    mockedRepo.contarPendientesDelUsuario.mockResolvedValue(5);

    expect(
      await codigoDeError(crearReporte(5, { tipo: 'PUBLICACION', objetoId: 12, motivo: MOTIVO })),
    ).toBe('LIMITE_REPORTES');
    expect(mockedRepo.crear).not.toHaveBeenCalled();
  });

  describe('MENSAJE', () => {
    const mensaje = { id: 8, contenido: 'hola', tipo: 'TEXTO', usuarioId: 2, chatId: 30 } as never;

    it('lo reporta un participante del chat', async () => {
      buscar.MENSAJE.mockResolvedValue(mensaje);
      mockedRepo.esParticipanteDelChat.mockResolvedValue(true);

      await expect(
        crearReporte(5, { tipo: 'MENSAJE', objetoId: 8, motivo: MOTIVO }),
      ).resolves.toBeDefined();
    });

    it('si no es del chat responde NO_ENCONTRADO, para no confirmar que existe', async () => {
      buscar.MENSAJE.mockResolvedValue(mensaje);
      mockedRepo.esParticipanteDelChat.mockResolvedValue(false);

      expect(
        await codigoDeError(crearReporte(5, { tipo: 'MENSAJE', objetoId: 8, motivo: MOTIVO })),
      ).toBe('NO_ENCONTRADO');
    });

    it('no se reporta un mensaje del sistema (SOLICITUD)', async () => {
      buscar.MENSAJE.mockResolvedValue({ ...(mensaje as object), tipo: 'SOLICITUD' } as never);

      expect(
        await codigoDeError(crearReporte(5, { tipo: 'MENSAJE', objetoId: 8, motivo: MOTIVO })),
      ).toBe('NO_ENCONTRADO');
    });

    it('no se reporta un mensaje propio', async () => {
      buscar.MENSAJE.mockResolvedValue({ ...(mensaje as object), usuarioId: 5 } as never);
      mockedRepo.esParticipanteDelChat.mockResolvedValue(true);

      expect(
        await codigoDeError(crearReporte(5, { tipo: 'MENSAJE', objetoId: 8, motivo: MOTIVO })),
      ).toBe('REPORTE_PROPIO');
    });
  });
});

describe('resolver', () => {
  const pendiente = { id: 70, tipo: 'PUBLICACION', objetoId: 12, usuarioAlta: 5, resuelto: false };

  it('marca el reporte y avisa al reportante con la respuesta', async () => {
    mockedRepo.buscarReporte
      .mockResolvedValueOnce(pendiente as never)
      .mockResolvedValueOnce({ ...pendiente, resuelto: true, respuesta: 'Listo' } as never);
    buscar.PUBLICACION.mockResolvedValue(publicacionAjena());
    mockedRepo.listarPersonas.mockResolvedValue([]);

    await resolver(99, 70, { respuesta: 'Listo' });

    expect(mockedRepo.resolver).toHaveBeenCalledWith({
      id: 70,
      adminId: 99,
      respuesta: 'Listo',
      reportanteId: 5,
      mensajeAviso: 'Un administrador resolvió tu reporte. Respuesta: Listo',
    });
  });

  it('no resuelve dos veces', async () => {
    mockedRepo.buscarReporte.mockResolvedValue({ ...pendiente, resuelto: true } as never);

    expect(await codigoDeError(resolver(99, 70, { respuesta: 'x' }))).toBe('REPORTE_YA_RESUELTO');
    expect(mockedRepo.resolver).not.toHaveBeenCalled();
  });

  it('responde NO_ENCONTRADO si el reporte no existe', async () => {
    mockedRepo.buscarReporte.mockResolvedValue(null);

    expect(await codigoDeError(resolver(99, 70, { respuesta: 'x' }))).toBe('NO_ENCONTRADO');
  });
});

describe('obtener', () => {
  it('de un mensaje trae la ventana de contexto y no la conversación entera', async () => {
    mockedRepo.buscarReporte.mockResolvedValue({
      id: 70,
      tipo: 'MENSAJE',
      objetoId: 8,
      motivo: MOTIVO,
      resuelto: false,
      respuesta: null,
      usuarioAlta: 5,
      usuarioModificacion: null,
      fechaModificacion: null,
      fechaAlta: new Date(),
    } as never);
    buscar.MENSAJE.mockResolvedValue({
      id: 8,
      contenido: 'hola',
      tipo: 'TEXTO',
      usuarioId: 2,
      chatId: 30,
    } as never);
    mockedRepo.listarPersonas.mockResolvedValue([]);
    mockedRepo.ventanaDeMensajes.mockResolvedValue([{ id: 8, imagenes: [] }] as never);

    const detalle = await obtener(70);

    expect(mockedRepo.ventanaDeMensajes).toHaveBeenCalledWith(30, 8, VENTANA_CONTEXTO_MENSAJES);
    expect(detalle.objeto).toMatchObject({ estado: 'ACTIVO', contexto: [{ id: 8, imagenes: [] }] });
  });

  it('marca como DE_BAJA un objeto que se dio de baja después del reporte', async () => {
    mockedRepo.buscarReporte.mockResolvedValue({
      id: 71,
      tipo: 'PUBLICACION',
      objetoId: 12,
      motivo: MOTIVO,
      resuelto: false,
      respuesta: null,
      usuarioAlta: 5,
      usuarioModificacion: null,
      fechaModificacion: null,
      fechaAlta: new Date(),
    } as never);
    buscar.PUBLICACION.mockResolvedValue({
      ...(publicacionAjena() as object),
      fechaBaja: new Date(),
    } as never);
    mockedRepo.listarPersonas.mockResolvedValue([]);

    const detalle = await obtener(71);

    expect(detalle.objeto.estado).toBe('DE_BAJA');
    expect(buscar.PUBLICACION).toHaveBeenCalledWith(12, true);
  });
});

describe('obtener: vista del objeto según el tipo', () => {
  function reporteDe(tipo: string, objetoId = 4) {
    mockedRepo.buscarReporte.mockResolvedValue({
      id: 80,
      tipo,
      objetoId,
      motivo: MOTIVO,
      resuelto: false,
      respuesta: null,
      usuarioAlta: 5,
      usuarioModificacion: null,
      fechaModificacion: null,
      fechaAlta: new Date(),
    } as never);
    mockedRepo.listarPersonas.mockResolvedValue([]);
  }

  it('USUARIO: datos de contacto para el admin y su refugio como lista', async () => {
    reporteDe('USUARIO');
    buscar.USUARIO.mockResolvedValue({
      id: 4,
      nombre: 'Ana',
      apellido: 'Pérez',
      email: 'ana@x.com',
      telefono: '2615550000',
      imagenUrl: 'a.jpg',
      verificado: true,
      provincia: 'Mendoza',
      localidad: 'Godoy Cruz',
      fechaAlta: new Date('2026-03-02T00:00:00Z'),
      fechaBaja: null,
      estado: { nombre: 'Suspendido' },
      refugio: { id: 9, nombre: 'Patitas' },
    } as never);

    const { objeto } = await obtener(80);

    expect(objeto.estado).toBe('SUSPENDIDO');
    expect(objeto.vista).toMatchObject({
      tipo: 'USUARIO',
      email: 'ana@x.com',
      estado: 'Suspendido',
      refugios: [{ id: 9, nombre: 'Patitas' }],
    });
  });

  it('RESENA: el receptor es el refugio o la persona, según corresponda', async () => {
    reporteDe('RESENA');
    const base = {
      puntuacion: 1,
      comentario: 'Mentira',
      usuarioAutorId: 2,
      fechaAlta: new Date('2026-09-01T00:00:00Z'),
      fechaBaja: null,
      autor: { id: 2, nombre: 'Bruno', apellido: 'G' },
    };
    buscar.RESENA.mockResolvedValue({
      ...base,
      usuarioReportado: null,
      refugioReportado: { id: 9, nombre: 'Patitas' },
    } as never);

    expect((await obtener(80)).objeto.vista).toMatchObject({
      tipo: 'RESENA',
      receptor: { tipo: 'REFUGIO', id: 9, nombre: 'Patitas' },
      autor: { id: 2 },
    });

    buscar.RESENA.mockResolvedValue({
      ...base,
      usuarioReportado: { id: 3, nombre: 'Ana', apellido: 'P' },
      refugioReportado: null,
    } as never);

    expect((await obtener(80)).objeto.vista).toMatchObject({
      receptor: { tipo: 'PERSONA', id: 3, nombre: 'Ana P' },
    });
  });

  it('ANIMAL_PERDIDO: galería, ubicación y fecha del suceso con respaldo en el alta', async () => {
    reporteDe('ANIMAL_PERDIDO');
    buscar.ANIMAL_PERDIDO.mockResolvedValue({
      nombre: null,
      descripcion: 'Perro marrón',
      imagenUrl: 'portada.jpg',
      imagenes: [],
      provincia: 'Mendoza',
      localidad: 'Luján',
      referencia: 'Plaza',
      fechaSuceso: null,
      fechaAlta: new Date('2026-09-05T00:00:00Z'),
      usuarioReportanteId: 3,
      fechaBaja: null,
      estadoAnimalPerdido: { nombre: 'Encontrado' },
      usuarioReportante: { id: 3, nombre: 'Ana', apellido: 'P' },
    } as never);

    const { objeto } = await obtener(80);

    expect(objeto.vista).toMatchObject({
      tipo: 'ANIMAL_PERDIDO',
      estado: 'Encontrado',
      imagenes: ['portada.jpg'],
      ubicacion: 'Plaza, Luján - Mendoza',
      fechaSuceso: '2026-09-05T00:00:00.000Z',
    });
    expect(objeto.imagenUrl).toBe('portada.jpg');
  });

  it('CAMPANIA: monto actual como suma de las donaciones', async () => {
    reporteDe('CAMPANIA');
    buscar.CAMPANIA.mockResolvedValue({
      titulo: 'Techo',
      descripcion: 'Para los caniles',
      objetivo: '10000',
      fechaInicio: new Date('2026-09-01T00:00:00Z'),
      fechaFin: new Date('2026-12-01T00:00:00Z'),
      imagenUrl: 'c.jpg',
      refugioId: 9,
      fechaBaja: null,
      estadoCampania: { nombre: 'Activa' },
      refugio: { id: 9, nombre: 'Patitas' },
      donaciones: [{ monto: '1500.50' }, { monto: '500' }],
    } as never);

    expect((await obtener(80)).objeto.vista).toMatchObject({
      tipo: 'CAMPANIA',
      montoObjetivo: 10000,
      montoActual: 2000.5,
      estado: 'Activa',
      imagenes: ['c.jpg'],
    });
  });

  it('PUBLICACION no lleva vista: web-admin usa su endpoint', async () => {
    reporteDe('PUBLICACION', 12);
    buscar.PUBLICACION.mockResolvedValue(publicacionAjena());

    expect((await obtener(80)).objeto).not.toHaveProperty('vista');
  });

  it('trae los contadores de reincidencia del objeto', async () => {
    reporteDe('PUBLICACION', 12);
    buscar.PUBLICACION.mockResolvedValue(publicacionAjena());
    mockedRepo.contarPorObjeto.mockResolvedValue(
      new Map([['PUBLICACION:12', { pendientes: 2, totales: 5 }]]),
    );

    expect((await obtener(80)).objeto).toMatchObject({ reportesPendientes: 2, reportesTotales: 5 });
  });

  it('las fotos de la ventana de chat salen firmadas', async () => {
    reporteDe('MENSAJE', 8);
    buscar.MENSAJE.mockResolvedValue({
      id: 8,
      contenido: 'hola',
      tipo: 'TEXTO',
      usuarioId: 2,
      chatId: 30,
    } as never);
    mockedRepo.ventanaDeMensajes.mockResolvedValue([
      { id: 8, imagenes: ['/api/v1/archivos/chats/a.jpg'] },
    ] as never);

    const contexto = (await obtener(80)).objeto.contexto!;

    expect(contexto[0]!.imagenes[0]).toMatch(/^\/api\/v1\/archivos\/chats\/a\.jpg\?.*sig=/);
  });
});
