import { AppError } from '../../middlewares/errorHandler';
import { esMascotaPropia, type Ambito } from '../../shared/ambito';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { borrarImagenes, guardarImagenes } from '../../shared/storage';
import { aFechaISO } from '../../shared/validation/dates';
import { ESTADOS_QUE_HABILITAN_PUBLICACION } from '../catalogos/catalogos.service';
import type {
  CrearPublicacionDto,
  FeedPublicacionesDto,
  FiltrosFeedDto,
  PublicacionCreadaDto,
  PublicacionFeedDto,
} from './publicaciones.dto';
import * as repo from './publicaciones.repository';

const SUBCARPETA_FOTOS = 'publicaciones';

/** Tope anti-spam de publicaciones simultáneas para un adoptante particular. */
const MAXIMO_ACTIVAS_POR_ADOPTANTE = 5;

export interface ContextoCreacion {
  usuarioId: number;
  /** En el orden en que se subieron: la primera es la portada. */
  archivos: { buffer: Buffer; mimetype: string }[];
}

export async function crearPublicacion(
  datos: CrearPublicacionDto,
  contexto: ContextoCreacion,
): Promise<PublicacionCreadaDto> {
  const { usuarioId, archivos } = contexto;
  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  if (!usuario.verificado) {
    throw new AppError(
      'USUARIO_NO_VERIFICADO',
      'Necesitás verificar tu cuenta para poder publicar',
      403,
    );
  }

  const mascota = await repo.buscarMascota(datos.mascotaId);

  if (!mascota) throw new AppError('NO_ENCONTRADO', 'La mascota no existe', 404);
  if (mascota.usuarioId !== usuarioId) {
    throw new AppError('NO_AUTORIZADO', 'Esa mascota no es tuya', 403);
  }

  const estado = mascota.historicoEstados[0]?.estadoMascota;
  if (!estado || !ESTADOS_QUE_HABILITAN_PUBLICACION.includes(estado.nombre)) {
    throw new AppError(
      'ESTADO_NO_PUBLICABLE',
      'Con el estado actual de la mascota no se puede publicar en adopción',
      409,
    );
  }

  if (await repo.buscarActivaDeMascota(datos.mascotaId)) {
    throw new AppError('YA_PUBLICADA', 'Esa mascota ya tiene una publicación activa', 409);
  }

  // La quota aplica al adoptante particular, no al refugio.
  if (!usuario.refugioId) {
    const activas = await repo.contarActivasDeUsuario(usuarioId);

    if (activas >= MAXIMO_ACTIVAS_POR_ADOPTANTE) {
      throw new AppError(
        'LIMITE_DE_PUBLICACIONES',
        `Llegaste al máximo de ${MAXIMO_ACTIVAS_POR_ADOPTANTE} publicaciones activas`,
        409,
      );
    }
  }

  // Sin fotos propias se reutiliza la de la mascota, que ya es obligatoria en el alta.
  const imagenes =
    archivos.length > 0
      ? await guardarImagenes(archivos, SUBCARPETA_FOTOS)
      : [mascota.imagenUrl].filter((url): url is string => Boolean(url));

  let publicacion;
  try {
    publicacion = await repo.crear(
      {
        // El formulario no pide título: se toma el nombre de la mascota.
        titulo: mascota.nombre ?? 'Mascota en adopción',
        descripcion: datos.descripcion,
        ubicacion: datos.ubicacion,
        requisitos: datos.requisitos,
        personalidad: datos.personalidad,
        desparasitado: datos.desparasitado,
        vacunas: datos.vacunas,
        imagenes,
        mascotaId: mascota.id,
        usuarioId,
      },
      usuarioId,
    );
  } catch (err) {
    // No dejar fotos huérfanas si la escritura en base falló. Las de la mascota no se
    // tocan: son de otra entidad y siguen en uso.
    if (archivos.length > 0) await borrarImagenes(imagenes);
    throw err;
  }

  await registrarAuditoria({
    usuarioId,
    accion: 'CREAR',
    entidad: 'Publicacion',
    entidadId: publicacion.id,
    detalle: `mascota=${mascota.id}`,
  });

  return {
    id: publicacion.id,
    titulo: publicacion.titulo,
    descripcion: publicacion.descripcion,
    ubicacion: publicacion.ubicacion,
    requisitos: publicacion.requisitos,
    personalidad: publicacion.personalidad,
    desparasitado: publicacion.desparasitado,
    vacunas: publicacion.vacunas,
    imagenes: publicacion.imagenes,
    mascotaId: publicacion.mascotaId,
    usuarioId: publicacion.usuarioId,
  };
}

