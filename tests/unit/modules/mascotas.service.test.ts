import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import * as repo from '../../../src/modules/mascotas/mascotas.repository';
import * as service from '../../../src/modules/mascotas/mascotas.service';
import { borrarImagen, guardarImagen } from '../../../src/shared/storage';
import { registrarAuditoria } from '../../../src/shared/logAuditoria';
import type { CrearMascotaDto } from '../../../src/modules/mascotas/mascotas.dto';

vi.mock('../../../src/modules/mascotas/mascotas.repository');
vi.mock('../../../src/shared/storage');
vi.mock('../../../src/shared/logAuditoria');

const ESTADOS = {
  Disponible: { id: 1, nombre: 'Disponible' },
  En_Tratamiento: { id: 2, nombre: 'En_Tratamiento' },
  Adoptado: { id: 3, nombre: 'Adoptado' },
  En_Transito: { id: 5, nombre: 'En_Transito' },
} as const;

const ARCHIVO = { buffer: Buffer.from('foto'), mimetype: 'image/jpeg' };

const DATOS_ADOPTANTE: CrearMascotaDto = {
  actor: 'ADOPTANTE',
  destino: 'ADOPCION',
  nombre: 'Fido',
  fechaNacimiento: new Date(2022, 2, 15),
  genero: 'MACHO',
  peso: 12.5,
  tamanio: 'MEDIANO',
  especieId: 1,
  razaId: 2,
};

/** Arma lo que devolvería el repository tras crear, con el estado pedido. */
function mascotaCreada(estado: { id: number; nombre: string }, refugioId: number | null = null) {
  return {
    id: 10,
    nombre: 'Fido',
    fechaNacimiento: new Date(2022, 2, 15),
    genero: 'MACHO',
    peso: 12.5,
    tamanio: 'MEDIANO',
    imagenUrl: '/api/v1/archivos/mascotas/x.jpg',
    refugioId,
    usuarioId: 2,
    raza: { id: 2, nombre: 'Labrador', especie: { id: 1, nombre: 'Perro' } },
    historicoEstados: [{ estadoMascota: estado }],
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(repo.buscarUsuario).mockResolvedValue({
    id: 2,
    verificado: true,
    refugioId: null,
  } as never);
  vi.mocked(repo.buscarRaza).mockResolvedValue({
    id: 2,
    especieId: 1,
    nombre: 'Labrador',
  } as never);
  vi.mocked(guardarImagen).mockResolvedValue('/api/v1/archivos/mascotas/x.jpg');
});

/** Fila cruda de Mascota tal como la devuelve buscarPorId, sin relaciones. */
const MASCOTA_GUARDADA = {
  id: 10,
  usuarioId: 2,
  imagenUrl: '/api/v1/archivos/mascotas/vieja.jpg',
};

/** Solicitud con su estado vigente, en la forma que devuelve el repository. */
function solicitudEn(nombreEstado: string) {
  return { id: 1, historicoEstados: [{ estadoSolicitud: { id: 1, nombre: nombreEstado } }] };
}

describe('crearMascota — foto', () => {
  it('rechaza el alta si no vino una foto', async () => {
    await expect(service.crearMascota(DATOS_ADOPTANTE, { usuarioId: 2 })).rejects.toMatchObject({
      codigo: 'FOTO_REQUERIDA',
      mensaje: 'Debe agregar al menos una foto de la mascota',
    });
  });

  it('no guarda la imagen si la validación falla antes', async () => {
    await service.crearMascota(DATOS_ADOPTANTE, { usuarioId: 2 }).catch(() => undefined);

    expect(guardarImagen).not.toHaveBeenCalled();
  });

  it('borra la imagen si la escritura en base falla', async () => {
    vi.mocked(repo.buscarEstadoMascotaPorNombre).mockResolvedValue(ESTADOS.Disponible as never);
    vi.mocked(repo.crearConEstado).mockRejectedValue(new Error('base caída'));

    await expect(
      service.crearMascota(DATOS_ADOPTANTE, { usuarioId: 2, archivo: ARCHIVO }),
    ).rejects.toThrow('base caída');

    expect(borrarImagen).toHaveBeenCalledWith('/api/v1/archivos/mascotas/x.jpg');
  });
});

