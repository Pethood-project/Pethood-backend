import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import type { CrearCampaniaDto } from '../../../src/modules/campanias/campanias.dto';
import * as repo from '../../../src/modules/campanias/campanias.repository';
import * as service from '../../../src/modules/campanias/campanias.service';
import { USUARIO_SISTEMA_ID } from '../../../src/shared/auditoria';
import { registrarAuditoria } from '../../../src/shared/logAuditoria';
import { borrarImagen, guardarImagen } from '../../../src/shared/storage';

vi.mock('../../../src/modules/campanias/campanias.repository');
vi.mock('../../../src/shared/storage');
vi.mock('../../../src/shared/logAuditoria');

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
  opciones: { estado?: string; refugioId?: number; objetivo?: number; fechaInicio?: Date } = {},
): repo.CampaniaConRelaciones {
  const refugioId = opciones.refugioId ?? REFUGIO;
  return {
    id,
    titulo: 'Castraciones de primavera',
    descripcion: 'Queremos castrar 80 animales.',
    imagenUrl: URL_IMAGEN,
    objetivo: new Prisma.Decimal(opciones.objetivo ?? 100000),
    fechaInicio: opciones.fechaInicio ?? enDias(-10),
    fechaFin: enDias(30),
    alias: 'patitas.castra.mp',
    cbu: null,
    refugioId,
    fechaAlta: new Date('2026-09-01T12:00:00.000Z'),
    estadoCampania: ESTADOS_CAMPANIA.find((e) => e.nombre === (opciones.estado ?? 'Activa'))!,
    refugio: { id: refugioId, nombre: 'Patitas', imagenUrl: null },
  };
}

function donacion(id: number, estado = 'Pendiente'): repo.DonacionConRelaciones {
  return {
    id,
    monto: new Prisma.Decimal(5000),
    motivoRechazo: null,
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
  opciones: { refugioId?: number | null; verificado?: boolean; estado?: string } = {},
) {
  const refugioId = opciones.refugioId === undefined ? REFUGIO : opciones.refugioId;
  return {
    id: USUARIO,
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
    const creada = await service.donar(8, { monto: 5000 }, USUARIO);

    expect(repo.crearDonacion).toHaveBeenCalledWith(
      { campaniaId: 8, monto: 5000, estadoDonacionId: 11 },
      USUARIO,
    );
    expect(repo.cambiarEstadoSi).not.toHaveBeenCalled();
    expect(creada).toMatchObject({ id: 30, monto: 5000, estado: { nombre: 'Pendiente' } });
  });

  it('no se dona a una campaña que no está Activa', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { estado: 'Inactiva' }));

    expect(await codigoDeError(service.donar(8, { monto: 5000 }, USUARIO))).toBe(
      'CAMPANIA_NO_ACTIVA',
    );
  });

  it('un miembro no dona a su propio refugio', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuarioDeRefugio() as never);

    expect(await codigoDeError(service.donar(8, { monto: 5000 }, USUARIO))).toBe('DONACION_PROPIA');
  });

  it('una campaña inexistente es 404', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(null);

    expect(await codigoDeError(service.donar(8, { monto: 5000 }, USUARIO))).toBe(
      'CAMPANIA_NO_ENCONTRADA',
    );
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
