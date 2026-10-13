import { describe, expect, it } from 'vitest';
import {
  crearAvisoSchema,
  editarAvisoSchema,
  filtrosAvisosSchema,
  leerLinkMapaSchema,
  ubicarLugarSchema,
} from '../../../src/modules/animales-perdidos/animales-perdidos.dto';

/** El primer mensaje de error, como lo devuelve la API. */
function primerError(resultado: { success: boolean; error?: { issues: { message: string }[] } }) {
  return resultado.success ? null : resultado.error!.issues[0]!.message;
}

describe('filtrosAvisosSchema — lugar', () => {
  it('sin provincias ni localidades es "sin filtro"', () => {
    const filtros = filtrosAvisosSchema.parse({});

    expect(filtros.provincias).toEqual([]);
    expect(filtros.localidades).toEqual([]);
  });

  it('acepta varias provincias, un parámetro por valor, aunque tengan coma', () => {
    const filtros = filtrosAvisosSchema.parse({
      provincias: ['Mendoza', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur'],
    });

    expect(filtros.provincias).toEqual([
      'Mendoza',
      'Tierra del Fuego, Antártida e Islas del Atlántico Sur',
    ]);
  });

  it('separa cada localidad en provincia y localidad', () => {
    const filtros = filtrosAvisosSchema.parse({
      localidades: ['Mendoza|Rivadavia', 'San Juan | Rivadavia'],
    });

    expect(filtros.localidades).toEqual([
      { provincia: 'Mendoza', localidad: 'Rivadavia' },
      { provincia: 'San Juan', localidad: 'Rivadavia' },
    ]);
  });

  it('una sola localidad llega como string y también sirve', () => {
    expect(filtrosAvisosSchema.parse({ localidades: 'Mendoza|Maipú' }).localidades).toEqual([
      { provincia: 'Mendoza', localidad: 'Maipú' },
    ]);
  });

  it.each(['Maipú', 'Mendoza|', '|Maipú', 'Mendoza|Maipú|Coquimbito'])(
    'rechaza la localidad mal armada %j',
    (valor) => {
      expect(primerError(filtrosAvisosSchema.safeParse({ localidades: [valor] }))).toBe(
        'La localidad no es válida',
      );
    },
  );

  it('corta en 20 localidades', () => {
    const localidades = Array.from({ length: 21 }, (_, i) => `Mendoza|Localidad ${i}`);

    expect(primerError(filtrosAvisosSchema.safeParse({ localidades }))).toBe(
      'Podés elegir hasta 20 opciones a la vez',
    );
  });
});

describe('crearAvisoSchema — punto del lugar', () => {
  const DATOS = {
    estadoId: '1',
    especieId: '1',
    descripcion: 'Labrador dorado.',
    provincia: 'Mendoza',
    localidad: 'Godoy Cruz',
    fechaSuceso: '2026-09-01',
    latitud: '-32.9',
    longitud: '-68.8',
  };

  it('es opcional', () => {
    const datos = crearAvisoSchema.parse(DATOS);

    expect(datos.lugarLatitud).toBeUndefined();
    expect(datos.lugarLongitud).toBeUndefined();
  });

  it('acepta el punto que viene del mapa, con coma o punto', () => {
    const datos = crearAvisoSchema.parse({
      ...DATOS,
      lugarLatitud: '-32,9264',
      lugarLongitud: '-68.8447',
    });

    expect(datos).toMatchObject({ lugarLatitud: -32.9264, lugarLongitud: -68.8447 });
  });

  it('exige las dos coordenadas juntas', () => {
    expect(primerError(crearAvisoSchema.safeParse({ ...DATOS, lugarLatitud: '-32.9' }))).toBe(
      'La ubicación del lugar no es válida',
    );
  });

  it('rechaza una coordenada fuera de rango', () => {
    expect(
      primerError(
        crearAvisoSchema.safeParse({ ...DATOS, lugarLatitud: '-95', lugarLongitud: '0' }),
      ),
    ).toBe('La ubicación del lugar no es válida');
  });
});

describe('ubicarLugarSchema', () => {
  it('exige provincia y localidad, y la referencia es opcional', () => {
    expect(ubicarLugarSchema.parse({ provincia: 'Mendoza', localidad: 'Maipú' })).toEqual({
      provincia: 'Mendoza',
      localidad: 'Maipú',
      referencia: null,
    });
    expect(primerError(ubicarLugarSchema.safeParse({ provincia: 'Mendoza' }))).toBe(
      'La localidad es obligatoria',
    );
  });
});

describe('leerLinkMapaSchema', () => {
  it('exige un link http(s)', () => {
    expect(primerError(leerLinkMapaSchema.safeParse({ mapaUrl: 'no es un link' }))).toBe(
      'El link del mapa no es un link válido',
    );
    expect(leerLinkMapaSchema.parse({ mapaUrl: ' https://maps.app.goo.gl/abc ' }).mapaUrl).toBe(
      'https://maps.app.goo.gl/abc',
    );
  });
});

describe('editarAvisoSchema', () => {
  const DATOS = {
    estadoId: '1',
    especieId: '1',
    descripcion: 'Labrador dorado.',
    provincia: 'Mendoza',
    localidad: 'Godoy Cruz',
    fechaSuceso: '2026-09-01',
  };

  it('una sola foto llega como string y queda como lista', () => {
    expect(editarAvisoSchema.parse({ ...DATOS, imagenes: 'nueva' }).imagenes).toEqual(['nueva']);
  });

  it('no pide las coordenadas del teléfono: son las del alta', () => {
    expect(editarAvisoSchema.safeParse(DATOS).success).toBe(true);
  });

  it('corta en 5 fotos', () => {
    expect(
      primerError(editarAvisoSchema.safeParse({ ...DATOS, imagenes: Array(6).fill('nueva') })),
    ).toBe('Podés subir hasta 5 fotos');
  });
});
