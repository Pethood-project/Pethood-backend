import { describe, expect, it } from 'vitest';
import { clasificarAdjuntos, esMimeDeVideo, tipoDeUrl } from '../../../src/shared/adjuntos';

describe('esMimeDeVideo', () => {
  it('reconoce los tres formatos de video que acepta el chat', () => {
    expect(esMimeDeVideo('video/mp4')).toBe(true);
    expect(esMimeDeVideo('video/quicktime')).toBe(true);
    expect(esMimeDeVideo('video/webm')).toBe(true);
  });

  it('no confunde una imagen con un video', () => {
    expect(esMimeDeVideo('image/jpeg')).toBe(false);
    expect(esMimeDeVideo('image/png')).toBe(false);
    expect(esMimeDeVideo('image/webp')).toBe(false);
    expect(esMimeDeVideo('application/pdf')).toBe(false);
  });

  it('tolera mayúsculas y espacios, que es como algunos clientes mandan el mimetype', () => {
    expect(esMimeDeVideo(' VIDEO/MP4 ')).toBe(true);
  });

  it('un formato de video que el proyecto no acepta no cuenta como video', () => {
    // Si multer no lo dejó entrar, tratarlo como video sería mentir sobre lo que se guardó.
    expect(esMimeDeVideo('video/x-msvideo')).toBe(false);
  });
});

describe('tipoDeUrl', () => {
  it('clasifica por la extensión que le puso storage.ts', () => {
    expect(tipoDeUrl('/api/v1/archivos/chats/abc.mp4')).toBe('VIDEO');
    expect(tipoDeUrl('/api/v1/archivos/chats/abc.mov')).toBe('VIDEO');
    expect(tipoDeUrl('/api/v1/archivos/chats/abc.webm')).toBe('VIDEO');
    expect(tipoDeUrl('/api/v1/archivos/chats/abc.jpg')).toBe('IMAGEN');
    expect(tipoDeUrl('/api/v1/archivos/chats/abc.png')).toBe('IMAGEN');
    expect(tipoDeUrl('/api/v1/archivos/chats/abc.webp')).toBe('IMAGEN');
  });

  it('no se marea con la extensión en mayúsculas', () => {
    expect(tipoDeUrl('/api/v1/archivos/chats/abc.MP4')).toBe('VIDEO');
  });

  it('ante la duda devuelve IMAGEN, que es lo que era todo antes del video', () => {
    expect(tipoDeUrl('/api/v1/archivos/chats/sin-extension')).toBe('IMAGEN');
    expect(tipoDeUrl('')).toBe('IMAGEN');
  });

  it('mira la última extensión y no una que aparezca en el medio del nombre', () => {
    expect(tipoDeUrl('/api/v1/archivos/chats/video.mp4.jpg')).toBe('IMAGEN');
  });
});

describe('clasificarAdjuntos', () => {
  it('conserva el orden en que se enviaron', () => {
    expect(clasificarAdjuntos(['/a/1.jpg', '/a/2.mp4', '/a/3.png'])).toEqual([
      { url: '/a/1.jpg', tipo: 'IMAGEN' },
      { url: '/a/2.mp4', tipo: 'VIDEO' },
      { url: '/a/3.png', tipo: 'IMAGEN' },
    ]);
  });

  it('un mensaje sin adjuntos devuelve una lista vacía', () => {
    expect(clasificarAdjuntos([])).toEqual([]);
  });
});
