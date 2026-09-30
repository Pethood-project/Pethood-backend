import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import type {
  CrearAvisoDto,
  FiltrosAvisosDto,
} from '../../../src/modules/animales-perdidos/animales-perdidos.dto';
import * as repo from '../../../src/modules/animales-perdidos/animales-perdidos.repository';
import * as service from '../../../src/modules/animales-perdidos/animales-perdidos.service';
import { resolverCoordenadasDeMapsUrl } from '../../../src/shared/geo';
import { geocodificarLugar } from '../../../src/shared/geocoding';
import { registrarAuditoria } from '../../../src/shared/logAuditoria';
import { borrarImagenes, guardarImagenes } from '../../../src/shared/storage';

vi.mock('../../../src/modules/animales-perdidos/animales-perdidos.repository');
vi.mock('../../../src/shared/storage');
vi.mock('../../../src/shared/logAuditoria');
// Sólo el geocoder (red): los armadores de links de Maps son puros y se prueban de verdad.
vi.mock('../../../src/shared/geocoding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/shared/geocoding')>()),
  geocodificarLugar: vi.fn(),
}));
// Ídem con los links cortos de Maps, que se resuelven por red. La distancia sigue siendo real.
vi.mock('../../../src/shared/geo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/shared/geo')>()),
  resolverCoordenadasDeMapsUrl: vi.fn(),
}));

const USUARIO = 7;
const OTRO = 99;

const ESTADOS = {
  Perdido: { id: 1, nombre: 'Perdido' },
  Encontrado: { id: 2, nombre: 'Encontrado' },
  Resuelto: { id: 3, nombre: 'Resuelto' },
} as const;

const ARCHIVO = { buffer: Buffer.from('foto'), mimetype: 'image/jpeg' };
const URL_FOTO = '/api/v1/archivos/perdidos/x.jpg';

const FECHA_SUCESO = new Date(2026, 8, 18);

/** El lugar geocodificado: la plaza de Godoy Cruz. */
const LUGAR = { latitud: -32.9264, longitud: -68.8447 };
/** El teléfono de quien reportó, en otro lado: nunca tiene que aparecer en la respuesta. */
const DISPOSITIVO = { latitud: -32.8, longitud: -68.7 };

const DATOS: CrearAvisoDto = {
  nombre: 'Thor',
  descripcion: 'Labrador dorado con collar azul.',
  provincia: 'Mendoza',
  localidad: 'Godoy Cruz',
  referencia: 'Barrio Bombal',
  fechaSuceso: FECHA_SUCESO,
  estadoId: ESTADOS.Perdido.id,
  especieId: 1,
  ...DISPOSITIVO,
};

const FILTROS: FiltrosAvisosDto = {
  limite: 2,
  estados: [],
  especies: [],
  provincias: [],
  localidades: [],
};

/** Fila tal como la devuelve el repository, con sus relaciones ya resueltas. */
function aviso(
  id: number,
  opciones: {
    reportanteId?: number;
    estado?: { id: number; nombre: string };
    nombre?: string | null;
    especie?: { id: number; nombre: string } | null;
    imagenes?: string[];
    /** `null` = el geocoder no encontró el lugar. */
    lugar?: { latitud: number; longitud: number } | null;
  } = {},
): repo.AvisoConRelaciones {
  const reportanteId = opciones.reportanteId ?? OTRO;
  const lugar = opciones.lugar === undefined ? LUGAR : opciones.lugar;

  return {
    id,
    nombre: opciones.nombre === undefined ? 'Thor' : opciones.nombre,
    descripcion: 'Labrador dorado con collar azul.',
    imagenUrl: URL_FOTO,
    imagenes: opciones.imagenes ?? [URL_FOTO],
    provincia: 'Mendoza',
    localidad: 'Godoy Cruz',
    referencia: 'Barrio Bombal',
    lugarLatitud: lugar?.latitud ?? null,
    lugarLongitud: lugar?.longitud ?? null,
    fechaSuceso: FECHA_SUCESO,
    fechaAlta: new Date('2026-09-20T15:00:00.000Z'),
    fechaResuelto: null,
    usuarioReportanteId: reportanteId,
    estadoAnimalPerdido: opciones.estado ?? ESTADOS.Perdido,
    especie: opciones.especie === undefined ? { id: 1, nombre: 'Perro' } : opciones.especie,
    usuarioReportante: { id: reportanteId, nombre: 'Ana', apellido: 'Gómez', imagenUrl: null },
  };
}

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

  vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: USUARIO });
  vi.mocked(repo.buscarEstado).mockImplementation(
    async (id) => Object.values(ESTADOS).find((estado) => estado.id === id) ?? null,
  );
  vi.mocked(repo.buscarEspecie).mockResolvedValue({ id: 1 });
  vi.mocked(repo.crear).mockResolvedValue(aviso(10, { reportanteId: USUARIO }));
  vi.mocked(guardarImagenes).mockResolvedValue([URL_FOTO]);
  vi.mocked(geocodificarLugar).mockResolvedValue(LUGAR);
});

