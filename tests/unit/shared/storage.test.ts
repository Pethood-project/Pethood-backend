import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/shared/r2', () => ({
  r2Habilitado: vi.fn(),
  esUrlDeR2: vi.fn(),
  subirArchivo: vi.fn(),
  borrarArchivo: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

import { unlink, writeFile } from 'node:fs/promises';
import * as r2 from '../../../src/shared/r2';
import {
  borrarImagen,
  borrarImagenes,
  guardarImagen,
  guardarImagenes,
  RUTA_PUBLICA_ARCHIVOS,
} from '../../../src/shared/storage';

const FOTO = { buffer: Buffer.from('foto'), mimetype: 'image/jpeg' };
const VIDEO = { buffer: Buffer.from('video'), mimetype: 'video/mp4' };

const URL_R2 = 'https://cdn.pethood.test/chats/abc.mp4';
const URL_DISCO = `${RUTA_PUBLICA_ARCHIVOS}/chats/abc.jpg`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(r2.esUrlDeR2).mockImplementation((url) => url.startsWith('https://'));
});

describe('guardarImagen — a dónde va el archivo', () => {
  it('con R2 habilitado sube al bucket y no toca el disco', async () => {
    vi.mocked(r2.r2Habilitado).mockReturnValue(true);
    vi.mocked(r2.subirArchivo).mockResolvedValue(URL_R2);

    const url = await guardarImagen(VIDEO, 'chats');

    expect(r2.subirArchivo).toHaveBeenCalledWith(VIDEO, 'chats');
    expect(writeFile).not.toHaveBeenCalled();
    expect(url).toBe(URL_R2);
  });

  it('con R2 deshabilitado escribe en disco y devuelve una ruta relativa', async () => {
    vi.mocked(r2.r2Habilitado).mockReturnValue(false);

    const url = await guardarImagen(FOTO, 'chats');

    expect(r2.subirArchivo).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(url).toMatch(new RegExp(`^${RUTA_PUBLICA_ARCHIVOS}/chats/.+\\.jpg$`));
  });

  it('le pone al archivo la extensión de su tipo, también a un video', async () => {
    vi.mocked(r2.r2Habilitado).mockReturnValue(false);

    // Es lo que distingue un video de una foto en `mensaje_imagenes`, que guarda las dos
    // cosas en la misma columna: si la extensión miente, el adjunto se clasifica mal.
    await expect(guardarImagen(VIDEO, 'chats')).resolves.toMatch(/\.mp4$/);
    await expect(
      guardarImagen({ ...VIDEO, mimetype: 'video/quicktime' }, 'chats'),
    ).resolves.toMatch(/\.mov$/);
  });
});

describe('guardarImagenes — conserva el orden', () => {
  it('devuelve las URLs en el orden en que llegaron los archivos', async () => {
    vi.mocked(r2.r2Habilitado).mockReturnValue(true);
    vi.mocked(r2.subirArchivo)
      .mockResolvedValueOnce('https://cdn.pethood.test/chats/1.jpg')
      .mockResolvedValueOnce('https://cdn.pethood.test/chats/2.jpg')
      .mockResolvedValueOnce('https://cdn.pethood.test/chats/3.jpg');

    await expect(guardarImagenes([FOTO, FOTO, FOTO], 'chats')).resolves.toEqual([
      'https://cdn.pethood.test/chats/1.jpg',
      'https://cdn.pethood.test/chats/2.jpg',
      'https://cdn.pethood.test/chats/3.jpg',
    ]);
  });

  it('sin archivos no toca ningún destino', async () => {
    vi.mocked(r2.r2Habilitado).mockReturnValue(false);

    await expect(guardarImagenes([], 'chats')).resolves.toEqual([]);
    expect(writeFile).not.toHaveBeenCalled();
    expect(r2.subirArchivo).not.toHaveBeenCalled();
  });
});

describe('borrarImagen — decide por la URL, no por el flag', () => {
  it('una URL de R2 se borra del bucket aunque R2 esté deshabilitado', async () => {
    // El caso de apagar R2 después de haber subido: lo guardado allá se sigue borrando allá.
    vi.mocked(r2.r2Habilitado).mockReturnValue(false);

    await borrarImagen(URL_R2);

    expect(r2.borrarArchivo).toHaveBeenCalledWith(URL_R2);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('una ruta relativa se borra del disco aunque R2 esté habilitado', async () => {
    // El caso de la migración: las filas viejas siguen apuntando al disco.
    vi.mocked(r2.r2Habilitado).mockReturnValue(true);

    await borrarImagen(URL_DISCO);

    expect(unlink).toHaveBeenCalledTimes(1);
    expect(r2.borrarArchivo).not.toHaveBeenCalled();
  });

  it('no sale del directorio de uploads', async () => {
    await borrarImagen(`${RUTA_PUBLICA_ARCHIVOS}/../../.env`);

    expect(unlink).not.toHaveBeenCalled();
  });

  it('si el archivo ya no está, no lanza', async () => {
    vi.mocked(unlink).mockRejectedValueOnce(new Error('ENOENT'));

    await expect(borrarImagen(URL_DISCO)).resolves.toBeUndefined();
  });

  it('borrarImagenes manda cada URL a su destino en la misma tanda', async () => {
    await borrarImagenes([URL_R2, URL_DISCO]);

    expect(r2.borrarArchivo).toHaveBeenCalledWith(URL_R2);
    expect(unlink).toHaveBeenCalledTimes(1);
  });
});
