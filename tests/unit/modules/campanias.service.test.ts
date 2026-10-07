import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import type { CrearCampaniaDto } from '../../../src/modules/campanias/campanias.dto';
import * as repo from '../../../src/modules/campanias/campanias.repository';
import * as service from '../../../src/modules/campanias/campanias.service';
import { USUARIO_SISTEMA_ID } from '../../../src/shared/auditoria';
import { registrarAuditoria } from '../../../src/shared/logAuditoria';
import { borrarImagen, guardarImagen } from '../../../src/shared/storage';
import * as mpCliente from '../../../src/modules/mercadopago/mercadopago.cliente';
import * as mpService from '../../../src/modules/mercadopago/mercadopago.service';
import { programarReintentos } from '../../../src/modules/campanias/campanias.reintentos';

vi.mock('../../../src/modules/campanias/campanias.repository');
vi.mock('../../../src/shared/storage');
vi.mock('../../../src/shared/logAuditoria');
vi.mock('../../../src/modules/mercadopago/mercadopago.service');
vi.mock('../../../src/modules/campanias/campanias.reintentos');
vi.mock('../../../src/modules/mercadopago/mercadopago.cliente', async (importOriginal) => {
  const real = await importOriginal<typeof mpCliente>();
  return { ...real, buscarPagos: vi.fn() };
});

const USUARIO = 7;
const REFUGIO = 3;
const OTRO_REFUGIO = 4;
const URL_IMAGEN = '/api/v1/archivos/campanias/x.webp';
const ARCHIVO = { buffer: Buffer.from('img'), mimetype: 'image/webp' } as never;

const ESTADOS_CAMPANIA = [
  { id: 1, nombre: 'Inactiva' },
  { id: 2, nombre: 'Activa' },
  { id: 3, nombre: 'Finalizada' },
  { id: 4, nombre: 'Cancelada' },
];
const ESTADOS_DONACION = [
  { id: 11, nombre: 'Pendiente' },
  { id: 12, nombre: 'Realizada' },
  { id: 13, nombre: 'Cancelada' },
];

function enDias(n: number): Date {
  const fecha = new Date();
  fecha.setHours(0, 0, 0, 0);
  fecha.setDate(fecha.getDate() + n);
  return fecha;
}

function campania(
  id: number,
  opciones: {
    estado?: string;
    refugioId?: number;
    objetivo?: number;
    fechaInicio?: Date;
    fechaFin?: Date;
    vinculado?: boolean;
  } = {},
): repo.CampaniaConRelaciones {
  const refugioId = opciones.refugioId ?? REFUGIO;
  return {
    id,
    titulo: 'Castraciones de primavera',
    descripcion: 'Queremos castrar 80 animales.',
    imagenUrl: URL_IMAGEN,
    objetivo: new Prisma.Decimal(opciones.objetivo ?? 100000),
    fechaInicio: opciones.fechaInicio ?? enDias(-10),
    fechaFin: opciones.fechaFin ?? enDias(30),
    alias: 'patitas.castra.mp',
    cbu: null,
    refugioId,
    fechaAlta: new Date('2026-09-01T12:00:00.000Z'),
    estadoCampania: ESTADOS_CAMPANIA.find((e) => e.nombre === (opciones.estado ?? 'Activa'))!,
    refugio: {
      id: refugioId,
      nombre: 'Patitas',
      imagenUrl: null,
      conexionMercadoPago: opciones.vinculado ? { estado: 'VINCULADA', fechaBaja: null } : null,
    },
  };
}

function donacion(
  id: number,
  estado = 'Pendiente',
  mpPagoId: string | null = null,
): repo.DonacionConRelaciones {
  return {
    id,
    monto: new Prisma.Decimal(5000),
    motivoRechazo: null,
    mpPagoId,
    origen: 'MERCADO_PAGO',
    fechaAlta: new Date('2026-09-20T15:00:00.000Z'),
    estadoDonacion: ESTADOS_DONACION.find((e) => e.nombre === estado)!,
    usuario: { id: 20, nombre: 'Ana', apellido: 'Gómez', imagenUrl: null },
  };
}

function resumen(entradas: [number, Partial<repo.ResumenDonaciones>][]) {
  return new Map(
    entradas.map(([id, r]) => [id, { recaudado: 0, donantes: 0, pendientes: 0, ...r }]),
  );
}

