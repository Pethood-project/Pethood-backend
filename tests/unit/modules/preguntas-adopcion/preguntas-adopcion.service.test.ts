import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../../../src/modules/preguntas-adopcion/preguntas-adopcion.repository';
import * as service from '../../../../src/modules/preguntas-adopcion/preguntas-adopcion.service';
import * as logAuditoria from '../../../../src/shared/logAuditoria';

vi.mock('../../../../src/modules/preguntas-adopcion/preguntas-adopcion.repository');
vi.mock('../../../../src/shared/logAuditoria');

const MIEMBRO = 5;
const REFUGIO = 3;

function fila(parcial: Partial<Record<string, unknown>> & { id: number }) {
  return {
    refugioId: REFUGIO,
    especieId: null,
    especie: null,
    texto: `Pregunta ${parcial.id}`,
    tipo: 'TEXTO',
    opciones: [],
    obligatoria: false,
    orden: parcial.id,
    activa: true,
    ...parcial,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({
    id: MIEMBRO,
    refugioId: REFUGIO,
  } as never);
  vi.mocked(repo.contarActivas).mockResolvedValue(0);
});

describe('quién las gestiona', () => {
  it('solo un miembro de un refugio: sin refugio es 403', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue({ id: 9, refugioId: null } as never);

    await expect(service.listar(9)).rejects.toMatchObject({
      codigo: 'SIN_REFUGIO',
      httpStatus: 403,
    });
  });

  it('un usuario que no existe es 404', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(null);

    await expect(service.listar(9)).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });

  it('lista las del refugio con su alcance', async () => {
    vi.mocked(repo.listarDelRefugio).mockResolvedValue([
      fila({ id: 1, especieId: 2, especie: { id: 2, nombre: 'Perro' } }),
      fila({ id: 2, activa: false }),
    ] as never);

    const preguntas = await service.listar(MIEMBRO);

    expect(repo.listarDelRefugio).toHaveBeenCalledWith(REFUGIO);
    expect(preguntas).toHaveLength(2);
    expect(preguntas[0]).toMatchObject({
      id: 1,
      especie: { id: 2, nombre: 'Perro' },
      activa: true,
    });
    expect(preguntas[1]).toMatchObject({ id: 2, activa: false, especie: null });
  });
});

