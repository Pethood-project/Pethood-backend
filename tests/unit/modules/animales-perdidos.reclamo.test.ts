import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/animales-perdidos/animales-perdidos.repository', () => ({
  buscarParaReclamo: vi.fn(),
  buscarEstadoPorNombre: vi.fn(),
  marcarResuelto: vi.fn(),
}));
vi.mock('../../../src/modules/chats/chats.service', () => ({
  asegurarChatDeReclamo: vi.fn(),
}));
vi.mock('../../../src/shared/logAuditoria', () => ({
  registrarAuditoria: vi.fn().mockResolvedValue(undefined),
}));

import * as repo from '../../../src/modules/animales-perdidos/animales-perdidos.repository';
import {
  marcarResuelto,
  reclamarAviso,
} from '../../../src/modules/animales-perdidos/animales-perdidos.service';
import * as chats from '../../../src/modules/chats/chats.service';

const mockedRepo = vi.mocked(repo);
const mockedChats = vi.mocked(chats);

beforeEach(() => vi.resetAllMocks());

async function codigo(promesa: Promise<unknown>): Promise<string> {
  try {
    await promesa;
  } catch (err) {
    return (err as { codigo: string }).codigo;
  }
  return 'SIN_ERROR';
}

/** Un aviso abierto de la persona 3, que es la que lo publicó. */
function avisoAbierto(extra: Record<string, unknown> = {}) {
  return {
    id: 7,
    nombre: 'Michi',
    fechaBaja: null,
    usuarioReportanteId: 3,
    estadoAnimalPerdido: { id: 1, nombre: 'Perdido' },
    usuarioReportante: { id: 3, fechaBaja: null },
    ...extra,
  } as never;
}

describe('reclamarAviso', () => {
  it('abre la sala de reencuentro con quien publicó el aviso', async () => {
    mockedRepo.buscarParaReclamo.mockResolvedValue(avisoAbierto());
    mockedChats.asegurarChatDeReclamo.mockResolvedValue({ chatId: 42, nueva: true });

    expect(await reclamarAviso(7, 9)).toEqual({ chatId: 42, nueva: true });
    // El reportante va como tercer argumento: es la contraparte de la sala.
    expect(mockedChats.asegurarChatDeReclamo).toHaveBeenCalledWith(7, 9, 3);
  });

  it('es idempotente: el segundo reclamo devuelve la misma sala y avisa que no es nueva', async () => {
    mockedRepo.buscarParaReclamo.mockResolvedValue(avisoAbierto());
    mockedChats.asegurarChatDeReclamo.mockResolvedValue({ chatId: 42, nueva: false });

    expect(await reclamarAviso(7, 9)).toEqual({ chatId: 42, nueva: false });
  });

  it('no deja reclamar el aviso propio', async () => {
    mockedRepo.buscarParaReclamo.mockResolvedValue(avisoAbierto());

    expect(await codigo(reclamarAviso(7, 3))).toBe('RECLAMO_PROPIO');
    expect(mockedChats.asegurarChatDeReclamo).not.toHaveBeenCalled();
  });

  it('no deja reclamar un caso ya resuelto', async () => {
    mockedRepo.buscarParaReclamo.mockResolvedValue(
      avisoAbierto({ estadoAnimalPerdido: { id: 3, nombre: 'Resuelto' } }),
    );

    expect(await codigo(reclamarAviso(7, 9))).toBe('AVISO_RESUELTO');
    expect(mockedChats.asegurarChatDeReclamo).not.toHaveBeenCalled();
  });

  it('no abre una sala contra una cuenta dada de baja', async () => {
    mockedRepo.buscarParaReclamo.mockResolvedValue(
      avisoAbierto({ usuarioReportante: { id: 3, fechaBaja: new Date() } }),
    );

    expect(await codigo(reclamarAviso(7, 9))).toBe('REPORTANTE_INACTIVO');
    expect(mockedChats.asegurarChatDeReclamo).not.toHaveBeenCalled();
  });

  it('trata un aviso dado de baja como inexistente', async () => {
    mockedRepo.buscarParaReclamo.mockResolvedValue(avisoAbierto({ fechaBaja: new Date() }));

    expect(await codigo(reclamarAviso(7, 9))).toBe('NO_ENCONTRADO');
  });

  it('responde NO_ENCONTRADO si el aviso no existe', async () => {
    mockedRepo.buscarParaReclamo.mockResolvedValue(null);

    expect(await codigo(reclamarAviso(7, 9))).toBe('NO_ENCONTRADO');
  });
});

