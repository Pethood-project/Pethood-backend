/**
 * Tarjetas que manda una persona en la sala (2026-10-12): compartir una mascota y mandar la
 * ubicación del refugio. El resto de la sala se testea en `chats.mensajes.service.test.ts`.
 *
 * Mismo criterio de mocks: repository, storage y emisor, para testear el service sin base,
 * sin disco y sin servidor de sockets.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../../../src/modules/chats/chats.repository';
import * as service from '../../../src/modules/chats/chats.service';
import * as emisor from '../../../src/websockets/emisor';

vi.mock('../../../src/modules/chats/chats.repository');
vi.mock('../../../src/shared/storage');
vi.mock('../../../src/websockets/emisor');
vi.mock('../../../src/websockets/presencia');

const USUARIO = 7;
const OTRO = 41;
const REFUGIO = 3;
const CHAT = 8;
const MASCOTA = 5;

const FECHA = new Date('2026-10-12T14:05:00.000Z');

/** La sala como sale de `buscarSalaConContacto`: con un refugio de contraparte o entre personas. */
function sala(opciones: { conRefugio?: boolean; contactoDeBaja?: boolean } = {}) {
  const { conRefugio = false, contactoDeBaja = false } = opciones;

  return {
    id: 100,
    chatId: CHAT,
    usuarioId: USUARIO,
    chat: {
      id: CHAT,
      fechaAlta: FECHA,
      solicitudId: null,
      refugio: conRefugio
        ? {
            id: REFUGIO,
            nombre: 'Huellitas del Sur',
            imagenUrl: '/api/v1/archivos/refugios/huellitas.jpg',
            fechaBaja: null,
          }
        : null,
      participantes: [
        {
          usuarioId: OTRO,
          usuario: {
            id: OTRO,
            nombre: 'Ana',
            apellido: 'Pérez',
            imagenUrl: null,
            fechaBaja: contactoDeBaja ? FECHA : null,
          },
        },
      ],
    },
  };
}

/** La mascota como sale de `buscarMascotaParaChat`. */
function mascota(opciones: { conPublicacion?: boolean; eliminada?: boolean } = {}) {
  const { conPublicacion = true, eliminada = false } = opciones;

  return {
    id: MASCOTA,
    nombre: 'Greta',
    // En hora local, como las guarda la app (`parsearFecha`) y las formatea `aFechaISO`.
    fechaNacimiento: new Date(2023, 3, 10),
    genero: 'HEMBRA' as const,
    tamanio: 'MEDIANO' as const,
    imagenUrl: '/api/v1/archivos/mascotas/greta.jpg',
    fechaBaja: eliminada ? FECHA : null,
    raza: { nombre: 'Mestiza', especie: { nombre: 'Perro' } },
    historicoEstados: [{ estadoMascota: { nombre: 'Disponible' } }],
    publicaciones: conPublicacion
      ? [{ id: 90, imagenUrl: '/api/v1/archivos/publicaciones/greta.jpg' }]
      : [],
  };
}

/** El mensaje recién creado, como lo devuelve `crearMensaje`. */
function tarjeta(tipo: 'MASCOTA' | 'UBICACION_REFUGIO', mascotaId: number | null = null) {
  return {
    id: 60,
    chatId: CHAT,
    contenido: '',
    imagenUrl: null,
    imagenes: [],
    tipo,
    solicitudId: null,
    animalPerdidoId: null,
    mascotaId,
    usuarioId: USUARIO,
    fechaAlta: FECHA,
    fechaBaja: null,
    mensajeRespondido: null,
  };
}

/** El refugio como sale de `buscarRefugioParaUbicacion`. */
function refugioConUbicacion(opciones: { sinDireccion?: boolean; sinMapa?: boolean } = {}) {
  return {
    id: REFUGIO,
    nombre: 'Huellitas del Sur',
    imagenUrl: '/api/v1/archivos/refugios/huellitas.jpg',
    calleAltura: opciones.sinDireccion ? null : 'San Martín 1200',
    localidad: opciones.sinDireccion ? null : 'Godoy Cruz',
    provincia: opciones.sinDireccion ? null : 'Mendoza',
    mapaUrl: opciones.sinMapa ? null : 'https://maps.app.goo.gl/huellitas',
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(repo.buscarMembresiaActiva).mockResolvedValue({ id: 100 } as never);
  vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(sala() as never);
  vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: null } as never);
  vi.mocked(repo.listarMensajes).mockResolvedValue([] as never);
  vi.mocked(repo.marcasDeParticipantes).mockResolvedValue([] as never);
});