describe('crearMascota — usuario', () => {
  it('rechaza a un usuario sin verificar', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({ id: 2, verificado: false } as never);

    await expect(
      service.crearMascota(DATOS_ADOPTANTE, { usuarioId: 2, archivo: ARCHIVO }),
    ).rejects.toMatchObject({ codigo: 'USUARIO_NO_VERIFICADO' });
  });

  it('rechaza a un usuario inexistente', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue(null as never);

    await expect(
      service.crearMascota(DATOS_ADOPTANTE, { usuarioId: 99, archivo: ARCHIVO }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('crearMascota — especie y raza', () => {
  it('rechaza una raza que no pertenece a la especie elegida', async () => {
    vi.mocked(repo.buscarRaza).mockResolvedValue({ id: 2, especieId: 9 } as never);

    await expect(
      service.crearMascota(DATOS_ADOPTANTE, { usuarioId: 2, archivo: ARCHIVO }),
    ).rejects.toMatchObject({ mensaje: 'La raza no corresponde a la especie elegida' });
  });

  it('rechaza una raza inexistente', async () => {
    vi.mocked(repo.buscarRaza).mockResolvedValue(null as never);

    await expect(
      service.crearMascota(DATOS_ADOPTANTE, { usuarioId: 2, archivo: ARCHIVO }),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });
});

describe('crearMascota — estado inicial del adoptante', () => {
  it('una mascota ofrecida en adopción nace Disponible y permite publicar', async () => {
    vi.mocked(repo.buscarEstadoMascotaPorNombre).mockResolvedValue(ESTADOS.Disponible as never);
    vi.mocked(repo.crearConEstado).mockResolvedValue(mascotaCreada(ESTADOS.Disponible) as never);

    const creada = await service.crearMascota(DATOS_ADOPTANTE, {
      usuarioId: 2,
      archivo: ARCHIVO,
    });

    expect(repo.buscarEstadoMascotaPorNombre).toHaveBeenCalledWith('Disponible');
    expect(creada.habilitaPublicacion).toBe(true);
  });

  it('una mascota propia nace Adoptado y no permite publicar', async () => {
    vi.mocked(repo.buscarEstadoMascotaPorNombre).mockResolvedValue(ESTADOS.Adoptado as never);
    vi.mocked(repo.crearConEstado).mockResolvedValue(mascotaCreada(ESTADOS.Adoptado) as never);

    const creada = await service.crearMascota(
      { ...DATOS_ADOPTANTE, destino: 'PROPIA' },
      { usuarioId: 2, archivo: ARCHIVO },
    );

    expect(repo.buscarEstadoMascotaPorNombre).toHaveBeenCalledWith('Adoptado');
    expect(creada.habilitaPublicacion).toBe(false);
  });

  it('un adoptante no queda asociado a ningún refugio', async () => {
    vi.mocked(repo.buscarEstadoMascotaPorNombre).mockResolvedValue(ESTADOS.Disponible as never);
    vi.mocked(repo.crearConEstado).mockResolvedValue(mascotaCreada(ESTADOS.Disponible) as never);

    await service.crearMascota(DATOS_ADOPTANTE, { usuarioId: 2, archivo: ARCHIVO });

    expect(vi.mocked(repo.crearConEstado).mock.calls[0]![0].refugioId).toBeNull();
  });
});

describe('crearMascota — estado elegido por el refugio', () => {
  const datosRefugio: CrearMascotaDto = {
    actor: 'REFUGIO',
    estadoMascotaId: 2,
    nombre: 'Rocky',
    fechaNacimiento: new Date(2021, 5, 10),
    genero: 'MACHO',
    peso: 25.7,
    tamanio: 'GRANDE',
    especieId: 1,
    razaId: 2,
  };

  beforeEach(() => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({
      id: 3,
      verificado: true,
      refugioId: 1,
    } as never);
  });

  it('En tratamiento no habilita la publicación', async () => {
    vi.mocked(repo.buscarEstadoMascota).mockResolvedValue(ESTADOS.En_Tratamiento as never);
    vi.mocked(repo.crearConEstado).mockResolvedValue(
      mascotaCreada(ESTADOS.En_Tratamiento, 1) as never,
    );

    const creada = await service.crearMascota(datosRefugio, { usuarioId: 3, archivo: ARCHIVO });

    expect(creada.habilitaPublicacion).toBe(false);
  });

  it('En tránsito sí habilita la publicación', async () => {
    vi.mocked(repo.buscarEstadoMascota).mockResolvedValue(ESTADOS.En_Transito as never);
    vi.mocked(repo.crearConEstado).mockResolvedValue(
      mascotaCreada(ESTADOS.En_Transito, 1) as never,
    );

    const creada = await service.crearMascota(
      { ...datosRefugio, estadoMascotaId: 5 },
      { usuarioId: 3, archivo: ARCHIVO },
    );

    expect(creada.habilitaPublicacion).toBe(true);
  });

  it('rechaza un estado que no es un punto de partida válido', async () => {
    vi.mocked(repo.buscarEstadoMascota).mockResolvedValue(ESTADOS.Adoptado as never);

    await expect(
      service.crearMascota(
        { ...datosRefugio, estadoMascotaId: 3 },
        { usuarioId: 3, archivo: ARCHIVO },
      ),
    ).rejects.toMatchObject({ mensaje: 'Ese estado no es válido al crear una mascota' });
  });

  it('la mascota queda asociada al refugio del usuario', async () => {
    vi.mocked(repo.buscarEstadoMascota).mockResolvedValue(ESTADOS.En_Tratamiento as never);
    vi.mocked(repo.crearConEstado).mockResolvedValue(
      mascotaCreada(ESTADOS.En_Tratamiento, 1) as never,
    );

    await service.crearMascota(datosRefugio, { usuarioId: 3, archivo: ARCHIVO });

    expect(vi.mocked(repo.crearConEstado).mock.calls[0]![0].refugioId).toBe(1);
  });

  it('rechaza a un usuario de rol refugio que no tiene refugio asociado', async () => {
    vi.mocked(repo.buscarUsuario).mockResolvedValue({
      id: 3,
      verificado: true,
      refugioId: null,
    } as never);
    vi.mocked(repo.buscarEstadoMascota).mockResolvedValue(ESTADOS.En_Tratamiento as never);

    await expect(
      service.crearMascota(datosRefugio, { usuarioId: 3, archivo: ARCHIVO }),
    ).rejects.toMatchObject({ codigo: 'SIN_REFUGIO' });
  });
});

describe('editarMascota — propiedad (HU-6.2)', () => {
  it('404 si la mascota no existe', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(null as never);

    await expect(
      service.editarMascota(10, { nombre: 'Fido II' }, { usuarioId: 2 }),
    ).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO', httpStatus: 404 });
  });

  it('403 si la mascota es de otro usuario', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue({ ...MASCOTA_GUARDADA, usuarioId: 99 } as never);

    await expect(
      service.editarMascota(10, { nombre: 'Fido II' }, { usuarioId: 2 }),
    ).rejects.toMatchObject({ codigo: 'NO_AUTORIZADO', httpStatus: 403 });
  });

  it('no escribe nada si el dueño no coincide', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue({ ...MASCOTA_GUARDADA, usuarioId: 99 } as never);

    await service.editarMascota(10, { nombre: 'Fido II' }, { usuarioId: 2 }).catch(() => undefined);

    expect(repo.actualizar).not.toHaveBeenCalled();
  });
});

describe('editarMascota — edición parcial', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(MASCOTA_GUARDADA as never);
    vi.mocked(repo.actualizar).mockResolvedValue(mascotaCreada(ESTADOS.Disponible) as never);
  });

  it('rechaza un PATCH sin ningún cambio', async () => {
    await expect(service.editarMascota(10, {}, { usuarioId: 2 })).rejects.toMatchObject({
      codigo: 'VALIDACION',
      httpStatus: 400,
    });
  });

  it('deja en undefined los campos que no llegaron, para que Prisma no los toque', async () => {
    await service.editarMascota(10, { nombre: 'Fido II' }, { usuarioId: 2 });

    const escrito = vi.mocked(repo.actualizar).mock.calls[0]![1];

    expect(escrito.nombre).toBe('Fido II');
    expect(escrito.peso).toBeUndefined();
    expect(escrito.genero).toBeUndefined();
    expect(escrito.imagenUrl).toBeUndefined();
  });

  it('no apaga la castración cuando el campo no vino', async () => {
    await service.editarMascota(10, { nombre: 'Fido II' }, { usuarioId: 2 });

    expect(vi.mocked(repo.actualizar).mock.calls[0]![1].castrado).toBeUndefined();
  });

  it('una descripción en null sí limpia la columna', async () => {
    await service.editarMascota(10, { descripcion: null }, { usuarioId: 2 });

    expect(vi.mocked(repo.actualizar).mock.calls[0]![1].descripcion).toBeNull();
  });

  it('revalida la raza contra la especie cuando se cambia', async () => {
    vi.mocked(repo.buscarRaza).mockResolvedValue({ id: 7, especieId: 9 } as never);

    await expect(
      service.editarMascota(10, { razaId: 7, especieId: 1 }, { usuarioId: 2 }),
    ).rejects.toMatchObject({ mensaje: 'La raza no corresponde a la especie elegida' });
  });

  it('registra en auditoría que la mascota se editó', async () => {
    await service.editarMascota(10, { nombre: 'Fido II', peso: 13 }, { usuarioId: 2 });

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'EDITAR', entidad: 'Mascota', entidadId: 10 }),
    );
  });
});