function usuarioDeRefugio(
  opciones: {
    refugioId?: number | null;
    verificado?: boolean;
    estado?: string;
    dni?: string | null;
  } = {},
) {
  const refugioId = opciones.refugioId === undefined ? REFUGIO : opciones.refugioId;
  return {
    id: USUARIO,
    dni: opciones.dni === undefined ? '30123456' : opciones.dni,
    refugioId,
    refugio:
      refugioId === null
        ? null
        : {
            id: refugioId,
            verificado: opciones.verificado ?? true,
            fechaBaja: null,
            estado: { nombre: opciones.estado ?? 'Activo' },
          },
  };
}

const DATOS: CrearCampaniaDto = {
  titulo: 'Castraciones de primavera',
  descripcion: 'Queremos castrar 80 animales.',
  objetivo: 100000,
  fechaInicio: enDias(1),
  fechaFin: enDias(60),
  alias: 'patitas.castra.mp',
  cbu: null,
};

async function codigoDeError(promesa: Promise<unknown>): Promise<string | undefined> {
  try {
    await promesa;
    return undefined;
  } catch (err) {
    return err instanceof AppError ? err.codigo : 'NO_ES_APP_ERROR';
  }
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuarioDeRefugio() as never);
  vi.mocked(repo.buscarEstadosCampania).mockResolvedValue(ESTADOS_CAMPANIA);
  vi.mocked(repo.buscarEstadosDonacion).mockResolvedValue(ESTADOS_DONACION);
  vi.mocked(repo.contarVigentes).mockResolvedValue(0);
  vi.mocked(repo.crear).mockResolvedValue(
    campania(50, { estado: 'Inactiva', fechaInicio: enDias(1) }),
  );
  vi.mocked(repo.cambiarEstadoSi).mockResolvedValue(true);
  vi.mocked(repo.resolverDonacionSi).mockResolvedValue(true);
  vi.mocked(repo.resumirDonaciones).mockImplementation(async (ids) =>
    resumen(ids.map((id) => [id, {}])),
  );
  vi.mocked(mpService.tokenDeRefugio).mockResolvedValue(null);
  vi.mocked(mpService.disponible).mockReturnValue(false);
  vi.mocked(repo.pagosYaUsados).mockResolvedValue(new Set());
  vi.mocked(guardarImagen).mockResolvedValue(URL_IMAGEN);
});

describe('crearCampania', () => {
  it('la crea Inactiva con la imagen guardada y audita', async () => {
    const creada = await service.crearCampania(DATOS, { usuarioId: USUARIO, archivo: ARCHIVO });

    expect(guardarImagen).toHaveBeenCalledWith(ARCHIVO, 'campanias');
    expect(repo.crear).toHaveBeenCalledWith(
      expect.objectContaining({ refugioId: REFUGIO, estadoCampaniaId: 1, imagenUrl: URL_IMAGEN }),
      USUARIO,
    );
    expect(repo.cambiarEstadoSi).not.toHaveBeenCalled();
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'CREAR', entidad: 'Campania', entidadId: 50 }),
    );
    expect(creada).toMatchObject({
      id: 50,
      estado: { nombre: 'Inactiva' },
      recaudado: 0,
      pendientes: 0,
    });
  });

  it('si empieza hoy la activa en el momento, como SISTEMA', async () => {
    vi.mocked(repo.crear).mockResolvedValue(
      campania(50, { estado: 'Inactiva', fechaInicio: enDias(0) }),
    );
    vi.mocked(repo.buscarPorId).mockResolvedValue(
      campania(50, { estado: 'Activa', fechaInicio: enDias(0) }),
    );

    const creada = await service.crearCampania(
      { ...DATOS, fechaInicio: enDias(0) },
      { usuarioId: USUARIO, archivo: ARCHIVO },
    );

    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(50, 1, 2, USUARIO_SISTEMA_ID);
    expect(creada.estado.nombre).toBe('Activa');
  });

  it('sin imagen no crea nada', async () => {
    expect(await codigoDeError(service.crearCampania(DATOS, { usuarioId: USUARIO }))).toBe(
      'IMAGEN_REQUERIDA',
    );
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('exige refugio verificado y activo', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuarioDeRefugio({ verificado: false }) as never,
    );
    expect(
      await codigoDeError(service.crearCampania(DATOS, { usuarioId: USUARIO, archivo: ARCHIVO })),
    ).toBe('REFUGIO_NO_HABILITADO');

    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuarioDeRefugio({ estado: 'Suspendido' }) as never,
    );
    expect(
      await codigoDeError(service.crearCampania(DATOS, { usuarioId: USUARIO, archivo: ARCHIVO })),
    ).toBe('REFUGIO_NO_HABILITADO');
  });

  it('con 5 vigentes corta antes de subir la imagen', async () => {
    vi.mocked(repo.contarVigentes).mockResolvedValue(5);

    expect(
      await codigoDeError(service.crearCampania(DATOS, { usuarioId: USUARIO, archivo: ARCHIVO })),
    ).toBe('LIMITE_CAMPANIAS');
    expect(guardarImagen).not.toHaveBeenCalled();
  });

  it('si falla la base, borra la imagen subida', async () => {
    vi.mocked(repo.crear).mockRejectedValue(new Error('db caída'));

    await expect(
      service.crearCampania(DATOS, { usuarioId: USUARIO, archivo: ARCHIVO }),
    ).rejects.toThrow('db caída');
    expect(borrarImagen).toHaveBeenCalledWith(URL_IMAGEN);
  });
});