describe('listarMascotasCompartibles', () => {
  it('con un refugio, pide los favoritos que son de ESE refugio', async () => {
    vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(sala({ conRefugio: true }) as never);
    vi.mocked(repo.listarMascotasCompartibles).mockResolvedValue([] as never);

    await service.listarMascotasCompartibles(USUARIO, CHAT);

    expect(repo.listarMascotasCompartibles).toHaveBeenCalledWith(USUARIO, { refugioId: REFUGIO });
  });

  it('con una persona, pide los favoritos que son personales de esa persona', async () => {
    vi.mocked(repo.listarMascotasCompartibles).mockResolvedValue([] as never);

    await service.listarMascotasCompartibles(USUARIO, CHAT);

    expect(repo.listarMascotasCompartibles).toHaveBeenCalledWith(USUARIO, { usuarioId: OTRO });
  });

  it('cada mascota viene lista para pintar: la foto de la publicación y el día de nacimiento', async () => {
    vi.mocked(repo.listarMascotasCompartibles).mockResolvedValue([{ mascota: mascota() }] as never);

    const { mascotas } = await service.listarMascotasCompartibles(USUARIO, CHAT);

    expect(mascotas).toEqual([
      {
        id: MASCOTA,
        nombre: 'Greta',
        especie: 'Perro',
        raza: 'Mestiza',
        genero: 'HEMBRA',
        tamanio: 'MEDIANO',
        fechaNacimiento: '2023-04-10',
        imagenUrl: '/api/v1/archivos/publicaciones/greta.jpg',
        estado: 'Disponible',
        publicacionId: 90,
      },
    ]);
  });

  it('exige ser participante de la sala', async () => {
    vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(null);

    await expect(service.listarMascotasCompartibles(USUARIO, CHAT)).rejects.toMatchObject({
      codigo: 'SIN_ACCESO_AL_CHAT',
    });
    expect(repo.listarMascotasCompartibles).not.toHaveBeenCalled();
  });
});

describe('compartirMascota', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarFavoritoCompartible).mockResolvedValue({ id: 1 } as never);
    vi.mocked(repo.buscarMascotaParaChat).mockResolvedValue(mascota() as never);
    vi.mocked(repo.crearMensaje).mockResolvedValue(tarjeta('MASCOTA', MASCOTA) as never);
  });

  it('deja la tarjeta de la mascota, a nombre de quien la comparte', async () => {
    const dto = await service.compartirMascota(USUARIO, CHAT, MASCOTA);

    expect(repo.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: USUARIO,
        tipo: 'MASCOTA',
        mascotaId: MASCOTA,
        contenido: '',
      }),
    );
    expect(dto.tipo).toBe('MASCOTA');
    expect(dto.mascota).toMatchObject({ id: MASCOTA, nombre: 'Greta', publicacionId: 90 });
  });

  it('vuelve a verificar la regla: tiene que ser favorita y de la contraparte', async () => {
    await service.compartirMascota(USUARIO, CHAT, MASCOTA);

    expect(repo.buscarFavoritoCompartible).toHaveBeenCalledWith(USUARIO, MASCOTA, {
      usuarioId: OTRO,
    });
  });

  it('una mascota que no cumple la regla se rechaza sin dejar nada', async () => {
    vi.mocked(repo.buscarFavoritoCompartible).mockResolvedValue(null);

    await expect(service.compartirMascota(USUARIO, CHAT, MASCOTA)).rejects.toMatchObject({
      codigo: 'MASCOTA_NO_COMPARTIBLE',
      httpStatus: 409,
    });
    expect(repo.crearMensaje).not.toHaveBeenCalled();
    expect(emisor.emitirMensajeNuevo).not.toHaveBeenCalled();
  });

  it('no se le puede compartir nada a un contacto dado de baja', async () => {
    vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(
      sala({ contactoDeBaja: true }) as never,
    );

    await expect(service.compartirMascota(USUARIO, CHAT, MASCOTA)).rejects.toMatchObject({
      codigo: 'CONTACTO_INACTIVO',
    });
    expect(repo.crearMensaje).not.toHaveBeenCalled();
  });

  it('emite la tarjeta a todos los participantes, incluido quien la comparte', async () => {
    await service.compartirMascota(USUARIO, CHAT, MASCOTA);

    expect(emisor.emitirMensajeNuevo).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'MASCOTA' }),
      expect.arrayContaining([USUARIO, OTRO]),
    );
  });

  it('sin publicación activa, la tarjeta no tiene a dónde llevar', async () => {
    vi.mocked(repo.buscarMascotaParaChat).mockResolvedValue(
      mascota({ conPublicacion: false }) as never,
    );

    const dto = await service.compartirMascota(USUARIO, CHAT, MASCOTA);

    expect(dto.mascota?.publicacionId).toBeNull();
    // Sin foto de publicación, queda la de la mascota.
    expect(dto.mascota?.imagenUrl).toBe('/api/v1/archivos/mascotas/greta.jpg');
  });
});

