import { AppError } from '../../middlewares/errorHandler';
import { esMascotaDelAmbito, esMascotaPropia, type Ambito } from '../../shared/ambito';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { borrarImagenes, guardarImagenes } from '../../shared/storage';
import { aFechaISO } from '../../shared/validation/dates';
import { ESTADOS_QUE_HABILITAN_PUBLICACION } from '../catalogos/catalogos.service';
import {
  ESTADO_PUBLICACION,
  type CrearPublicacionDto,
  type FeedPublicacionesDto,
  type FiltrosFeedDto,
  type FiltrosMisPublicacionesDto,
  type NombreEstadoPublicacion,
  type PublicacionCreadaDto,
  type PublicacionFeedDto,
  type PublicacionPropiaDto,
} from './publicaciones.dto';
import * as repo from './publicaciones.repository';

const SUBCARPETA_FOTOS = 'publicaciones';

/** Tope anti-spam de publicaciones simultáneas para un adoptante particular. */
const MAXIMO_ACTIVAS_POR_ADOPTANTE = 5;

export interface ContextoCreacion {
  usuarioId: number;
  /** Perfil con el que se publica: la mascota tiene que ser de ese perfil. */
  ambito: Ambito;
  /** En el orden en que se subieron: la primera es la portada. */
  archivos: { buffer: Buffer; mimetype: string }[];
}