type PublicacionConRelaciones = NonNullable<Awaited<ReturnType<typeof repo.buscarActivaPorId>>>;

function aFeedDto(
  publicacion: PublicacionConRelaciones,
  enFavoritos: boolean,
  esPropia: boolean,
): PublicacionFeedDto {
  const { mascota } = publicacion;
  const estado = mascota.historicoEstados[0]!.estadoMascota;

  return {
    id: publicacion.id,
    titulo: publicacion.titulo,
    descripcion: publicacion.descripcion,
    ubicacion: publicacion.ubicacion,
    requisitos: publicacion.requisitos,
    personalidad: publicacion.personalidad,
    desparasitado: publicacion.desparasitado,
    vacunas: publicacion.vacunas,
    // Una publicación sin fotos propias reusa la de la mascota, que es obligatoria en el
    // alta: así la galería nunca queda vacía.
    imagenes:
      publicacion.imagenes.length > 0
        ? publicacion.imagenes
        : [mascota.imagenUrl].filter((url): url is string => Boolean(url)),
    fechaPublicacion: publicacion.fechaAlta.toISOString(),
    mascota: {
      id: mascota.id,
      nombre: mascota.nombre,
      fechaNacimiento: mascota.fechaNacimiento ? aFechaISO(mascota.fechaNacimiento) : null,
      genero: mascota.genero,
      tamanio: mascota.tamanio,
      peso: mascota.peso === null ? null : Number(mascota.peso),
      castrado: mascota.castrado,
      descripcion: mascota.descripcion,
      imagenUrl: mascota.imagenUrl,
      especie: { id: mascota.raza.especie.id, nombre: mascota.raza.especie.nombre },
      raza: { id: mascota.raza.id, nombre: mascota.raza.nombre },
      estado: { id: estado.id, nombre: estado.nombre },
    },
    refugio: mascota.refugio,
    enFavoritos,
    esPropia,
  };
}

/**
 * Feed de adopción: una página de publicaciones vigentes que el usuario todavía no guardó,
 * más el total que matchea los filtros para que el cliente sepa si le quedan por traer.
 *
 * El descarte no se persiste: es temporal y vive en la pantalla, así que una mascota
 * rechazada vuelve a aparecer si el usuario recarga el feed.
 */
export async function listarFeed(
  usuarioId: number,
  filtros: FiltrosFeedDto,
): Promise<FeedPublicacionesDto> {
  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  const [publicaciones, total] = await Promise.all([
    repo.listarFeed(usuarioId, filtros, usuario.refugioId),
    repo.contarFeed(usuarioId, filtros, usuario.refugioId),
  ]);

  // El feed ya excluye las propias y las guardadas (con el criterio de `filtros.ambito`),
  // así que acá `enFavoritos` y `esPropia` son siempre false. Se deja explícito para que la
  // tarjeta y la ficha lean el mismo campo.
  return { total, publicaciones: publicaciones.map((pub) => aFeedDto(pub, false, false)) };
}

/** Ficha completa de una publicación, con el estado de favorito y de propiedad ya resueltos. */
export async function obtenerPublicacion(
  publicacionId: number,
  usuarioId: number,
  ambito: Ambito = 'PERSONAL',
): Promise<PublicacionFeedDto> {
  const publicacion = await repo.buscarActivaPorId(publicacionId);

  if (!publicacion) {
    throw new AppError('NO_ENCONTRADO', 'Esa publicación ya no está disponible', 404);
  }

  if (publicacion.mascota.historicoEstados.length === 0) {
    // Dato inconsistente, no un caso de negocio: sin estado vigente no se puede pintar.
    throw new AppError('NO_ENCONTRADO', 'Esa publicación ya no está disponible', 404);
  }

  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  const favoritas = await repo.filtrarFavoritas(usuarioId, [publicacion.mascotaId]);
  const esPropia = esMascotaPropia(
    publicacion.mascota,
    { id: usuario.id, refugioId: usuario.refugioId },
    ambito,
  );

  return aFeedDto(publicacion, favoritas.has(publicacion.mascotaId), esPropia);
}

/**
 * Id de la publicación activa de una mascota, si tiene una. Lo consume `mascotas.service`
 * para la ficha de detalle (HU-6.4): el botón "Ver publicación asociada" solo aparece con
 * un id, no con un booleano, porque de ahí sale directo el link a la ficha.
 */
export async function obtenerPublicacionActivaIdDeMascota(
  mascotaId: number,
): Promise<number | null> {
  const publicacion = await repo.buscarActivaDeMascota(mascotaId);
  return publicacion?.id ?? null;
}

export { MAXIMO_ACTIVAS_POR_ADOPTANTE };
