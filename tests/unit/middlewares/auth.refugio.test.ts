import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/auth/auth.repository', () => ({
  buscarEstadoRefugioDeUsuario: vi.fn(),
}));

import { autenticar } from '../../../src/middlewares/auth';
import * as authRepo from '../../../src/modules/auth/auth.repository';
import { firmarToken } from '../../../src/shared/jwt';

const mockedRepo = vi.mocked(authRepo);

function pedido(roles: string[], ambito?: string) {
  const token = firmarToken({ usuarioId: 7, email: 'a@b.com', roles });
  return {
    headers: { authorization: `Bearer ${token}`, ...(ambito ? { 'x-ambito': ambito } : {}) },
  } as unknown as Request;
}

async function correr(req: Request) {
  const next = vi.fn();
  await autenticar(req, {} as never, next);
  return next;
}

describe('autenticar — refugio verificado', () => {
  beforeEach(() => vi.clearAllMocks());

  it('miembro con refugio Pendiente_Verificacion recibe 403 REFUGIO_NO_VERIFICADO', async () => {
    mockedRepo.buscarEstadoRefugioDeUsuario.mockResolvedValue('Pendiente_Verificacion');

    const next = await correr(pedido(['ADOPTANTE', 'MIEMBRO_REFUGIO']));

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ codigo: 'REFUGIO_NO_VERIFICADO' }));
  });

  it('miembro con refugio Activo pasa como REFUGIO', async () => {
    mockedRepo.buscarEstadoRefugioDeUsuario.mockResolvedValue('Activo');
    const req = pedido(['ADOPTANTE', 'MIEMBRO_REFUGIO']);

    const next = await correr(req);

    expect(next).toHaveBeenCalledWith();
    expect(req.ambito).toBe('REFUGIO');
  });

  it('miembro con refugio pendiente puede actuar como PERSONAL', async () => {
    const req = pedido(['ADOPTANTE', 'MIEMBRO_REFUGIO'], 'PERSONAL');

    const next = await correr(req);

    expect(next).toHaveBeenCalledWith();
    expect(mockedRepo.buscarEstadoRefugioDeUsuario).not.toHaveBeenCalled();
  });
});