export async function crearPublicacion(
  datos: CrearPublicacionDto,
  contexto: ContextoCreacion,
): Promise<PublicacionCreadaDto> {
  const { usuarioId, ambito, archivos } = contexto;
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

  // Desde un perfil no se publica una mascota del otro (ver `shared/ambito.ts`): para esta
  // vista, esa mascota no existe.
  if (!mascota || !esMascotaDelAmbito(mascota, usuario, ambito)) {
    throw new AppError('NO_ENCONTRADO', 'La mascota no existe', 404);
  }
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

  // La quota aplica a lo que se publica a título personal, no al refugio — también para un
  // miembro de refugio que publica desde su perfil personal.
  if (mascota.refugioId === null) {
    const activas = await repo.contarActivasPersonalesDeUsuario(usuarioId);

    if (activas >= MAXIMO_ACTIVAS_POR_ADOPTANTE) {
      throw new AppError(
        'LIMITE_DE_PUBLICACIONES',
        `Llegaste al máximo de ${MAXIMO_ACTIVAS_POR_ADOPTANTE} publicaciones activas`,
        409,
      );
    }
  }

  // Nace en el estado que le corresponde según la mascota: una "En_Transito" se publica
  // pausada (no entra al feed hasta que vuelva a estar disponible).
  const estadoInicial = await repo.buscarEstadoPublicacionPorNombre(
    estadoPublicacionSegunMascota(estado.nombre),
  );
  if (!estadoInicial) {
    // Catálogo incompleto: es un problema de datos, no algo que el usuario pueda resolver.
    throw new AppError('ERROR_INTERNO', 'No pudimos publicar. Intentalo más tarde', 500);
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
        estadoPublicacionId: estadoInicial.id,
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

/** Estado de mascota con el que el aviso queda activo. Mismo valor que usa el feed. */
const ESTADO_MASCOTA_PUBLICACION_ACTIVA = 'Disponible';

/** Estados de mascota que cierran el aviso: ya no hay a quién ofrecer en adopción. */
const ESTADOS_MASCOTA_PUBLICACION_FINALIZADA = ['Adoptado', 'Fallecido'];

/**
 * Regla de las transiciones automáticas: qué estado le corresponde a la publicación según el
 * estado de su mascota. Disponible → Activa; Adoptado/Fallecido → Finalizada; el resto
 * (En_Tratamiento, En_Transito) → Pausada. La misma regla completó el estado de las
 * publicaciones existentes en la migración `estado_publicacion` y la usa el seed.
 */
export function estadoPublicacionSegunMascota(estadoMascota: string): NombreEstadoPublicacion {
  if (estadoMascota === ESTADO_MASCOTA_PUBLICACION_ACTIVA) return ESTADO_PUBLICACION.ACTIVA;
  if (ESTADOS_MASCOTA_PUBLICACION_FINALIZADA.includes(estadoMascota)) {
    return ESTADO_PUBLICACION.FINALIZADA;
  }
  return ESTADO_PUBLICACION.PAUSADA;
}

/**
 * Transición automática: lleva la publicación viva de la mascota al estado que le toca según
 * el nuevo estado de la mascota. No hace nada si no tiene publicación o si ya está en ese
 * estado. Todo lo que cambie el estado de una mascota tiene que llamarla después de
 * persistirlo — hoy ninguna pantalla lo cambia después del alta (ver DEUDA_TECNICA.md
 * ítem 15).
 */
export async function sincronizarConEstadoMascota(
  mascotaId: number,
  estadoMascota: string,
  usuarioId: number,
): Promise<void> {
  const publicacion = await repo.buscarActivaDeMascota(mascotaId);
  if (!publicacion) return;

  const destino = estadoPublicacionSegunMascota(estadoMascota);
  if (publicacion.historicoEstados[0]?.estadoPublicacion.nombre === destino) return;

  const estado = await repo.buscarEstadoPublicacionPorNombre(destino);
  if (!estado) {
    throw new AppError('ERROR_INTERNO', 'No pudimos actualizar la publicación', 500);
  }

  await repo.cambiarEstado(publicacion.id, estado.id, usuarioId);
  await registrarAuditoria({
    usuarioId,
    accion: 'CAMBIAR_ESTADO',
    entidad: 'Publicacion',
    entidadId: publicacion.id,
    detalle: `estado=${destino} (automático, mascota=${estadoMascota})`,
  });
}

/** Estado vigente del aviso. Sin fila vigente el dato es inconsistente: se trata como ausente. */
function estadoVigente(publicacion: PublicacionConRelaciones) {
  const estado = publicacion.historicoEstados[0]?.estadoPublicacion;
  return estado ? { id: estado.id, nombre: estado.nombre } : null;
}

/** Galería de la publicación, o la foto de la mascota si no subió propias. */
function imagenesDe(publicacion: PublicacionConRelaciones): string[] {
  return publicacion.imagenes.length > 0
    ? publicacion.imagenes
    : [publicacion.mascota.imagenUrl].filter((url): url is string => Boolean(url));
}

/** Requiere estado vigente de la mascota y de la publicación: quien llama ya lo filtró. */
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
    imagenes: imagenesDe(publicacion),
    fechaPublicacion: publicacion.fechaAlta.toISOString(),
    estado: estadoVigente(publicacion)!,
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

  // El feed ya excluye las propias y las guardadas, así que acá `enFavoritos` y `esPropia` son siempre false. Se deja explícito para que la
  // tarjeta y la ficha lean el mismo campo.
  return { total, publicaciones: publicaciones.map((pub) => aFeedDto(pub, false, false)) };
}

/** Ficha completa de una publicación, con el estado de favorito y de propiedad ya resueltos. */
export async function obtenerPublicacion(
  publicacionId: number,
  usuarioId: number,
): Promise<PublicacionFeedDto> {
  const publicacion = await repo.buscarActivaPorId(publicacionId);

  if (!publicacion) {
    throw new AppError('NO_ENCONTRADO', 'Esa publicación ya no está disponible', 404);
  }

  if (publicacion.mascota.historicoEstados.length === 0 || !estadoVigente(publicacion)) {
    // Dato inconsistente, no un caso de negocio: sin estado vigente no se puede pintar.
    throw new AppError('NO_ENCONTRADO', 'Esa publicación ya no está disponible', 404);
  }

  const usuario = await repo.buscarUsuario(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  const favoritas = await repo.filtrarFavoritas(usuarioId, [publicacion.mascotaId]);
  const esPropia = esMascotaPropia(publicacion.mascota, {
    id: usuario.id,
    refugioId: usuario.refugioId,
  });

  return aFeedDto(publicacion, favoritas.has(publicacion.mascotaId), esPropia);
}

/**
 * "Mis publicaciones": las del perfil con el que se consulta (ver `shared/ambito.ts`). Desde
 * el personal, las de sus mascotas personales; desde el de refugio, todas las del refugio,
 * las haya publicado el miembro que sea.
 */
export async function listarMisPublicaciones(
  usuarioId: number,
  ambito: Ambito,
  filtros: FiltrosMisPublicacionesDto = { estados: [] },
): Promise<PublicacionPropiaDto[]> {
  let filtro: { usuarioId: number } | { refugioId: number } = { usuarioId };

  if (ambito === 'REFUGIO') {
    const usuario = await repo.buscarUsuario(usuarioId);

    if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
    if (!usuario.refugioId) {
      throw new AppError('SIN_REFUGIO', 'Tu usuario no está asociado a ningún refugio', 403);
    }

    filtro = { refugioId: usuario.refugioId };
  }

  // Sin estados elegidos, todas; con uno o más, solo las que están en alguno de ellos.
  const publicaciones = await repo.listarDeAmbito(filtro, filtros.estados);

  return publicaciones.flatMap((publicacion) => {
    // Sin estado vigente no se puede decir en qué estado está el aviso: dato inconsistente,
    // mismo criterio que la ficha.
    const estado = estadoVigente(publicacion);
    if (!estado) return [];

    const { mascota } = publicacion;

    return [
      {
        id: publicacion.id,
        imagenUrl: imagenesDe(publicacion)[0] ?? null,
        fechaPublicacion: publicacion.fechaAlta.toISOString(),
        estado,
        mascota: {
          id: mascota.id,
          nombre: mascota.nombre,
          fechaNacimiento: mascota.fechaNacimiento ? aFechaISO(mascota.fechaNacimiento) : null,
          especie: { id: mascota.raza.especie.id, nombre: mascota.raza.especie.nombre },
        },
      },
    ];
  });
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