describe('marcarResuelto', () => {
  it('cierra el caso y devuelve el aviso resuelto', async () => {
    mockedRepo.buscarParaReclamo.mockResolvedValue(avisoAbierto());
    mockedRepo.buscarEstadoPorNombre.mockResolvedValue({ id: 3, nombre: 'Resuelto' });
    mockedRepo.marcarResuelto.mockResolvedValue({
      id: 7,
      nombre: 'Michi',
      descripcion: 'Gato gris',
      imagenUrl: 'a.jpg',
      imagenes: ['a.jpg'],
      provincia: 'Mendoza',
      localidad: 'Godoy Cruz',
      referencia: null,
      lugarLatitud: null,
      lugarLongitud: null,
      fechaSuceso: null,
      fechaAlta: new Date('2026-09-01T10:00:00Z'),
      fechaResuelto: new Date('2026-10-01T10:00:00Z'),
      usuarioReportanteId: 3,
      estadoAnimalPerdido: { id: 3, nombre: 'Resuelto' },
      especie: { id: 1, nombre: 'Gato' },
      usuarioReportante: { id: 3, nombre: 'Ana', apellido: 'Paz', imagenUrl: null },
    } as never);

    const aviso = await marcarResuelto(7, 3);

    expect(aviso.estado.nombre).toBe('Resuelto');
    expect(aviso.fechaResuelto).not.toBeNull();
  });

  it('sólo lo puede resolver quien publicó el aviso', async () => {
    mockedRepo.buscarParaReclamo.mockResolvedValue(avisoAbierto());

    expect(await codigo(marcarResuelto(7, 9))).toBe('SIN_PERMISO');
    expect(mockedRepo.marcarResuelto).not.toHaveBeenCalled();
  });

  it('no resuelve dos veces', async () => {
    mockedRepo.buscarParaReclamo.mockResolvedValue(
      avisoAbierto({ estadoAnimalPerdido: { id: 3, nombre: 'Resuelto' } }),
    );

    expect(await codigo(marcarResuelto(7, 3))).toBe('AVISO_RESUELTO');
    expect(mockedRepo.marcarResuelto).not.toHaveBeenCalled();
  });

  it('no toca las conversaciones del aviso', async () => {
    // Decisión del equipo del 2026-10-01: resolver cierra el CASO, no el chat. REQUISITOS §13
    // decía "y el chat asociado"; con la conversación compartida entre las dos personas,
    // cerrarla cortaría charlas que no tienen nada que ver con el aviso.
    mockedRepo.buscarParaReclamo.mockResolvedValue(avisoAbierto());
    mockedRepo.buscarEstadoPorNombre.mockResolvedValue({ id: 3, nombre: 'Resuelto' });
    mockedRepo.marcarResuelto.mockResolvedValue({
      id: 7,
      nombre: 'Michi',
      descripcion: 'Gato gris',
      imagenUrl: 'a.jpg',
      imagenes: ['a.jpg'],
      provincia: null,
      localidad: null,
      referencia: null,
      lugarLatitud: null,
      lugarLongitud: null,
      fechaSuceso: null,
      fechaAlta: new Date(),
      fechaResuelto: new Date(),
      usuarioReportanteId: 3,
      estadoAnimalPerdido: { id: 3, nombre: 'Resuelto' },
      especie: null,
      usuarioReportante: { id: 3, nombre: 'Ana', apellido: 'Paz', imagenUrl: null },
    } as never);

    await marcarResuelto(7, 3);

    // Resolver no pasa por el módulo de chat en absoluto: el estado del aviso es lo único que
    // cambia, y la conversación sigue aceptando mensajes.
    expect(mockedChats.asegurarChatDeReclamo).not.toHaveBeenCalled();
    expect(mockedRepo.marcarResuelto).toHaveBeenCalledWith({
      id: 7,
      estadoId: 3,
      usuarioId: 3,
    });
  });
});