describe('crear', () => {
  const DATOS = {
    texto: '¿Tenés veterinario cerca?',
    tipo: 'SI_NO' as const,
    opciones: [],
    obligatoria: true,
    especieId: null,
  };

  it('crea la pregunta en el refugio de quien la pide y deja auditoría', async () => {
    vi.mocked(repo.crear).mockResolvedValue(fila({ id: 11, ...DATOS }) as never);

    const creada = await service.crear(DATOS, MIEMBRO);

    expect(repo.crear).toHaveBeenCalledWith(REFUGIO, DATOS, MIEMBRO);
    expect(creada.id).toBe(11);
    expect(logAuditoria.registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'CREAR', entidad: 'PreguntaAdopcion', entidadId: 11 }),
    );
  });

  it('no pasa de 5 activas', async () => {
    vi.mocked(repo.contarActivas).mockResolvedValue(5);

    await expect(service.crear(DATOS, MIEMBRO)).rejects.toMatchObject({
      codigo: 'LIMITE_PREGUNTAS',
      mensaje: 'Llegaste al máximo de 5 preguntas activas',
      httpStatus: 409,
    });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('rechaza una especie que no existe', async () => {
    vi.mocked(repo.buscarEspecie).mockResolvedValue(null);

    await expect(service.crear({ ...DATOS, especieId: 99 }, MIEMBRO)).rejects.toMatchObject({
      codigo: 'VALIDACION',
      mensaje: 'La especie no existe',
    });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('acepta una especie que existe', async () => {
    vi.mocked(repo.buscarEspecie).mockResolvedValue({ id: 2 } as never);
    vi.mocked(repo.crear).mockResolvedValue(fila({ id: 12, especieId: 2 }) as never);

    await service.crear({ ...DATOS, especieId: 2 }, MIEMBRO);

    expect(repo.crear).toHaveBeenCalled();
  });
});

describe('actualizar', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarDelRefugio).mockResolvedValue(fila({ id: 4 }) as never);
    vi.mocked(repo.actualizar).mockResolvedValue(fila({ id: 4 }) as never);
  });

  it('una pregunta de otro refugio no existe para quien la edita (404)', async () => {
    vi.mocked(repo.buscarDelRefugio).mockResolvedValue(null);

    await expect(service.actualizar(4, { obligatoria: true }, MIEMBRO)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
    expect(repo.actualizar).not.toHaveBeenCalled();
  });

  it('cambia solo lo que llega', async () => {
    await service.actualizar(4, { obligatoria: true }, MIEMBRO);

    expect(repo.actualizar).toHaveBeenCalledWith(
      4,
      { tipo: 'TEXTO', opciones: [], obligatoria: true },
      MIEMBRO,
    );
  });

  it('pasar a OPCIONES exige las opciones', async () => {
    await expect(service.actualizar(4, { tipo: 'OPCIONES' }, MIEMBRO)).rejects.toMatchObject({
      codigo: 'VALIDACION',
      mensaje: 'Cargá entre 2 y 6 opciones',
    });
  });

  it('pasar de OPCIONES a otro tipo descarta las opciones', async () => {
    vi.mocked(repo.buscarDelRefugio).mockResolvedValue(
      fila({ id: 4, tipo: 'OPCIONES', opciones: ['Casa', 'Depto'] }) as never,
    );

    await service.actualizar(4, { tipo: 'SI_NO' }, MIEMBRO);

    expect(repo.actualizar).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ tipo: 'SI_NO', opciones: [] }),
      MIEMBRO,
    );
  });

  it('especieId null la pasa a "todas"', async () => {
    await service.actualizar(4, { especieId: null }, MIEMBRO);

    expect(repo.actualizar).toHaveBeenCalledWith(
      4,
      expect.objectContaining({ especieId: null }),
      MIEMBRO,
    );
  });

  it('reactivar una pregunta cuenta contra el tope, y desactivarla no', async () => {
    vi.mocked(repo.buscarDelRefugio).mockResolvedValue(fila({ id: 4, activa: false }) as never);
    vi.mocked(repo.contarActivas).mockResolvedValue(5);

    await expect(service.actualizar(4, { activa: true }, MIEMBRO)).rejects.toMatchObject({
      codigo: 'LIMITE_PREGUNTAS',
    });

    vi.mocked(repo.buscarDelRefugio).mockResolvedValue(fila({ id: 4, activa: true }) as never);
    await expect(service.actualizar(4, { activa: false }, MIEMBRO)).resolves.toBeDefined();
  });
});

describe('eliminar', () => {
  it('es una baja lógica y deja auditoría', async () => {
    vi.mocked(repo.buscarDelRefugio).mockResolvedValue(fila({ id: 4 }) as never);

    await service.eliminar(4, MIEMBRO);

    expect(repo.darDeBaja).toHaveBeenCalledWith(4, MIEMBRO);
    expect(logAuditoria.registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'ELIMINAR', entidadId: 4 }),
    );
  });

  it('una que no es del refugio es 404', async () => {
    vi.mocked(repo.buscarDelRefugio).mockResolvedValue(null);

    await expect(service.eliminar(4, MIEMBRO)).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    expect(repo.darDeBaja).not.toHaveBeenCalled();
  });
});

describe('reordenar', () => {
  beforeEach(() => {
    vi.mocked(repo.listarDelRefugio).mockResolvedValue([
      fila({ id: 1 }),
      fila({ id: 2 }),
      fila({ id: 3 }),
    ] as never);
  });

  it('ordena las que nombra, sin repetidas', async () => {
    await service.reordenar({ ids: [3, 1, 3] }, MIEMBRO);

    expect(repo.reordenar).toHaveBeenCalledWith(REFUGIO, [3, 1], MIEMBRO);
  });

  it('una pregunta ajena es 404 y no reordena nada', async () => {
    await expect(service.reordenar({ ids: [1, 99] }, MIEMBRO)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
    });
    expect(repo.reordenar).not.toHaveBeenCalled();
  });
});

describe('preguntasAplicables', () => {
  it('devuelve solo lo que necesita el formulario', async () => {
    vi.mocked(repo.listarAplicables).mockResolvedValue([
      fila({ id: 1, obligatoria: true, tipo: 'OPCIONES', opciones: ['Casa', 'Depto'] }),
    ] as never);

    const aplicables = await service.preguntasAplicables(REFUGIO, 2);

    expect(repo.listarAplicables).toHaveBeenCalledWith(REFUGIO, 2);
    expect(aplicables).toEqual([
      {
        id: 1,
        texto: 'Pregunta 1',
        tipo: 'OPCIONES',
        opciones: ['Casa', 'Depto'],
        obligatoria: true,
      },
    ]);
  });
});
