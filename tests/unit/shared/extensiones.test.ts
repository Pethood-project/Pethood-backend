import { describe, expect, it } from 'vitest';
import { extensionPara } from '../../../src/shared/extensiones';
import { LIMITES } from '../../../src/shared/validation/limits';

describe('extensionPara', () => {
  it('resuelve los formatos de imagen', () => {
    expect(extensionPara('image/jpeg')).toBe('jpg');
    expect(extensionPara('image/png')).toBe('png');
    expect(extensionPara('image/webp')).toBe('webp');
  });

  it('resuelve el pdf de los comprobantes de historia clínica', () => {
    expect(extensionPara('application/pdf')).toBe('pdf');
  });

  it('resuelve los formatos de video', () => {
    // Es el bug que este módulo existe para cerrar: el mapa de R2 no los conocía y un .mp4
    // se habría subido al bucket como .jpg.
    expect(extensionPara('video/mp4')).toBe('mp4');
    expect(extensionPara('video/quicktime')).toBe('mov');
    expect(extensionPara('video/webm')).toBe('webm');
  });

  it('cubre TODOS los formatos que los límites declaran aceptables', () => {
    // Si alguien suma un formato a LIMITES y se olvida del mapa, el archivo entraría y se
    // guardaría con la extensión equivocada. Este test lo caza antes: el formato nuevo no
    // va a estar acá abajo y hay que decidir explícitamente qué extensión le toca.
    const ESPERADAS: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
    };

    const declarados = [
      ...LIMITES.imagen.formatos,
      ...LIMITES.video.formatos,
      ...LIMITES.documento.formatos,
    ];

    for (const mime of declarados) {
      expect(ESPERADAS[mime], `formato nuevo sin extensión decidida: ${mime}`).toBeDefined();
      expect(extensionPara(mime), `extensión equivocada para ${mime}`).toBe(ESPERADAS[mime]);
    }
  });

  it('tolera mayúsculas y espacios', () => {
    expect(extensionPara(' VIDEO/MP4 ')).toBe('mp4');
  });

  it('ante un mimetype desconocido cae a jpg', () => {
    expect(extensionPara('application/octet-stream')).toBe('jpg');
  });
});