describe('editarMascota — reemplazo de foto', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(MASCOTA_GUARDADA as never);
    vi.mocked(repo.actualizar).mockResolvedValue(mascotaCreada(ESTADOS.Disponible) as never);
    vi.mocked(guardarImagen).mockResolvedValue('/api/v1/archivos/mascotas/nueva.jpg');
  });

  it('borra la foto nueva si la escritura en base falla', async () => {
    vi.mocked(repo.actualizar).mockRejectedValue(new Error('base caída'));

    await expect(service.editarMascota(10, {}, { usuarioId: 2, archivo: ARCHIVO })).rejects.toThrow(
      'base caída',
    );

    expect(borrarImagen).toHaveBeenCalledWith('/api/v1/archivos/mascotas/nueva.jpg');
  });

  it('borra la foto vieja si ninguna publicación la usa', async () => {
    vi.mocked(repo.existePublicacionQueUsaImagen).mockResolvedValue(null as never);

    await service.editarMascota(10, {}, { usuarioId: 2, archivo: ARCHIVO });

    expect(borrarImagen).toHaveBeenCalledWith('/api/v1/archivos/mascotas/vieja.jpg');
  });

  it('conserva la foto vieja si una publicación la sigue apuntando', async () => {
    vi.mocked(repo.existePublicacionQueUsaImagen).mockResolvedValue({ id: 3 } as never);

    await service.editarMascota(10, {}, { usuarioId: 2, archivo: ARCHIVO });

    expect(borrarImagen).not.toHaveBeenCalled();
  });

  it('una foto sola ya es un cambio válido, sin ningún campo de texto', async () => {
    vi.mocked(repo.existePublicacionQueUsaImagen).mockResolvedValue(null as never);

    const editada = await service.editarMascota(10, {}, { usuarioId: 2, archivo: ARCHIVO });

    expect(editada.id).toBe(10);
    expect(vi.mocked(repo.actualizar).mock.calls[0]![1].imagenUrl).toBe(
      '/api/v1/archivos/mascotas/nueva.jpg',
    );
  });
});

