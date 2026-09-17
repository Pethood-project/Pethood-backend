import type { Server } from 'node:http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../../src/config/env';
import { autenticar } from '../../../src/middlewares/auth';
import { errorHandler } from '../../../src/middlewares/errorHandler';
import { requiereRol } from '../../../src/middlewares/roles';
import { firmarToken } from '../../../src/shared/jwt';

describe('autenticar + requiereRol (integración)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.get('/privado', autenticar, requiereRol('Administrador'), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);

    await new Promise<void>((resolve) => {
      server = app.listen(0, resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('No se pudo levantar el servidor de prueba');
    }
    baseUrl = `http://localhost:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('sin token responde 401 NO_AUTENTICADO', async () => {
    const res = await fetch(`${baseUrl}/privado`);
    const body = (await res.json()) as { error: { codigo: string } };

    expect(res.status).toBe(401);
    expect(body.error.codigo).toBe('NO_AUTENTICADO');
  });

  it('con token inválido responde 401 NO_AUTENTICADO', async () => {
    const res = await fetch(`${baseUrl}/privado`, {
      headers: { Authorization: 'Bearer esto-no-es-un-token' },
    });
    const body = (await res.json()) as { error: { codigo: string } };

    expect(res.status).toBe(401);
    expect(body.error.codigo).toBe('NO_AUTENTICADO');
  });

  it('con token expirado responde 401 NO_AUTENTICADO', async () => {
    const token = jwt.sign(
      { usuarioId: 1, roles: ['Administrador'], exp: Math.floor(Date.now() / 1000) - 10 },
      env.JWT_SECRET,
    );

    const res = await fetch(`${baseUrl}/privado`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { error: { codigo: string } };

    expect(res.status).toBe(401);
    expect(body.error.codigo).toBe('NO_AUTENTICADO');
  });

  it('con token válido pero rol insuficiente responde 403 ROL_NO_AUTORIZADO', async () => {
    const token = firmarToken({ usuarioId: 1, roles: ['Adoptante'] });

    const res = await fetch(`${baseUrl}/privado`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { error: { codigo: string } };

    expect(res.status).toBe(403);
    expect(body.error.codigo).toBe('ROL_NO_AUTORIZADO');
  });

  it('con token válido y rol correcto responde 200', async () => {
    const token = firmarToken({ usuarioId: 1, roles: ['Administrador'] });

    const res = await fetch(`${baseUrl}/privado`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { ok: boolean };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});