describe('compartir una mascota desde el refugio', () => {
  beforeEach(() => {
    // Quien comparte es del refugio de la sala; del otro lado está la adoptante.
    vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(sala({ conRefugio: true }) as never);
    vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: REFUGIO } as never);
    vi.mocked(repo.buscarMascotaPublicadaDeRefugio).mockResolvedValue({ id: MASCOTA } as never);
    vi.mocked(repo.buscarMascotaParaChat).mockResolvedValue(mascota() as never);
    vi.mocked(repo.crearMensaje).mockResolvedValue(tarjeta('MASCOTA', MASCOTA) as never);
  });

  it('la lista son las mascotas publicadas del refugio, no favoritos', async () => {
    vi.mocked(repo.listarMascotasPublicadasDeRefugio).mockResolvedValue([mascota()] as never);

    const { mascotas } = await service.listarMascotasCompartibles(USUARIO, CHAT);

    expect(repo.listarMascotasPublicadasDeRefugio).toHaveBeenCalledWith(REFUGIO);
    expect(repo.listarMascotasCompartibles).not.toHaveBeenCalled();
    expect(mascotas.map((m) => m.id)).toEqual([MASCOTA]);
  });

  it('comparte una mascota propia publicada', async () => {
    const dto = await service.compartirMascota(USUARIO, CHAT, MASCOTA);

    expect(repo.buscarMascotaPublicadaDeRefugio).toHaveBeenCalledWith(REFUGIO, MASCOTA);
    expect(repo.buscarFavoritoCompartible).not.toHaveBeenCalled();
    expect(dto.mascota).toMatchObject({ id: MASCOTA });
  });

  it('una mascota que no es suya, o que no está publicada, se rechaza', async () => {
    vi.mocked(repo.buscarMascotaPublicadaDeRefugio).mockResolvedValue(null);

    await expect(service.compartirMascota(USUARIO, CHAT, MASCOTA)).rejects.toMatchObject({
      codigo: 'MASCOTA_NO_COMPARTIBLE',
      mensaje: 'Sólo podés compartir mascotas publicadas de tu refugio',
    });
    expect(repo.crearMensaje).not.toHaveBeenCalled();
  });

  it('alguien de OTRO refugio que escribe como adoptante sigue la regla de favoritos', async () => {
    vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: 99 } as never);
    vi.mocked(repo.buscarFavoritoCompartible).mockResolvedValue({ id: 1 } as never);

    await service.compartirMascota(USUARIO, CHAT, MASCOTA);

    expect(repo.buscarFavoritoCompartible).toHaveBeenCalledWith(USUARIO, MASCOTA, {
      refugioId: REFUGIO,
    });
    expect(repo.buscarMascotaPublicadaDeRefugio).not.toHaveBeenCalled();
  });
});

