import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../src/middlewares/errorHandler';
import { USUARIO_SISTEMA_ID } from '../../../../src/shared/auditoria';

vi.mock('../../../../src/modules/soporte/soporte.repository', () => ({
  crearConsulta: vi.fn(),
  listarConsultas: vi.fn(),
  buscarConsulta: vi.fn(),
  resolverConsulta: vi.fn(),
  darDeBajaConsulta: vi.fn(),
  listarCategorias: vi.fn(),
  listarCategoriasConFaqsActivas: vi.fn(),
  buscarCategoria: vi.fn(),
  contarFaqsActivasDeCategoria: vi.fn(),
  crearCategoria: vi.fn(),
  editarCategoria: vi.fn(),
  darDeBajaCategoria: vi.fn(),
  buscarFaq: vi.fn(),
  crearFaq: vi.fn(),
  editarFaq: vi.fn(),
  darDeBajaFaq: vi.fn(),
}));

vi.mock('../../../../src/shared/logAuditoria', () => ({
  registrarAuditoria: vi.fn().mockResolvedValue(undefined),
}));

import * as repo from '../../../../src/modules/soporte/soporte.repository';
import * as service from '../../../../src/modules/soporte/soporte.service';

const mockedRepo = vi.mocked(repo);
const ADMIN = 9;

// Los mocks devuelven solo lo que el service lee; el cast evita armar filas completas.
const fila = <T>(datos: object) => datos as T;

async function codigoDeError(promesa: Promise<unknown>): Promise<string | undefined> {
  try {
    await promesa;
  } catch (err) {
    return err instanceof AppError ? err.codigo : undefined;
  }
  return undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enviarConsulta', () => {
  it('guarda la consulta con usuario SISTEMA y devuelve el mensaje de éxito', async () => {
    const datos = {
      nombreCompleto: 'Ana Pérez',
      email: 'ana@correo.com',
      asunto: 'No puedo subir fotos',
      mensaje: 'La foto no carga al publicar.',
    };

    const res = await service.enviarConsulta(datos);

    expect(mockedRepo.crearConsulta).toHaveBeenCalledWith(USUARIO_SISTEMA_ID, datos);
    expect(res).toEqual({ mensaje: 'Su consulta ha sido enviada con éxito' });
  });
});

describe('resolverConsulta', () => {
  it('404 si la consulta no existe', async () => {
    mockedRepo.buscarConsulta.mockResolvedValue(null);
    expect(await codigoDeError(service.resolverConsulta(ADMIN, 1))).toBe('CONSULTA_NO_ENCONTRADA');
  });

  it('409 si ya estaba resuelta', async () => {
    mockedRepo.buscarConsulta.mockResolvedValue(fila({ id: 1, resuelta: true }));
    expect(await codigoDeError(service.resolverConsulta(ADMIN, 1))).toBe('CONSULTA_YA_RESUELTA');
    expect(mockedRepo.resolverConsulta).not.toHaveBeenCalled();
  });

  it('la marca como resuelta con el admin como autor', async () => {
    mockedRepo.buscarConsulta.mockResolvedValue(fila({ id: 1, resuelta: false }));
    mockedRepo.resolverConsulta.mockResolvedValue(fila({ id: 1, resuelta: true }));

    const res = await service.resolverConsulta(ADMIN, 1);

    expect(mockedRepo.resolverConsulta).toHaveBeenCalledWith(1, ADMIN);
    expect(res.resuelta).toBe(true);
  });
});

describe('listarFaqsPublicas', () => {
  it('descarta las categorías sin FAQs activas', async () => {
    mockedRepo.listarCategoriasConFaqsActivas.mockResolvedValue(
      fila([
        {
          id: 1,
          nombre: 'Adopciones',
          descripcion: null,
          faqs: [{ id: 3, pregunta: 'P', respuesta: 'R', orden: 1, faqCategoriaId: 1 }],
        },
        { id: 2, nombre: 'Vacía', descripcion: null, faqs: [] },
      ]),
    );

    const res = await service.listarFaqsPublicas();

    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ id: 1, faqs: [{ id: 3, orden: 1 }] });
  });
});

describe('darDeBajaCategoria', () => {
  it('409 si tiene FAQs activas', async () => {
    mockedRepo.buscarCategoria.mockResolvedValue(fila({ id: 1 }));
    mockedRepo.contarFaqsActivasDeCategoria.mockResolvedValue(2);

    expect(await codigoDeError(service.darDeBajaCategoria(ADMIN, 1))).toBe('CATEGORIA_CON_FAQS');
    expect(mockedRepo.darDeBajaCategoria).not.toHaveBeenCalled();
  });

  it('baja lógica si no tiene FAQs activas', async () => {
    mockedRepo.buscarCategoria.mockResolvedValue(fila({ id: 1 }));
    mockedRepo.contarFaqsActivasDeCategoria.mockResolvedValue(0);

    await service.darDeBajaCategoria(ADMIN, 1);

    expect(mockedRepo.darDeBajaCategoria).toHaveBeenCalledWith(1, ADMIN);
  });
});

describe('FAQs', () => {
  const datos = { pregunta: '¿Cómo adopto?', respuesta: 'Así.', orden: 1, faqCategoriaId: 4 };

  it('crearFaq: 404 si la categoría no existe', async () => {
    mockedRepo.buscarCategoria.mockResolvedValue(null);
    expect(await codigoDeError(service.crearFaq(ADMIN, datos))).toBe('CATEGORIA_NO_ENCONTRADA');
    expect(mockedRepo.crearFaq).not.toHaveBeenCalled();
  });

  it('editarFaq: 404 si la FAQ no existe', async () => {
    mockedRepo.buscarFaq.mockResolvedValue(null);
    expect(await codigoDeError(service.editarFaq(ADMIN, 7, { orden: 2 }))).toBe(
      'FAQ_NO_ENCONTRADA',
    );
  });

  it('editarFaq: 404 si la nueva categoría no existe', async () => {
    mockedRepo.buscarFaq.mockResolvedValue(fila({ id: 7 }));
    mockedRepo.buscarCategoria.mockResolvedValue(null);
    expect(await codigoDeError(service.editarFaq(ADMIN, 7, { faqCategoriaId: 99 }))).toBe(
      'CATEGORIA_NO_ENCONTRADA',
    );
  });

  it('darDeBajaFaq: baja lógica con el admin como autor', async () => {
    mockedRepo.buscarFaq.mockResolvedValue(fila({ id: 7 }));
    await service.darDeBajaFaq(ADMIN, 7);
    expect(mockedRepo.darDeBajaFaq).toHaveBeenCalledWith(7, ADMIN);
  });
});