describe('cambiarEstadoCampania', () => {
  it('finaliza una Activa', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8));

    await service.cambiarEstadoCampania(8, 'Finalizada', USUARIO);

    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(8, 2, 3, USUARIO);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'CAMBIAR_ESTADO',
        entidadId: 8,
        detalle: 'Activa -> Finalizada',
      }),
    );
  });

  it('cancela una Inactiva', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { estado: 'Inactiva' }));

    await service.cambiarEstadoCampania(8, 'Cancelada', USUARIO);

    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(8, 1, 4, USUARIO);
  });

  it('no finaliza una Inactiva', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { estado: 'Inactiva' }));

    expect(await codigoDeError(service.cambiarEstadoCampania(8, 'Finalizada', USUARIO))).toBe(
      'TRANSICION_INVALIDA',
    );
  });

  it('una campaña de otro refugio es 404', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { refugioId: OTRO_REFUGIO }));

    expect(await codigoDeError(service.cambiarEstadoCampania(8, 'Cancelada', USUARIO))).toBe(
      'CAMPANIA_NO_ENCONTRADA',
    );
  });

  it('carrera: si otro la cambió recién, 409', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8));
    vi.mocked(repo.cambiarEstadoSi).mockResolvedValue(false);

    expect(await codigoDeError(service.cambiarEstadoCampania(8, 'Finalizada', USUARIO))).toBe(
      'TRANSICION_INVALIDA',
    );
  });
});

describe('listarCampaniasDelRefugio', () => {
  it('pagina y suma el progreso de cada campaña', async () => {
    vi.mocked(repo.listarDelRefugio).mockResolvedValue([campania(9), campania(8), campania(7)]);
    vi.mocked(repo.resumirDonaciones).mockResolvedValue(
      resumen([
        [9, { recaudado: 57000, donantes: 3, pendientes: 2 }],
        [8, {}],
      ]),
    );

    const lista = await service.listarCampaniasDelRefugio({ limite: 2, estados: [] }, USUARIO);

    expect(repo.listarDelRefugio).toHaveBeenCalledWith(REFUGIO, { estados: [] }, 2, undefined);
    expect(lista.hayMas).toBe(true);
    expect(lista.proximoCursor).toBe(8);
    expect(lista.campanias[0]).toMatchObject({
      id: 9,
      recaudado: 57000,
      porcentaje: 57,
      donantes: 3,
      pendientes: 2,
    });
  });

  it('un cursor inexistente corta con 400', async () => {
    vi.mocked(repo.existeCampania).mockResolvedValue(null);

    expect(
      await codigoDeError(
        service.listarCampaniasDelRefugio({ cursor: 999, limite: 20, estados: [] }, USUARIO),
      ),
    ).toBe('CURSOR_INVALIDO');
  });
});

