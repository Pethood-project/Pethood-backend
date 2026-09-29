/**
 * Avisos de mascotas perdidas y encontradas (spec 020, HU-13.1): alta y portal.
 *
 * **El aviso es de la PERSONA que lo carga**, sea adoptante o miembro de un refugio, y desde
 * cualquiera de sus dos perfiles: el perfil activo (`X-Ambito`) no cambia nada. Es la misma
 * lógica que el chat de reencuentro (HU-13.2), que es entre personas y nunca lleva
 * `refugioId`.
 *
 * Fuera de esta HU, y anotado en la spec: el botón "Abrir chat" (HU-13.2) y el paso a
 * "Resuelto", la edición y la baja del aviso (HU-13.3).
 */
import { AppError } from '../../middlewares/errorHandler';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { borrarImagenes, guardarImagenes } from '../../shared/storage';
import { aFechaISO } from '../../shared/validation/dates';
import { ESTADOS_ANIMAL_PERDIDO_EN_ALTA } from '../catalogos/catalogos.service';
import type {
  AvisoDto,
  CrearAvisoDto,
  FiltrosAvisosDto,
  ListaAvisosDto,
} from './animales-perdidos.dto';
import * as repo from './animales-perdidos.repository';

const SUBCARPETA_FOTOS = 'perdidos';

/** El único estado que exige nombre: quien encuentra un animal no sabe cómo se llama. */
const ESTADO_QUE_EXIGE_NOMBRE = 'Perdido';

export interface ContextoCreacion {
  usuarioId: number;
  /** En el orden de la galería: el primero es la portada. */
  archivos: { buffer: Buffer; mimetype: string }[];
}

function aDto(aviso: repo.AvisoConRelaciones, usuarioId: number): AvisoDto {
  return {
    id: aviso.id,
    nombre: aviso.nombre,
    descripcion: aviso.descripcion,
    imagenUrl: aviso.imagenUrl,
    // Un aviso sin array (null en base) muestra igual su portada en la galería.
    imagenes: aviso.imagenes.length > 0 ? aviso.imagenes : [aviso.imagenUrl],
    ubicacion: aviso.ubicacion,
    estado: { id: aviso.estadoAnimalPerdido.id, nombre: aviso.estadoAnimalPerdido.nombre },
    especie: aviso.especie ? { id: aviso.especie.id, nombre: aviso.especie.nombre } : null,
    // Sólo el día, como `fechaNacimiento`: con hora, un día cargado en Argentina podría
    // mostrarse como el anterior en otra zona horaria.
    fechaSuceso: aviso.fechaSuceso ? aFechaISO(aviso.fechaSuceso) : null,
    fechaAlta: aviso.fechaAlta.toISOString(),
    fechaResuelto: aviso.fechaResuelto?.toISOString() ?? null,
    reportante: {
      id: aviso.usuarioReportante.id,
      nombre: aviso.usuarioReportante.nombre,
      apellido: aviso.usuarioReportante.apellido,
      imagenUrl: aviso.usuarioReportante.imagenUrl,
    },
    esPropio: aviso.usuarioReportanteId === usuarioId,
  };
}

/** El estado inicial sólo puede ser "Perdido" o "Encontrado", nunca "Resuelto". */
async function resolverEstadoInicial(estadoId: number) {
  const estado = await repo.buscarEstado(estadoId);

  if (!estado) {
    throw new AppError('NO_ENCONTRADO', 'El estado no existe', 404);
  }
  if (!ESTADOS_ANIMAL_PERDIDO_EN_ALTA.includes(estado.nombre)) {
    throw new AppError(
      'ESTADO_INVALIDO',
      'Un aviso nuevo tiene que ser de una mascota perdida o encontrada',
      400,
    );
  }

  return estado;
}

