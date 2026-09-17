import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as controller from '../../../src/modules/dashboard-admin/dashboard-admin.controller';
import * as service from '../../../src/modules/dashboard-admin/dashboard-admin.service';

vi.mock('../../../src/modules/dashboard-admin/dashboard-admin.service');

function mockRes() {
  return {
    setHeader: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;
}

const next = vi.fn() as unknown as NextFunction;

beforeEach(() => {
  vi.resetAllMocks();
});

describe('exportar', () => {
  it('entidad inválida corta con AppError 400 antes de escribir nada', async () => {
    const res = mockRes();
    const req = { params: { entidad: 'inexistente' } } as unknown as Request;

    await controller.exportar(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ codigo: 'ENTIDAD_INVALIDA', httpStatus: 400 }),
    );
    expect(res.write).not.toHaveBeenCalled();
  });

  it('streamea headers y filas en orden, después cierra la respuesta', async () => {
    async function* filas() {
      yield [1, 'Firulais'];
      yield [2, 'Michi'];
    }
    vi.mocked(service.exportarEntidad).mockReturnValue({ headers: ['id', 'nombre'], filas });

    const res = mockRes();
    const req = { params: { entidad: 'mascotas' } } as unknown as Request;

    await controller.exportar(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.write).toHaveBeenNthCalledWith(1, 'id,nombre\n');
    expect(res.write).toHaveBeenNthCalledWith(2, '1,Firulais\n');
    expect(res.write).toHaveBeenNthCalledWith(3, '2,Michi\n');
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('si el generador explota a mitad de stream, corta la conexión sin relanzar', async () => {
    async function* filas(): AsyncGenerator<unknown[]> {
      yield [1, 'Firulais'];
      throw new Error('DB caída a mitad de export');
    }
    vi.mocked(service.exportarEntidad).mockReturnValue({ headers: ['id', 'nombre'], filas });

    const res = mockRes();
    const req = { params: { entidad: 'mascotas' } } as unknown as Request;

    await expect(controller.exportar(req, res, next)).resolves.toBeUndefined();

    expect(res.write).toHaveBeenCalledTimes(2); // headers + primera fila, la segunda nunca llega
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled(); // ya no se puede mandar error JSON, headers ya viajaron
  });
});