describe('donar', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuarioDeRefugio({ refugioId: null }) as never,
    );
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8));
    vi.mocked(repo.crearDonacion).mockResolvedValue(donacion(30));
  });

  it('registra la donación Pendiente sin tocar el estado de la campaña', async () => {
    const creada = await service.donar(8, { monto: 5000, origen: 'MERCADO_PAGO' }, USUARIO);

    expect(repo.crearDonacion).toHaveBeenCalledWith(
      { campaniaId: 8, monto: 5000, estadoDonacionId: 11, origen: 'MERCADO_PAGO' },
      USUARIO,
    );
    expect(repo.cambiarEstadoSi).not.toHaveBeenCalled();
    expect(creada).toMatchObject({ id: 30, monto: 5000, estado: { nombre: 'Pendiente' } });
  });

  it('no se dona a una campaña que no está Activa', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { estado: 'Inactiva' }));

    expect(
      await codigoDeError(service.donar(8, { monto: 5000, origen: 'MERCADO_PAGO' }, USUARIO)),
    ).toBe('CAMPANIA_NO_ACTIVA');
  });

  it('una Activa con la fecha de fin vencida (el cron no corrió) no recibe y se cierra en el acto', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { fechaFin: enDias(-1) }));

    expect(
      await codigoDeError(service.donar(8, { monto: 5000, origen: 'MERCADO_PAGO' }, USUARIO)),
    ).toBe('CAMPANIA_NO_ACTIVA');
    expect(repo.crearDonacion).not.toHaveBeenCalled();
    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(8, 2, 3, USUARIO_SISTEMA_ID);
  });

  it('un miembro no dona a su propio refugio', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuarioDeRefugio() as never);

    expect(
      await codigoDeError(service.donar(8, { monto: 5000, origen: 'MERCADO_PAGO' }, USUARIO)),
    ).toBe('DONACION_PROPIA');
  });

  it('una campaña inexistente es 404', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(null);

    expect(
      await codigoDeError(service.donar(8, { monto: 5000, origen: 'MERCADO_PAGO' }, USUARIO)),
    ).toBe('CAMPANIA_NO_ENCONTRADA');
  });
});

describe('resolverDonacion', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarDonacion).mockResolvedValue({
      id: 30,
      campaniaId: 8,
      estadoDonacion: { nombre: 'Pendiente' },
      campania: { refugioId: REFUGIO },
    });
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { objetivo: 100000 }));
    vi.mocked(repo.buscarDonacionCompleta).mockResolvedValue(donacion(30, 'Realizada'));
  });

  it('aplicar la pasa a Realizada', async () => {
    const resultado = await service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO);

    expect(repo.resolverDonacionSi).toHaveBeenCalledWith(30, 11, 12, null, USUARIO);
    expect(resultado.estado.nombre).toBe('Realizada');
    expect(repo.cambiarEstadoSi).not.toHaveBeenCalled();
  });

  it('rechazar guarda el motivo', async () => {
    await service.resolverDonacion(30, { estado: 'Cancelada', motivo: 'NO_RECIBIDA' }, USUARIO);

    expect(repo.resolverDonacionSi).toHaveBeenCalledWith(30, 11, 13, 'NO_RECIBIDA', USUARIO);
  });

  it('aplicar la que completa el objetivo finaliza la campaña como SISTEMA', async () => {
    vi.mocked(repo.resumirDonaciones).mockResolvedValue(resumen([[8, { recaudado: 100000 }]]));

    await service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO);

    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(8, 2, 3, USUARIO_SISTEMA_ID);
  });

  it('aplicar sobre una campaña ya Finalizada no la vuelve a tocar', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { estado: 'Finalizada' }));
    vi.mocked(repo.resumirDonaciones).mockResolvedValue(resumen([[8, { recaudado: 999999 }]]));

    await service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO);

    expect(repo.resolverDonacionSi).toHaveBeenCalled();
    expect(repo.cambiarEstadoSi).not.toHaveBeenCalled();
  });

  it('una ya revisada es 409', async () => {
    vi.mocked(repo.buscarDonacion).mockResolvedValue({
      id: 30,
      campaniaId: 8,
      estadoDonacion: { nombre: 'Realizada' },
      campania: { refugioId: REFUGIO },
    });

    expect(
      await codigoDeError(service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO)),
    ).toBe('TRANSICION_INVALIDA');
  });

  it('carrera: si otro miembro la resolvió recién, 409', async () => {
    vi.mocked(repo.resolverDonacionSi).mockResolvedValue(false);

    expect(
      await codigoDeError(service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO)),
    ).toBe('TRANSICION_INVALIDA');
  });

  it('una donación de otro refugio es 404', async () => {
    vi.mocked(repo.buscarDonacion).mockResolvedValue({
      id: 30,
      campaniaId: 8,
      estadoDonacion: { nombre: 'Pendiente' },
      campania: { refugioId: OTRO_REFUGIO },
    });

    expect(
      await codigoDeError(service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO)),
    ).toBe('DONACION_NO_ENCONTRADA');
  });
});