describe('eliminarMascota — baja lógica (HU-6.3)', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(MASCOTA_GUARDADA as never);
    vi.mocked(repo.listarSolicitudesDeMascota).mockResolvedValue([] as never);
    vi.mocked(repo.darDeBajaConPublicaciones).mockResolvedValue(1 as never);
  });

  it('404 si la mascota no existe', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(null as never);

    await expect(service.eliminarMascota(10, 2)).rejects.toMatchObject({
      codigo: 'NO_ENCONTRADO',
      httpStatus: 404,
    });
  });

  it('403 si la mascota es de otro usuario', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue({ ...MASCOTA_GUARDADA, usuarioId: 99 } as never);

    await expect(service.eliminarMascota(10, 2)).rejects.toMatchObject({
      codigo: 'NO_AUTORIZADO',
      httpStatus: 403,
    });
  });

  it('da de baja la mascota y arrastra sus publicaciones activas', async () => {
    const resultado = await service.eliminarMascota(10, 2);

    expect(repo.darDeBajaConPublicaciones).toHaveBeenCalledWith(10, 2);
    expect(resultado).toEqual({ id: 10, publicacionesDadasDeBaja: 1 });
  });

  it('409 si hay una solicitud pendiente de otro usuario', async () => {
    vi.mocked(repo.listarSolicitudesDeMascota).mockResolvedValue([
      solicitudEn('Pendiente'),
    ] as never);

    await expect(service.eliminarMascota(10, 2)).rejects.toMatchObject({
      codigo: 'SOLICITUDES_ABIERTAS',
      httpStatus: 409,
    });
  });

  it('409 también si la solicitud está en revisión', async () => {
    vi.mocked(repo.listarSolicitudesDeMascota).mockResolvedValue([
      solicitudEn('En_Revision'),
    ] as never);

    await expect(service.eliminarMascota(10, 2)).rejects.toMatchObject({
      codigo: 'SOLICITUDES_ABIERTAS',
    });
  });

  it('no da de baja nada si las solicitudes bloquean', async () => {
    vi.mocked(repo.listarSolicitudesDeMascota).mockResolvedValue([
      solicitudEn('Pendiente'),
    ] as never);

    await service.eliminarMascota(10, 2).catch(() => undefined);

    expect(repo.darDeBajaConPublicaciones).not.toHaveBeenCalled();
  });

  it('las solicitudes ya resueltas no frenan la baja', async () => {
    vi.mocked(repo.listarSolicitudesDeMascota).mockResolvedValue([
      solicitudEn('Rechazada'),
      solicitudEn('Aprobada'),
    ] as never);

    await expect(service.eliminarMascota(10, 2)).resolves.toMatchObject({ id: 10 });
  });
});
