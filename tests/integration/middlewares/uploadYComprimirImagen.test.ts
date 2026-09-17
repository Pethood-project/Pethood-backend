import type { Server } from 'node:http';
import express from 'express';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comprimirImagen } from '../../../src/middlewares/comprimirImagen';
import { errorHandler } from '../../../src/middlewares/errorHandler';
import { uploadImagen } from '../../../src/middlewares/uploadImagen';

describe('uploadImagen + comprimirImagen (integración)', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.post('/test', uploadImagen('imagen'), comprimirImagen, (req, res) => {
      res.json({ size: req.file?.size, mimetype: req.file?.mimetype });
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

  it('comprime una imagen jpeg válida y responde 200', async () => {
    const original = await sharp({
      create: { width: 2000, height: 2000, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    const form = new FormData();
    form.append('imagen', new Blob([original], { type: 'image/jpeg' }), 'test.jpg');

    const res = await fetch(`${baseUrl}/test`, { method: 'POST', body: form });
    const body = (await res.json()) as { size: number; mimetype: string };

    expect(res.status).toBe(200);
    expect(body.mimetype).toBe('image/jpeg');
    expect(body.size).toBeLessThan(original.length);
  });

  it('rechaza un archivo que no es imagen con 400 y el formato de error del proyecto', async () => {
    const form = new FormData();
    form.append(
      'imagen',
      new Blob([Buffer.from('no es una imagen')], { type: 'text/plain' }),
      'archivo.txt',
    );

    const res = await fetch(`${baseUrl}/test`, { method: 'POST', body: form });
    const body = (await res.json()) as { error: { codigo: string; mensaje: string } };

    expect(res.status).toBe(400);
    expect(body.error.codigo).toBe('ARCHIVO_INVALIDO');
  });
});