describe('listarDonaciones', () => {
  it('las de una campaña de otro refugio son 404', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { refugioId: OTRO_REFUGIO }));

    expect(await codigoDeError(service.listarDonaciones(8, { limite: 30 }, USUARIO))).toBe(
      'CAMPANIA_NO_ENCONTRADA',
    );
  });

  it('filtra por estado y pagina', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8));
    vi.mocked(repo.listarDonaciones).mockResolvedValue([donacion(31), donacion(30)]);

    const lista = await service.listarDonaciones(8, { limite: 1, estado: 'Pendiente' }, USUARIO);

    expect(repo.listarDonaciones).toHaveBeenCalledWith(8, 'Pendiente', 1, undefined);
    expect(lista).toMatchObject({ hayMas: true, proximoCursor: 31 });
    expect(lista.donaciones).toHaveLength(1);
  });
});

describe('confirmación con Mercado Pago (spec 027)', () => {
  const PAGO = {
    id: 'p1',
    monto: 5000,
    fecha: new Date(),
    estado: 'approved',
    tipoDoc: 'CUIL',
    numeroDoc: '20301234569',
  };

  function pendiente(id = 30) {
    return {
      id,
      monto: new Prisma.Decimal(5000),
      fechaAlta: new Date(),
      campaniaId: 8,
      usuario: { dni: '30123456' },
    };
  }

  beforeEach(() => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuarioDeRefugio({ refugioId: null }) as never,
    );
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { vinculado: true }));
    vi.mocked(repo.crearDonacion).mockResolvedValue(donacion(30));
    vi.mocked(mpService.tokenDeRefugio).mockResolvedValue('AT');
    vi.mocked(repo.pendientesDelGrupo).mockResolvedValue([pendiente()] as never);
    vi.mocked(mpCliente.buscarPagos).mockResolvedValue([PAGO]);
    vi.mocked(repo.confirmarConPagoMp).mockResolvedValue(true);
  });

  it('donar sin DNI: DNI_REQUERIDO y no crea nada', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(
      usuarioDeRefugio({ refugioId: null, dni: null }) as never,
    );

    expect(
      await codigoDeError(service.donar(8, { monto: 5000, origen: 'MERCADO_PAGO' }, USUARIO)),
    ).toBe('DNI_REQUERIDO');
    expect(repo.crearDonacion).not.toHaveBeenCalled();
  });

  it('donar con la transferencia ya acreditada: vuelve Realizada y confirmada por Mercado Pago', async () => {
    vi.mocked(repo.buscarDonacionCompleta).mockResolvedValue(donacion(30, 'Realizada', 'p1'));

    const creada = await service.donar(8, { monto: 5000, origen: 'MERCADO_PAGO' }, USUARIO);

    expect(mpCliente.buscarPagos).toHaveBeenCalledWith(
      'AT',
      expect.objectContaining({ monto: 5000 }),
      5000,
    );
    expect(repo.confirmarConPagoMp).toHaveBeenCalledWith(30, 11, 12, 'p1', USUARIO_SISTEMA_ID);
    expect(creada).toMatchObject({
      estado: { nombre: 'Realizada' },
      confirmadaPorMercadoPago: true,
    });
  });

  it('si la transferencia todavía no llegó, programa reintentos para esa donación (spec 027 §6.5)', async () => {
    vi.mocked(mpCliente.buscarPagos).mockResolvedValue([]);

    await service.donar(8, { monto: 5000, origen: 'MERCADO_PAGO' }, USUARIO);

    expect(programarReintentos).toHaveBeenCalledWith(
      `${REFUGIO}|${USUARIO}|5000`,
      expect.any(Function),
    );
  });

  it('si se confirmó en el acto no programa reintentos', async () => {
    vi.mocked(repo.buscarDonacionCompleta).mockResolvedValue(donacion(30, 'Realizada', 'p1'));

    await service.donar(8, { monto: 5000, origen: 'MERCADO_PAGO' }, USUARIO);

    expect(programarReintentos).not.toHaveBeenCalled();
  });

  it('con el refugio sin Mercado Pago vinculado no programa reintentos', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8));
    vi.mocked(mpService.tokenDeRefugio).mockResolvedValue(null);

    await service.donar(8, { monto: 5000, origen: 'MERCADO_PAGO' }, USUARIO);

    expect(programarReintentos).not.toHaveBeenCalled();
  });

  it('desde otro banco no se busca en Mercado Pago ni se programan reintentos (spec 027)', async () => {
    vi.mocked(repo.crearDonacion).mockResolvedValue({ ...donacion(30), origen: 'OTRO_BANCO' });

    const creada = await service.donar(8, { monto: 5000, origen: 'OTRO_BANCO' }, USUARIO);

    expect(repo.crearDonacion).toHaveBeenCalledWith(
      expect.objectContaining({ origen: 'OTRO_BANCO' }),
      USUARIO,
    );
    expect(mpCliente.buscarPagos).not.toHaveBeenCalled();
    expect(programarReintentos).not.toHaveBeenCalled();
    expect(creada).toMatchObject({ origen: 'OTRO_BANCO', estado: { nombre: 'Pendiente' } });
  });

  it('Mercado Pago caído: la donación se crea igual, Pendiente y sin error', async () => {
    vi.mocked(mpCliente.buscarPagos).mockRejectedValue(new Error('timeout'));

    const creada = await service.donar(8, { monto: 5000, origen: 'MERCADO_PAGO' }, USUARIO);

    expect(creada).toMatchObject({
      estado: { nombre: 'Pendiente' },
      confirmadaPorMercadoPago: false,
    });
    expect(repo.confirmarConPagoMp).not.toHaveBeenCalled();
  });

  it('token revocado: marca revincular y no confirma', async () => {
    vi.mocked(mpCliente.buscarPagos).mockRejectedValue(new mpCliente.TokenMercadoPagoInvalido());

    expect(
      await service.conciliarGrupo({ refugioId: REFUGIO, usuarioId: USUARIO, monto: 5000 }),
    ).toBe(0);
    expect(mpService.marcarTokenInvalido).toHaveBeenCalledWith(REFUGIO);
  });

  it('el mismo pago tomado por otra corrida en paralelo: se ignora sin error', async () => {
    vi.mocked(repo.confirmarConPagoMp).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
    );

    expect(
      await service.conciliarGrupo({ refugioId: REFUGIO, usuarioId: USUARIO, monto: 5000 }),
    ).toBe(0);
  });

  it('confirmar la que completa el objetivo finaliza la campaña', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { objetivo: 5000, vinculado: true }));
    vi.mocked(repo.resumirDonaciones).mockResolvedValue(resumen([[8, { recaudado: 5000 }]]));

    expect(
      await service.conciliarGrupo({ refugioId: REFUGIO, usuarioId: USUARIO, monto: 5000 }),
    ).toBe(1);
    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(8, 2, 3, USUARIO_SISTEMA_ID);
  });

  it('sin token del refugio no consulta nada', async () => {
    vi.mocked(mpService.tokenDeRefugio).mockResolvedValue(null);

    expect(
      await service.conciliarGrupo({ refugioId: REFUGIO, usuarioId: USUARIO, monto: 5000 }),
    ).toBe(0);
    expect(mpCliente.buscarPagos).not.toHaveBeenCalled();
  });

  it('confirmacionAutomatica sólo con Mercado Pago disponible y el refugio vinculado', async () => {
    vi.mocked(mpService.disponible).mockReturnValue(true);
    expect((await service.obtenerCampania(8)).confirmacionAutomatica).toBe(true);

    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8));
    expect((await service.obtenerCampania(8)).confirmacionAutomatica).toBe(false);
  });
});
