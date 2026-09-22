import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { validarTamanioAdjuntos } from '../../../src/middlewares/uploadImagen';
import { LIMITES } from '../../../src/shared/validation/limits';

const MB = 1024 * 1024;

function archivo(mimetype: string, size: number) {
  return { mimetype, size, buffer: Buffer.alloc(0) } as Express.Multer.File;
}

/** Corre el middleware con esos archivos y devuelve el error que pasó a `next`, o `null`. */
function correr(archivos: Express.Multer.File[]): { codigo: string; mensaje: string } | null {
  const next = vi.fn() as unknown as NextFunction;
  validarTamanioAdjuntos({ files: archivos } as unknown as Request, {} as Response, next);

  const primerArgumento = vi.mocked(next).mock.calls[0]?.[0];
  if (!primerArgumento) return null;

  const error = primerArgumento as { codigo: string; mensaje: string };
  return { codigo: error.codigo, mensaje: error.mensaje };
}

describe('validarTamanioAdjuntos', () => {
  it('deja pasar una imagen dentro de los 5 MB', () => {
    expect(correr([archivo('image/jpeg', 4 * MB)])).toBeNull();
  });

  it('rechaza una imagen de más de 5 MB aunque el techo del request sea el del video', () => {
    // Es el caso que este middleware existe para cubrir: multer acepta hasta 30 MB para que
    // entre un video, y sin esto una imagen de 20 MB pasaría de largo.
    const error = correr([archivo('image/jpeg', 20 * MB)]);

    expect(error?.codigo).toBe('ARCHIVO_DEMASIADO_GRANDE');
    expect(error?.mensaje).toBe('La imagen supera el máximo de 5MB');
  });

  it('deja pasar un video de 25 MB, que es un 1080p de 15 segundos', () => {
    expect(correr([archivo('video/mp4', 25 * MB)])).toBeNull();
  });

  it('rechaza un video que pasa los 30 MB', () => {
    const error = correr([archivo('video/mp4', 31 * MB)]);

    expect(error?.codigo).toBe('ARCHIVO_DEMASIADO_GRANDE');
    expect(error?.mensaje).toBe('El video supera el máximo de 30MB');
  });

  it('aplica el tope de video a los tres formatos aceptados', () => {
    for (const formato of LIMITES.video.formatos) {
      expect(correr([archivo(formato, 25 * MB)])).toBeNull();
      expect(correr([archivo(formato, 31 * MB)])?.codigo).toBe('ARCHIVO_DEMASIADO_GRANDE');
    }
  });

  it('con varias imágenes corta en la primera que se pasa', () => {
    const error = correr([
      archivo('image/jpeg', 1 * MB),
      archivo('image/png', 9 * MB),
      archivo('image/webp', 1 * MB),
    ]);

    expect(error?.codigo).toBe('ARCHIVO_DEMASIADO_GRANDE');
  });

  it('un mensaje sin archivos pasa de largo', () => {
    expect(correr([])).toBeNull();
  });
});