describe('ubicación del refugio', () => {
  beforeEach(() => {
    // Quien pregunta es del refugio de la sala; del otro lado está la adoptante.
    vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(sala({ conRefugio: true }) as never);
    vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: REFUGIO } as never);
    vi.mocked(repo.buscarRefugioDeChat).mockResolvedValue({ refugioId: REFUGIO } as never);
    vi.mocked(repo.buscarRefugioParaUbicacion).mockResolvedValue(refugioConUbicacion() as never);
    vi.mocked(repo.crearMensaje).mockResolvedValue(tarjeta('UBICACION_REFUGIO') as never);
  });

  it('el diálogo recibe la dirección armada y el link del perfil del refugio', async () => {
    await expect(service.obtenerUbicacionRefugio(USUARIO, CHAT)).resolves.toEqual({
      refugioId: REFUGIO,
      nombre: 'Huellitas del Sur',
      imagenUrl: '/api/v1/archivos/refugios/huellitas.jpg',
      ubicacion: 'San Martín 1200, Godoy Cruz - Mendoza',
      mapaUrl: 'https://maps.app.goo.gl/huellitas',
    });
  });

  it('mandarla deja la tarjeta con la ubicación resuelta', async () => {
    const dto = await service.enviarUbicacionRefugio(USUARIO, CHAT);

    expect(repo.crearMensaje).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'UBICACION_REFUGIO', usuarioId: USUARIO }),
    );
    expect(dto.ubicacion).toMatchObject({ refugioId: REFUGIO, mapaUrl: expect.any(String) });
  });

  it('alguien que no es del refugio de la sala no la puede mandar', async () => {
    vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: 99 } as never);

    await expect(service.enviarUbicacionRefugio(USUARIO, CHAT)).rejects.toMatchObject({
      codigo: 'SOLO_REFUGIO',
      httpStatus: 403,
    });
    expect(repo.crearMensaje).not.toHaveBeenCalled();
  });

  it('en una charla entre personas no hay refugio cuya ubicación mandar', async () => {
    vi.mocked(repo.buscarSalaConContacto).mockResolvedValue(sala() as never);

    await expect(service.obtenerUbicacionRefugio(USUARIO, CHAT)).rejects.toMatchObject({
      codigo: 'SOLO_REFUGIO',
    });
  });

  it('sin dirección ni link cargados, se explica cómo cargarla', async () => {
    vi.mocked(repo.buscarRefugioParaUbicacion).mockResolvedValue(
      refugioConUbicacion({ sinDireccion: true, sinMapa: true }) as never,
    );

    await expect(service.enviarUbicacionRefugio(USUARIO, CHAT)).rejects.toMatchObject({
      codigo: 'REFUGIO_SIN_UBICACION',
      httpStatus: 409,
    });
    expect(repo.crearMensaje).not.toHaveBeenCalled();
  });

  it('con sólo el link de Maps alcanza', async () => {
    vi.mocked(repo.buscarRefugioParaUbicacion).mockResolvedValue(
      refugioConUbicacion({ sinDireccion: true }) as never,
    );

    await expect(service.obtenerUbicacionRefugio(USUARIO, CHAT)).resolves.toMatchObject({
      ubicacion: null,
      mapaUrl: 'https://maps.app.goo.gl/huellitas',
    });
  });
});

describe('las tarjetas en el historial', () => {
  it('cada tarjeta trae su mascota, y la ubicación se resuelve una sola vez', async () => {
    vi.mocked(repo.listarMensajes).mockResolvedValue([
      { ...tarjeta('UBICACION_REFUGIO'), id: 62 },
      { ...tarjeta('UBICACION_REFUGIO'), id: 61 },
      tarjeta('MASCOTA', MASCOTA),
    ] as never);
    vi.mocked(repo.buscarMascotaParaChat).mockResolvedValue(mascota() as never);
    vi.mocked(repo.buscarRefugioDeChat).mockResolvedValue({ refugioId: REFUGIO } as never);
    vi.mocked(repo.buscarRefugioParaUbicacion).mockResolvedValue(refugioConUbicacion() as never);

    const { mensajes } = await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    expect(mensajes.map((m) => m.ubicacion?.refugioId ?? null)).toEqual([REFUGIO, REFUGIO, null]);
    expect(mensajes[2]?.mascota?.nombre).toBe('Greta');
    expect(repo.buscarRefugioParaUbicacion).toHaveBeenCalledTimes(1);
  });

  it('una tarjeta eliminada viaja como el aviso, sin carga y sin consultar nada', async () => {
    vi.mocked(repo.listarMensajes).mockResolvedValue([
      { ...tarjeta('MASCOTA', MASCOTA), fechaBaja: FECHA },
    ] as never);

    const { mensajes } = await service.listarHistorial(USUARIO, CHAT, { limite: 30 });

    expect(mensajes[0]).toMatchObject({ eliminado: true, mascota: null });
    expect(repo.buscarMascotaParaChat).not.toHaveBeenCalled();
  });
});

describe('eliminar una tarjeta propia', () => {
  it('su autor la puede eliminar, como a un texto', async () => {
    vi.mocked(repo.buscarMensajeDeChat).mockResolvedValue({
      id: 60,
      usuarioId: USUARIO,
      tipo: 'MASCOTA',
      fechaBaja: null,
    });

    await service.eliminarMensaje(USUARIO, CHAT, 60);

    expect(repo.darDeBajaMensaje).toHaveBeenCalledWith(60, USUARIO);
  });
});