describe('crearAviso', () => {
  it('publica el aviso con el usuario autenticado como reportante', async () => {
    const creado = await service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    expect(guardarImagenes).toHaveBeenCalledWith([ARCHIVO], 'perdidos');
    expect(repo.crear).toHaveBeenCalledWith(
      {
        nombre: 'Thor',
        descripcion: DATOS.descripcion,
        imagenes: [URL_FOTO],
        provincia: 'Mendoza',
        localidad: 'Godoy Cruz',
        referencia: 'Barrio Bombal',
        lugarLatitud: LUGAR.latitud,
        lugarLongitud: LUGAR.longitud,
        fechaSuceso: FECHA_SUCESO,
        ...DISPOSITIVO,
        especieId: 1,
        estadoAnimalPerdidoId: ESTADOS.Perdido.id,
      },
      USUARIO,
    );
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'CREAR', entidad: 'AnimalPerdido', entidadId: 10 }),
    );
    expect(creado).toMatchObject({ id: 10, esPropio: true, estado: ESTADOS.Perdido });
  });

  it('geocodifica el lugar con provincia, localidad y referencia', async () => {
    await service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    expect(geocodificarLugar).toHaveBeenCalledWith({
      provincia: 'Mendoza',
      localidad: 'Godoy Cruz',
      referencia: 'Barrio Bombal',
    });
  });

  it('con el punto que el usuario vio en el mapa, no vuelve a geocodificar', async () => {
    const elegido = { lugarLatitud: -32.93, lugarLongitud: -68.85 };

    await service.crearAviso({ ...DATOS, ...elegido }, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    expect(geocodificarLugar).not.toHaveBeenCalled();
    expect(vi.mocked(repo.crear).mock.calls[0]![0]).toMatchObject(elegido);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ detalle: 'estado=Perdido lugar=elegido' }),
    );
  });

  it('publica igual si el geocoder no encuentra el lugar', async () => {
    vi.mocked(geocodificarLugar).mockResolvedValue(null);
    vi.mocked(repo.crear).mockResolvedValue(aviso(10, { reportanteId: USUARIO, lugar: null }));

    const creado = await service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    expect(vi.mocked(repo.crear).mock.calls[0]![0]).toMatchObject({
      lugarLatitud: null,
      lugarLongitud: null,
    });
    // Sin coordenadas del lugar, el link busca el texto: nunca usa las del teléfono.
    expect(creado.mapaUrl).toBe(
      'https://www.google.com/maps/search/?api=1&query=' +
        encodeURIComponent('Barrio Bombal, Godoy Cruz, Mendoza, Argentina'),
    );
  });

  it('muestra el lugar con el formato de la dirección del perfil', async () => {
    const creado = await service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    expect(creado).toMatchObject({
      ubicacion: 'Barrio Bombal, Godoy Cruz - Mendoza',
      provincia: 'Mendoza',
      localidad: 'Godoy Cruz',
      referencia: 'Barrio Bombal',
      mapaUrl: `https://www.google.com/maps?q=${LUGAR.latitud},${LUGAR.longitud}`,
    });
  });

  it('guarda varias fotos en el orden recibido y devuelve la galería', async () => {
    const otro = { buffer: Buffer.from('otra'), mimetype: 'image/png' };
    const galeria = [URL_FOTO, '/api/v1/archivos/perdidos/y.png'];
    vi.mocked(guardarImagenes).mockResolvedValue(galeria);
    vi.mocked(repo.crear).mockResolvedValue(
      aviso(10, { reportanteId: USUARIO, imagenes: galeria }),
    );

    const creado = await service.crearAviso(DATOS, {
      usuarioId: USUARIO,
      archivos: [ARCHIVO, otro],
    });

    expect(guardarImagenes).toHaveBeenCalledWith([ARCHIVO, otro], 'perdidos');
    expect(vi.mocked(repo.crear).mock.calls[0]![0]).toMatchObject({ imagenes: galeria });
    expect(creado).toMatchObject({ imagenUrl: URL_FOTO, imagenes: galeria });
  });

  it('devuelve la fecha del suceso como día, sin hora', async () => {
    const creado = await service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    expect(creado.fechaSuceso).toBe('2026-09-18');
  });

  it('devuelve la distancia desde el teléfono de quien publica, como la vería en el portal', async () => {
    const creado = await service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    // Del DISPOSITIVO a la plaza de Godoy Cruz, redondeado a un decimal.
    expect(creado.distanciaKm).toBe(19.5);
  });

  it('sin lugar geocodificado el alta no devuelve distancia', async () => {
    vi.mocked(geocodificarLugar).mockResolvedValue(null);
    vi.mocked(repo.crear).mockResolvedValue(aviso(10, { reportanteId: USUARIO, lugar: null }));

    const creado = await service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    expect(creado.distanciaKm).toBeNull();
  });

  it('no expone las coordenadas del reportante', async () => {
    const creado = await service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] });

    expect(creado).not.toHaveProperty('latitud');
    expect(creado).not.toHaveProperty('longitud');
    expect(JSON.stringify(creado)).not.toContain(String(DISPOSITIVO.latitud));
  });

  it('exige la foto y no escribe nada sin ella', async () => {
    expect(
      await codigoDeError(service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [] })),
    ).toBe('FOTO_REQUERIDA');
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('rechaza un usuario que ya no existe', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(null);

    expect(
      await codigoDeError(service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] })),
    ).toBe('NO_ENCONTRADO');
  });

  it('rechaza un estado que no existe', async () => {
    expect(
      await codigoDeError(
        service.crearAviso(
          { ...DATOS, estadoId: 999 },
          { usuarioId: USUARIO, archivos: [ARCHIVO] },
        ),
      ),
    ).toBe('NO_ENCONTRADO');
  });

  it('no deja nacer un aviso como Resuelto y no sube la foto', async () => {
    expect(
      await codigoDeError(
        service.crearAviso(
          { ...DATOS, estadoId: ESTADOS.Resuelto.id },
          { usuarioId: USUARIO, archivos: [ARCHIVO] },
        ),
      ),
    ).toBe('ESTADO_INVALIDO');
    expect(guardarImagenes).not.toHaveBeenCalled();
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('exige el nombre en un aviso Perdido', async () => {
    const promesa = service.crearAviso(
      { ...DATOS, nombre: null },
      { usuarioId: USUARIO, archivos: [ARCHIVO] },
    );

    await expect(promesa).rejects.toMatchObject({
      codigo: 'VALIDACION',
      message: 'El nombre es obligatorio',
    });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('acepta un aviso Encontrado sin nombre', async () => {
    vi.mocked(repo.crear).mockResolvedValue(
      aviso(11, { reportanteId: USUARIO, estado: ESTADOS.Encontrado, nombre: null }),
    );

    const creado = await service.crearAviso(
      { ...DATOS, nombre: null, estadoId: ESTADOS.Encontrado.id },
      { usuarioId: USUARIO, archivos: [ARCHIVO] },
    );

    expect(vi.mocked(repo.crear).mock.calls[0]![0]).toMatchObject({
      nombre: null,
      estadoAnimalPerdidoId: ESTADOS.Encontrado.id,
    });
    expect(creado.nombre).toBeNull();
  });

  it('rechaza una especie que no existe sin subir las fotos', async () => {
    vi.mocked(repo.buscarEspecie).mockResolvedValue(null);

    expect(
      await codigoDeError(service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] })),
    ).toBe('NO_ENCONTRADO');
    expect(guardarImagenes).not.toHaveBeenCalled();
  });

  it('borra las fotos si falla la escritura en base', async () => {
    vi.mocked(repo.crear).mockRejectedValue(new Error('se cayó la base'));

    await expect(
      service.crearAviso(DATOS, { usuarioId: USUARIO, archivos: [ARCHIVO] }),
    ).rejects.toThrow('se cayó la base');
    expect(borrarImagenes).toHaveBeenCalledWith([URL_FOTO]);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe('listarAvisos', () => {
  it('sin avisos devuelve una lista vacía, no un error', async () => {
    vi.mocked(repo.listar).mockResolvedValue([]);

    expect(await service.listarAvisos(FILTROS, USUARIO)).toEqual({
      avisos: [],
      hayMas: false,
      proximoCursor: null,
    });
  });

  it('con una fila de más corta la página y devuelve el cursor del último aviso', async () => {
    vi.mocked(repo.listar).mockResolvedValue([aviso(30), aviso(20), aviso(10)]);

    const pagina = await service.listarAvisos(FILTROS, USUARIO);

    expect(pagina.avisos.map((a) => a.id)).toEqual([30, 20]);
    expect(pagina.hayMas).toBe(true);
    expect(pagina.proximoCursor).toBe(20);
  });

  it('con exactamente el límite no hay más páginas', async () => {
    vi.mocked(repo.listar).mockResolvedValue([aviso(30), aviso(20)]);

    const pagina = await service.listarAvisos(FILTROS, USUARIO);

    expect(pagina.hayMas).toBe(false);
    expect(pagina.proximoCursor).toBeNull();
  });

  it('le pasa los filtros, el límite y el cursor al repository', async () => {
    vi.mocked(repo.existeAviso).mockResolvedValue({ id: 20 });
    vi.mocked(repo.listar).mockResolvedValue([]);
    const fechaDesde = new Date(2026, 8, 1);

    await service.listarAvisos(
      {
        ...FILTROS,
        cursor: 20,
        fechaDesde,
        estados: [1, 2],
        especies: [1],
        provincias: ['Mendoza', 'San Juan'],
        localidades: [{ provincia: 'Mendoza', localidad: 'Maipú' }],
      },
      USUARIO,
    );

    expect(repo.listar).toHaveBeenCalledWith(
      {
        fechaDesde,
        fechaHasta: undefined,
        estados: [1, 2],
        especies: [1],
        provincias: ['Mendoza', 'San Juan'],
        localidades: [{ provincia: 'Mendoza', localidad: 'Maipú' }],
        idsCercanos: undefined,
      },
      2,
      20,
    );
    expect(repo.idsEnRadio).not.toHaveBeenCalled();
  });

  it('con radio, restringe el listado a los avisos cercanos', async () => {
    vi.mocked(repo.idsEnRadio).mockResolvedValue([5, 8]);
    vi.mocked(repo.listar).mockResolvedValue([]);

    await service.listarAvisos({ ...FILTROS, ...LUGAR, radioKm: 10 }, USUARIO);

    expect(repo.idsEnRadio).toHaveBeenCalledWith(LUGAR.latitud, LUGAR.longitud, 10);
    expect(vi.mocked(repo.listar).mock.calls[0]![0]).toMatchObject({ idsCercanos: [5, 8] });
  });

  it('con la ubicación del usuario, calcula la distancia al lugar', async () => {
    vi.mocked(repo.listar).mockResolvedValue([aviso(1)]);
    // A unos 3,5 km al norte de la plaza de Godoy Cruz.
    const usuario = { latitud: -32.895, longitud: -68.8447 };

    const { avisos } = await service.listarAvisos({ ...FILTROS, ...usuario }, USUARIO);

    expect(avisos[0]!.distanciaKm).toBe(3.5);
  });

  it('sin lugar geocodificado no muestra distancia, aunque el usuario mande su ubicación', async () => {
    vi.mocked(repo.listar).mockResolvedValue([aviso(1, { lugar: null })]);

    const { avisos } = await service.listarAvisos({ ...FILTROS, ...LUGAR }, USUARIO);

    expect(avisos[0]!.distanciaKm).toBeNull();
  });

  it('sin la ubicación del usuario no hay distancia', async () => {
    vi.mocked(repo.listar).mockResolvedValue([aviso(1)]);

    const { avisos } = await service.listarAvisos(FILTROS, USUARIO);

    expect(avisos[0]!.distanciaKm).toBeNull();
  });

  it('rechaza un cursor que no existe', async () => {
    vi.mocked(repo.existeAviso).mockResolvedValue(null);

    expect(await codigoDeError(service.listarAvisos({ ...FILTROS, cursor: 404 }, USUARIO))).toBe(
      'CURSOR_INVALIDO',
    );
    expect(repo.listar).not.toHaveBeenCalled();
  });

  it('marca como propios sólo los avisos del usuario autenticado', async () => {
    vi.mocked(repo.listar).mockResolvedValue([aviso(2, { reportanteId: USUARIO }), aviso(1)]);

    const { avisos } = await service.listarAvisos(FILTROS, USUARIO);

    expect(avisos.map((a) => a.esPropio)).toEqual([true, false]);
  });

  it('pinta un aviso viejo sin especie en vez de romper el listado', async () => {
    vi.mocked(repo.listar).mockResolvedValue([aviso(1, { especie: null })]);

    const { avisos } = await service.listarAvisos(FILTROS, USUARIO);

    expect(avisos[0]!.especie).toBeNull();
  });
});

describe('ubicarLugar', () => {
  const LUGAR_FORM = { provincia: 'Mendoza', localidad: 'Godoy Cruz', referencia: 'Plaza' };

  it('devuelve el link de Maps y el punto del lugar, sin guardar nada', async () => {
    expect(await service.ubicarLugar(LUGAR_FORM)).toEqual({
      mapaUrl: `https://www.google.com/maps?q=${LUGAR.latitud},${LUGAR.longitud}`,
      ...LUGAR,
    });
    expect(geocodificarLugar).toHaveBeenCalledWith(LUGAR_FORM);
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('si no lo encuentra, responde LUGAR_NO_UBICADO para ofrecer el link a mano', async () => {
    vi.mocked(geocodificarLugar).mockResolvedValue(null);

    expect(await codigoDeError(service.ubicarLugar(LUGAR_FORM))).toBe('LUGAR_NO_UBICADO');
  });
});

describe('leerLinkMapa', () => {
  const LINK = 'https://maps.app.goo.gl/abc123';

  it('lee el punto del link y devuelve el link con ese punto', async () => {
    vi.mocked(resolverCoordenadasDeMapsUrl).mockResolvedValue(LUGAR);

    expect(await service.leerLinkMapa(LINK)).toEqual({
      mapaUrl: `https://www.google.com/maps?q=${LUGAR.latitud},${LUGAR.longitud}`,
      ...LUGAR,
    });
    expect(resolverCoordenadasDeMapsUrl).toHaveBeenCalledWith(LINK);
  });

  it('un link sin ubicación responde LINK_MAPA_INVALIDO', async () => {
    vi.mocked(resolverCoordenadasDeMapsUrl).mockResolvedValue(null);

    expect(await codigoDeError(service.leerLinkMapa(LINK))).toBe('LINK_MAPA_INVALIDO');
  });
});

describe('listarUbicaciones', () => {
  it('agrupa las localidades con avisos por provincia, en orden alfabético', async () => {
    vi.mocked(repo.listarUbicaciones).mockResolvedValue([
      { provincia: 'San Juan', localidad: 'Rivadavia' },
      { provincia: 'Mendoza', localidad: 'Maipú' },
      { provincia: 'Mendoza', localidad: 'Godoy Cruz' },
      { provincia: null, localidad: 'Ciudad de Mendoza' },
    ]);

    expect(await service.listarUbicaciones()).toEqual([
      { provincia: 'Mendoza', localidades: ['Godoy Cruz', 'Maipú'] },
      { provincia: 'San Juan', localidades: ['Rivadavia'] },
    ]);
  });
});