/** HU-13.1: publica el aviso con el usuario autenticado como reportante. */
export async function crearAviso(
  datos: CrearAvisoDto,
  contexto: ContextoCreacion,
): Promise<AvisoDto> {
  // Al menos una foto (la portada es NOT NULL) y bloquea el guardado, como en HU-6.1. El
  // máximo lo corta multer antes de llegar acá.
  if (contexto.archivos.length === 0) {
    throw new AppError('FOTO_REQUERIDA', 'Agregá una foto del animal', 400);
  }

  if (!(await repo.buscarUsuario(contexto.usuarioId))) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }

  const estado = await resolverEstadoInicial(datos.estadoId);

  if (estado.nombre === ESTADO_QUE_EXIGE_NOMBRE && !datos.nombre) {
    throw new AppError('VALIDACION', 'El nombre es obligatorio', 400);
  }

  if (!(await repo.buscarEspecie(datos.especieId))) {
    throw new AppError('NO_ENCONTRADO', 'La especie no existe', 404);
  }

  const imagenes = await guardarImagenes(contexto.archivos, SUBCARPETA_FOTOS);

  let aviso: repo.AvisoConRelaciones;
  try {
    aviso = await repo.crear(
      {
        nombre: datos.nombre,
        descripcion: datos.descripcion,
        imagenes,
        ubicacion: datos.ubicacion,
        fechaSuceso: datos.fechaSuceso,
        latitud: datos.latitud,
        longitud: datos.longitud,
        especieId: datos.especieId,
        estadoAnimalPerdidoId: estado.id,
      },
      contexto.usuarioId,
    );
  } catch (err) {
    // No dejar fotos huérfanas si la escritura en base falló.
    await borrarImagenes(imagenes);
    throw err;
  }

  await registrarAuditoria({
    usuarioId: contexto.usuarioId,
    accion: 'CREAR',
    entidad: 'AnimalPerdido',
    entidadId: aviso.id,
    detalle: `estado=${estado.nombre}`,
  });

  return aDto(aviso, contexto.usuarioId);
}

/**
 * HU-13.1: el portal, paginado por cursor. Sin resultados es una lista vacía con 200: el
 * empty state lo pinta el cliente.
 */
export async function listarAvisos(
  filtros: FiltrosAvisosDto,
  usuarioId: number,
): Promise<ListaAvisosDto> {
  // Un cursor que no existe paginaría desde ningún lado y el cliente creería que ya no hay
  // más avisos: se corta antes, igual que en el historial del chat.
  if (filtros.cursor !== undefined && !(await repo.existeAviso(filtros.cursor))) {
    throw new AppError('CURSOR_INVALIDO', 'No pudimos seguir cargando los avisos', 400);
  }

  const filas = await repo.listar(
    {
      fechaDesde: filtros.fechaDesde,
      fechaHasta: filtros.fechaHasta,
      estados: filtros.estados,
      especies: filtros.especies,
      ubicaciones: filtros.ubicaciones,
    },
    filtros.limite,
    filtros.cursor,
  );

  const hayMas = filas.length > filtros.limite;
  const pagina = hayMas ? filas.slice(0, filtros.limite) : filas;

  return {
    avisos: pagina.map((aviso) => aDto(aviso, usuarioId)),
    hayMas,
    proximoCursor: hayMas ? pagina[pagina.length - 1]!.id : null,
  };
}

/**
 * Opciones del filtro por ubicación: las que ya tienen los avisos visibles, sin repetir
 * variantes de mayúsculas ("Maipú" y "maipú" son una sola) y en orden alfabético.
 *
 * Provisorio mientras la ubicación sea texto libre: cuando exista el catálogo de
 * Provincia/Localidad, el filtro sale de ahí.
 */
export async function listarUbicaciones(): Promise<string[]> {
  const ubicaciones = (await repo.listarUbicaciones())
    .map(({ ubicacion }) => ubicacion?.trim() ?? '')
    .filter((ubicacion) => ubicacion !== '')
    // Orden por código antes de agrupar: entre dos variantes gana siempre la misma (la que
    // tiene mayúsculas), y la opción no cambia de una consulta a otra.
    .sort();

  const porClave = new Map<string, string>();

  for (const ubicacion of ubicaciones) {
    const clave = ubicacion.toLowerCase();
    if (!porClave.has(clave)) porClave.set(clave, ubicacion);
  }

  return [...porClave.values()].sort((a, b) => a.localeCompare(b, 'es'));
}
