import { describe, expect, it } from 'vitest';
import {
  crearSolicitudSchema,
  filtrosRecibidasSchema,
  idSolicitudSchema,
  resolverSolicitudSchema,
} from '../../../src/modules/solicitudes/solicitudes.dto';
import { aFechaISO } from '../../../src/shared/validation/dates';

function primerErrorResolver(entrada: unknown): string | undefined {
  const resultado = resolverSolicitudSchema.safeParse(entrada);
  return resultado.success ? undefined : resultado.error.issues[0]?.message;
}

describe('resolverSolicitudSchema', () => {
  it('acepta Aprobada sin comentario', () => {
    const resultado = resolverSolicitudSchema.safeParse({ estado: 'Aprobada' });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data).toEqual({ estado: 'Aprobada', comentario: null });
    }
  });

  it('acepta Rechazada con comentario', () => {
    const resultado = resolverSolicitudSchema.safeParse({
      estado: 'Rechazada',
      comentario: 'No cumple los requisitos',
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.comentario).toBe('No cumple los requisitos');
    }
  });

  it('un comentario vacío se guarda como null (igual que mascotas.dto.ts)', () => {
    const resultado = resolverSolicitudSchema.safeParse({ estado: 'Aprobada', comentario: '' });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.comentario).toBeNull();
    }
  });

  it('rechaza un estado que no sea Aprobada/Rechazada (nunca "Pendiente" ni "Cancelada" a mano)', () => {
    expect(primerErrorResolver({ estado: 'Pendiente' })).toBeDefined();
    expect(primerErrorResolver({ estado: 'Cancelada' })).toBeDefined();
    expect(primerErrorResolver({ estado: 'algo-inventado' })).toBeDefined();
  });

  it('rechaza sin estado', () => {
    expect(primerErrorResolver({})).toBe('El estado es obligatorio');
  });

  it('rechaza un comentario más largo que el límite', () => {
    const comentario = 'a'.repeat(501);
    expect(primerErrorResolver({ estado: 'Aprobada', comentario })).toBeDefined();
  });

  it('acepta un comentario justo en el límite (500)', () => {
    const comentario = 'a'.repeat(500);
    expect(primerErrorResolver({ estado: 'Aprobada', comentario })).toBeUndefined();
  });
});

describe('filtrosRecibidasSchema', () => {
  it('valores por defecto sin query params', () => {
    const resultado = filtrosRecibidasSchema.parse({});
    expect(resultado).toEqual({ limite: 20, desplazamiento: 0 });
  });

  it('coerciona limite/desplazamiento desde query string', () => {
    const resultado = filtrosRecibidasSchema.parse({ limite: '5', desplazamiento: '10' });
    expect(resultado).toEqual({ limite: 5, desplazamiento: 10 });
  });

  it('acepta un estado válido del catálogo', () => {
    const resultado = filtrosRecibidasSchema.parse({ estado: 'Aprobada' });
    expect(resultado.estado).toBe('Aprobada');
  });

  it('rechaza un estado que no está en el catálogo', () => {
    expect(() => filtrosRecibidasSchema.parse({ estado: 'no-existe' })).toThrow();
  });

  it('rechaza limite por encima del máximo (50)', () => {
    expect(() => filtrosRecibidasSchema.parse({ limite: '51' })).toThrow();
  });

  it('rechaza desplazamiento negativo', () => {
    expect(() => filtrosRecibidasSchema.parse({ desplazamiento: '-1' })).toThrow();
  });
});

describe('idSolicitudSchema', () => {
  it('coerciona el id que llega como string desde la URL', () => {
    expect(idSolicitudSchema.parse('12')).toBe(12);
  });

  it('rechaza un id no numérico', () => {
    expect(() => idSolicitudSchema.parse('abc')).toThrow();
  });

  it('rechaza un id negativo o cero', () => {
    expect(() => idSolicitudSchema.parse('0')).toThrow();
    expect(() => idSolicitudSchema.parse('-1')).toThrow();
  });
});

describe('crearSolicitudSchema (HU-7.1)', () => {
  const HOGAR = {
    direccion: 'Av. Santa Fe 3450, Palermo',
    tipoVivienda: 'Casa',
    espacioExterior: 'Patio',
    tieneNinios: false,
    tieneMascotas: true,
    detalleMascotas: '1 gato y otros 2 perros grandes',
    experienciaPrevia: true,
    horasSolo: 8,
    descripcion: '',
  };

  const MOTIVACION = 'Vivimos en una casa con patio y ya criamos perros grandes.';

  /**
   * Un día que siempre es futuro, para que las pruebas no venzan con el calendario.
   *
   * `aFechaISO` y no `toISOString().slice(0, 10)`: ese último lee los componentes en UTC,
   * que en un huso horario negativo (Argentina, UTC-3) puede quedar un día adelantado
   * respecto del calendario local cerca de la medianoche — justo el mismo criterio que usa
   * `parsearFecha` para interpretar la fecha que arma este helper.
   */
  function enDias(dias: number): string {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + dias);
    return aFechaISO(fecha);
  }

  function parsear(entrada: Record<string, unknown>) {
    return crearSolicitudSchema.safeParse({
      publicacionId: 5,
      motivacion: MOTIVACION,
      hogar: HOGAR,
      ...entrada,
    });
  }

  /** El mensaje del campo indicado, o undefined si ese campo no dio error. */
  function errorDe(resultado: ReturnType<typeof parsear>, campo: string): string | undefined {
    if (resultado.success) return undefined;
    return resultado.error.issues.find((issue) => issue.path.includes(campo))?.message;
  }

  it('acepta una adopción sin período', () => {
    const resultado = parsear({ tipoSolicitud: 'Adopcion' });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.fechaInicioTransito).toBeNull();
      expect(resultado.data.fechaFinTransito).toBeNull();
    }
  });

  it('descarta el período que llegue en una adopción, en vez de rechazarlo', () => {
    // El formulario que pasa de tránsito a adopción deja de mostrar las fechas: no puede
    // quedar trabado por campos que el usuario ya no ve.
    const resultado = parsear({
      tipoSolicitud: 'Adopcion',
      fechaInicioTransito: enDias(5),
      fechaFinTransito: enDias(90),
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.fechaInicioTransito).toBeNull();
    }
  });

  it('acepta un tránsito con las dos puntas del período', () => {
    const resultado = parsear({
      tipoSolicitud: 'Transito',
      fechaInicioTransito: enDias(5),
      fechaFinTransito: enDias(90),
    });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.fechaInicioTransito).toBeInstanceOf(Date);
      expect(resultado.data.fechaFinTransito).toBeInstanceOf(Date);
    }
  });

  it('exige el período con el texto literal de la HU cuando falta', () => {
    const resultado = parsear({ tipoSolicitud: 'Transito', fechaInicioTransito: enDias(5) });

    expect(errorDe(resultado, 'fechaFinTransito')).toBe('Tenés que completar el campo');
  });

  it('reporta las dos puntas juntas y no de a una por request', () => {
    const resultado = parsear({ tipoSolicitud: 'Transito' });

    expect(errorDe(resultado, 'fechaInicioTransito')).toBe('Tenés que completar el campo');
    expect(errorDe(resultado, 'fechaFinTransito')).toBe('Tenés que completar el campo');
  });

  it('rechaza un fin anterior o igual al inicio', () => {
    const mismoDia = enDias(10);
    const resultado = parsear({
      tipoSolicitud: 'Transito',
      fechaInicioTransito: mismoDia,
      fechaFinTransito: mismoDia,
    });

    expect(errorDe(resultado, 'fechaFinTransito')).toMatch(/posterior a la de inicio/);
  });

  it('rechaza un inicio anterior a hoy', () => {
    const resultado = parsear({
      tipoSolicitud: 'Transito',
      fechaInicioTransito: enDias(-1),
      fechaFinTransito: enDias(90),
    });

    expect(errorDe(resultado, 'fechaInicioTransito')).toMatch(/anterior a hoy/);
  });

  it('exige una motivación de al menos 20 caracteres', () => {
    const resultado = parsear({ tipoSolicitud: 'Adopcion', motivacion: 'Lo quiero' });

    expect(errorDe(resultado, 'motivacion')).toMatch(/entre 20 y 500 caracteres/);
  });

  it('solo admite los tres topes de horas del formulario', () => {
    const resultado = parsear({
      tipoSolicitud: 'Adopcion',
      hogar: { ...HOGAR, horasSolo: 6 },
    });

    expect(errorDe(resultado, 'horasSolo')).toBe('Elegí cuántas horas quedaría sola');
  });

  it('la descripción vacía del hogar se guarda como null', () => {
    const resultado = parsear({ tipoSolicitud: 'Adopcion' });

    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data.hogar.descripcion).toBeNull();
    }
  });
});
