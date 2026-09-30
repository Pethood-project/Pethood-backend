/**
 * Campañas de donación (spec 021, HU-12.1 a HU-12.7).
 *
 * Dos lados del mostrador:
 * - El REFUGIO (perfil Refugio) crea sus campañas, las finaliza o cancela, y revisa las
 *   donaciones que le avisan: las aplica (suman al progreso) o las rechaza con motivo.
 * - El ADOPTANTE (perfil Personal) recorre las campañas Activa, transfiere por fuera del
 *   sistema y avisa cuánto donó. Esa donación nace Pendiente y NO suma hasta que el refugio la
 *   aplica (regla transversal 11).
 *
 * Las transiciones automáticas (HU-12.4) las comparte con el cron vía `campanias.estados.ts`.
 */
import { AppError } from '../../middlewares/errorHandler';
import { USUARIO_SISTEMA_ID } from '../../shared/auditoria';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { borrarImagen, guardarImagen } from '../../shared/storage';
import { aFechaISO } from '../../shared/validation/dates';
import { LIMITES } from '../../shared/validation/limits';
import type {
  CampaniaDto,
  CampaniaRefugioDto,
  CrearCampaniaDto,
  DonacionDto,
  DonarDto,
  FiltrosDonacionesDto,
  FiltrosMisCampaniasDto,
  ListaCampaniasDto,
  ListaDonacionesDto,
  PaginaCampaniasDto,
  ResolverDonacionDto,
} from './campanias.dto';
import {
  calcularPorcentaje,
  ESTADO_CAMPANIA,
  ESTADO_DONACION,
  siguienteEstadoAutomatico,
  transicionManualPermitida,
  type EstadoManual,
  type MotivoRechazo,
  type NombreEstadoCampania,
  type NombreEstadoDonacion,
} from './campanias.estados';
import * as repo from './campanias.repository';

const SUBCARPETA_IMAGENES = 'campanias';

const SIN_DONACIONES: repo.ResumenDonaciones = { recaudado: 0, donantes: 0, pendientes: 0 };

export type ArchivoImagen = Parameters<typeof guardarImagen>[0];

const VERBO: Record<EstadoManual, string> = { Finalizada: 'finalizar', Cancelada: 'cancelar' };

// ─────────────── CATÁLOGOS ───────────────

type IdsPorNombre<N extends string> = Record<N, number>;

function idsPorNombre<N extends string>(
  filas: { id: number; nombre: string }[],
  nombres: readonly N[],
  catalogo: string,
): IdsPorNombre<N> {
  const ids = {} as IdsPorNombre<N>;

  for (const nombre of nombres) {
    const fila = filas.find((candidata) => candidata.nombre === nombre);
    // Un catálogo incompleto es un seed roto, no un error del usuario.
    if (!fila) throw new Error(`Falta el estado "${nombre}" en el catálogo ${catalogo}`);
    ids[nombre] = fila.id;
  }

  return ids;
}

/** Ids de los estados de campaña por nombre. Lo usa también el cron. */
export async function idsEstadosCampania(): Promise<IdsPorNombre<NombreEstadoCampania>> {
  return idsPorNombre(
    await repo.buscarEstadosCampania(),
    Object.values(ESTADO_CAMPANIA),
    'EstadoCampania',
  );
}

async function idsEstadosDonacion(): Promise<IdsPorNombre<NombreEstadoDonacion>> {
  return idsPorNombre(
    await repo.buscarEstadosDonacion(),
    Object.values(ESTADO_DONACION),
    'EstadoDonacion',
  );
}

// ─────────────── ARMADO DE RESPUESTAS ───────────────

function aDto(campania: repo.CampaniaConRelaciones, resumen: repo.ResumenDonaciones): CampaniaDto {
  const objetivo = Number(campania.objetivo);

  return {
    id: campania.id,
    titulo: campania.titulo,
    descripcion: campania.descripcion,
    imagenUrl: campania.imagenUrl,
    objetivo,
    recaudado: resumen.recaudado,
    porcentaje: calcularPorcentaje(resumen.recaudado, objetivo),
    donantes: resumen.donantes,
    // Sólo el día: con hora, en otra zona horaria podría mostrarse el día anterior.
    fechaInicio: aFechaISO(campania.fechaInicio),
    fechaFin: aFechaISO(campania.fechaFin),
    estado: { id: campania.estadoCampania.id, nombre: campania.estadoCampania.nombre },
    alias: campania.alias,
    cbu: campania.cbu,
    refugio: {
      id: campania.refugio.id,
      nombre: campania.refugio.nombre,
      imagenUrl: campania.refugio.imagenUrl,
    },
  };
}

function aDtoRefugio(
  campania: repo.CampaniaConRelaciones,
  resumen: repo.ResumenDonaciones,
): CampaniaRefugioDto {
  return { ...aDto(campania, resumen), pendientes: resumen.pendientes };
}

function aDtoDonacion(donacion: repo.DonacionConRelaciones): DonacionDto {
  return {
    id: donacion.id,
    monto: Number(donacion.monto),
    estado: { id: donacion.estadoDonacion.id, nombre: donacion.estadoDonacion.nombre },
    motivoRechazo: donacion.motivoRechazo as MotivoRechazo | null,
    fechaAlta: donacion.fechaAlta.toISOString(),
    donante: {
      id: donacion.usuario.id,
      nombre: donacion.usuario.nombre,
      apellido: donacion.usuario.apellido,
      imagenUrl: donacion.usuario.imagenUrl,
    },
  };
}

/** Se piden `limite + 1` filas: la que sobra sólo dice que hay más. */
function paginar<T extends { id: number }>(filas: T[], limite: number) {
  const hayMas = filas.length > limite;
  const pagina = hayMas ? filas.slice(0, limite) : filas;
  return { pagina, hayMas, proximoCursor: hayMas ? pagina[pagina.length - 1]!.id : null };
}

async function resumenDe(campaniaId: number): Promise<repo.ResumenDonaciones> {
  return (await repo.resumirDonaciones([campaniaId])).get(campaniaId) ?? SIN_DONACIONES;
}

// ─────────────── REGLAS COMPARTIDAS ───────────────

/**
 * Refugio del miembro que opera. Con `paraCrear` además exige que esté verificado y activo
 * (precondición de HU-12.1). Las campañas existentes siguen su ciclo aunque el refugio se
 * suspenda (spec 021 §8).
 */
async function refugioDe(usuarioId: number, paraCrear = false): Promise<number> {
  const usuario = await repo.buscarUsuarioConRefugio(usuarioId);

  if (!usuario?.refugio) {
    throw new AppError('SIN_REFUGIO', 'Tu usuario no está asociado a ningún refugio', 403);
  }

  const { refugio } = usuario;
  const habilitado =
    refugio.verificado && refugio.fechaBaja === null && refugio.estado.nombre === 'Activo';

  if (paraCrear && !habilitado) {
    throw new AppError(
      'REFUGIO_NO_HABILITADO',
      'Tu refugio tiene que estar verificado y activo para crear campañas',
      403,
    );
  }

  return refugio.id;
}

/** 404 también si es de otro refugio: no se revela que existe. */
async function campaniaDelRefugio(
  campaniaId: number,
  refugioId: number,
): Promise<repo.CampaniaConRelaciones> {
  const campania = await repo.buscarPorId(campaniaId);

  if (!campania || campania.refugioId !== refugioId) {
    throw new AppError('CAMPANIA_NO_ENCONTRADA', 'No encontramos esa campaña', 404);
  }

  return campania;
}

/**
 * Aplica ya la regla del cron (HU-12.4), para no esperar a la corrida del día siguiente: al
 * crear una campaña que empieza hoy (§6.5) y al aplicar la donación que completa el objetivo
 * (§6.7). Devuelve la campaña actualizada, o `null` si no cambió.
 */
async function aplicarReglaAutomatica(
  campania: repo.CampaniaConRelaciones,
  recaudado: number,
  estados: IdsPorNombre<NombreEstadoCampania>,
): Promise<repo.CampaniaConRelaciones | null> {
  const desde = campania.estadoCampania.nombre as NombreEstadoCampania;
  const hacia = siguienteEstadoAutomatico(
    {
      estado: desde,
      fechaInicio: campania.fechaInicio,
      fechaFin: campania.fechaFin,
      objetivo: Number(campania.objetivo),
      recaudado,
    },
    new Date(),
  );

  if (!hacia) return null;

  const cambio = await repo.cambiarEstadoSi(
    campania.id,
    estados[desde],
    estados[hacia],
    USUARIO_SISTEMA_ID,
  );
  // Si otro la movió en el medio, lo que haya hecho es lo que vale.
  if (!cambio) return null;

  await registrarAuditoria({
    usuarioId: USUARIO_SISTEMA_ID,
    accion: 'CAMBIAR_ESTADO',
    entidad: 'Campania',
    entidadId: campania.id,
    detalle: `${desde} -> ${hacia} (automático)`,
  });

  return repo.buscarPorId(campania.id);
}

// ─────────────── REFUGIO ───────────────

/** HU-12.1: nace Inactiva (y pasa a Activa en el acto si empieza hoy). */
export async function crearCampania(
  datos: CrearCampaniaDto,
  contexto: { usuarioId: number; archivo?: ArchivoImagen },
): Promise<CampaniaRefugioDto> {
  if (!contexto.archivo) {
    throw new AppError('IMAGEN_REQUERIDA', 'Agregá una imagen para la campaña', 400);
  }

  const refugioId = await refugioDe(contexto.usuarioId, true);
  const tope = LIMITES.campania.vigentesPorRefugio;

  // Antes de subir la imagen: no dejar archivos huérfanos por un alta que igual se rechaza.
  if ((await repo.contarVigentes(refugioId)) >= tope) {
    throw new AppError(
      'LIMITE_CAMPANIAS',
      `Alcanzaste el límite de ${tope} campañas activas. Finalizá o cancelá una para crear otra`,
      409,
    );
  }

  const estados = await idsEstadosCampania();
  const imagenUrl = await guardarImagen(contexto.archivo, SUBCARPETA_IMAGENES);

  let creada: repo.CampaniaConRelaciones;
  try {
    creada = await repo.crear(
      {
        titulo: datos.titulo,
        descripcion: datos.descripcion,
        objetivo: datos.objetivo,
        fechaInicio: datos.fechaInicio,
        fechaFin: datos.fechaFin,
        alias: datos.alias,
        cbu: datos.cbu,
        imagenUrl,
        refugioId,
        estadoCampaniaId: estados.Inactiva,
      },
      contexto.usuarioId,
    );
  } catch (err) {
    await borrarImagen(imagenUrl);
    throw err;
  }

  await registrarAuditoria({
    usuarioId: contexto.usuarioId,
    accion: 'CREAR',
    entidad: 'Campania',
    entidadId: creada.id,
    detalle: `objetivo=${datos.objetivo}`,
  });

  const campania = (await aplicarReglaAutomatica(creada, 0, estados)) ?? creada;
  return aDtoRefugio(campania, SIN_DONACIONES);
}

/** HU-12.1: «Mis Campañas», con filtros por fecha de inicio y estados. */
export async function listarCampaniasDelRefugio(
  filtros: FiltrosMisCampaniasDto,
  usuarioId: number,
): Promise<ListaCampaniasDto<CampaniaRefugioDto>> {
  const refugioId = await refugioDe(usuarioId);

  if (filtros.cursor !== undefined && !(await repo.existeCampania(filtros.cursor))) {
    throw new AppError('CURSOR_INVALIDO', 'No pudimos seguir cargando las campañas', 400);
  }

  const filas = await repo.listarDelRefugio(
    refugioId,
    { fechaDesde: filtros.fechaDesde, fechaHasta: filtros.fechaHasta, estados: filtros.estados },
    filtros.limite,
    filtros.cursor,
  );
  const { pagina, hayMas, proximoCursor } = paginar(filas, filtros.limite);
  const resumen = await repo.resumirDonaciones(pagina.map((campania) => campania.id));

  return {
    campanias: pagina.map((campania) =>
      aDtoRefugio(campania, resumen.get(campania.id) ?? SIN_DONACIONES),
    ),
    hayMas,
    proximoCursor,
  };
}

/** HU-12.5 (cancelar) y HU-12.6 (finalizar), con las reglas de HU-12.7. */
export async function cambiarEstadoCampania(
  campaniaId: number,
  hacia: EstadoManual,
  usuarioId: number,
): Promise<CampaniaRefugioDto> {
  const refugioId = await refugioDe(usuarioId);
  const campania = await campaniaDelRefugio(campaniaId, refugioId);
  const desde = campania.estadoCampania.nombre;

  if (!transicionManualPermitida(desde, hacia)) {
    throw new AppError(
      'TRANSICION_INVALIDA',
      `La campaña está «${desde}»: no se puede ${VERBO[hacia]}`,
      409,
    );
  }

  const estados = await idsEstadosCampania();
  const cambio = await repo.cambiarEstadoSi(
    campania.id,
    estados[desde as NombreEstadoCampania],
    estados[hacia],
    usuarioId,
  );

  if (!cambio) {
    throw new AppError(
      'TRANSICION_INVALIDA',
      'La campaña cambió de estado recién. Actualizá la lista e intentalo de nuevo',
      409,
    );
  }

  await registrarAuditoria({
    usuarioId,
    accion: 'CAMBIAR_ESTADO',
    entidad: 'Campania',
    entidadId: campania.id,
    detalle: `${desde} -> ${hacia}`,
  });

  const actualizada = (await repo.buscarPorId(campania.id)) ?? campania;
  return aDtoRefugio(actualizada, await resumenDe(campania.id));
}

/** HU-12.3: bandeja de revisión de una campaña del refugio. */
export async function listarDonaciones(
  campaniaId: number,
  filtros: FiltrosDonacionesDto,
  usuarioId: number,
): Promise<ListaDonacionesDto> {
  const refugioId = await refugioDe(usuarioId);
  await campaniaDelRefugio(campaniaId, refugioId);

  if (filtros.cursor !== undefined && !(await repo.existeDonacion(filtros.cursor))) {
    throw new AppError('CURSOR_INVALIDO', 'No pudimos seguir cargando las donaciones', 400);
  }

  const filas = await repo.listarDonaciones(
    campaniaId,
    filtros.estado,
    filtros.limite,
    filtros.cursor,
  );
  const { pagina, hayMas, proximoCursor } = paginar(filas, filtros.limite);

  return { donaciones: pagina.map(aDtoDonacion), hayMas, proximoCursor };
}

function yaRevisada(): AppError {
  return new AppError('TRANSICION_INVALIDA', 'Esta donación ya fue revisada', 409);
}

/** Si la campaña sigue Activa y la donación la completó, la cierra en el acto (§6.7). */
async function cerrarSiCompleta(campaniaId: number): Promise<void> {
  const campania = await repo.buscarPorId(campaniaId);
  if (!campania || campania.estadoCampania.nombre !== ESTADO_CAMPANIA.ACTIVA) return;

  const { recaudado } = await resumenDe(campaniaId);
  await aplicarReglaAutomatica(campania, recaudado, await idsEstadosCampania());
}

/**
 * HU-12.3: aplicar (Realizada, suma) o rechazar con motivo (Cancelada, no suma). Se puede
 * aunque la campaña ya haya cerrado: la transferencia pudo hacerse antes del cierre.
 */
export async function resolverDonacion(
  donacionId: number,
  datos: ResolverDonacionDto,
  usuarioId: number,
): Promise<DonacionDto> {
  const refugioId = await refugioDe(usuarioId);
  const donacion = await repo.buscarDonacion(donacionId);

  if (!donacion || donacion.campania.refugioId !== refugioId) {
    throw new AppError('DONACION_NO_ENCONTRADA', 'No encontramos esa donación', 404);
  }
  if (donacion.estadoDonacion.nombre !== ESTADO_DONACION.PENDIENTE) throw yaRevisada();

  const estados = await idsEstadosDonacion();
  const motivo = datos.estado === ESTADO_DONACION.CANCELADA ? datos.motivo : null;

  const resuelta = await repo.resolverDonacionSi(
    donacion.id,
    estados.Pendiente,
    estados[datos.estado],
    motivo,
    usuarioId,
  );
  if (!resuelta) throw yaRevisada();

  await registrarAuditoria({
    usuarioId,
    accion: datos.estado === ESTADO_DONACION.REALIZADA ? 'APLICAR' : 'RECHAZAR',
    entidad: 'Donacion',
    entidadId: donacion.id,
    ...(motivo ? { detalle: `motivo=${motivo}` } : {}),
  });

  if (datos.estado === ESTADO_DONACION.REALIZADA) await cerrarSiCompleta(donacion.campaniaId);

  const actualizada = await repo.buscarDonacionCompleta(donacion.id);
  return aDtoDonacion(actualizada!);
}

// ─────────────── ADOPTANTE ───────────────

/** HU-12.2: portal de campañas Activa de todos los refugios. */
export async function listarPortal(
  pagina: PaginaCampaniasDto,
): Promise<ListaCampaniasDto<CampaniaDto>> {
  if (pagina.cursor !== undefined && !(await repo.existeCampania(pagina.cursor))) {
    throw new AppError('CURSOR_INVALIDO', 'No pudimos seguir cargando las campañas', 400);
  }

  const filas = await repo.listarActivas(pagina.limite, pagina.cursor);
  const { pagina: campanias, hayMas, proximoCursor } = paginar(filas, pagina.limite);
  const resumen = await repo.resumirDonaciones(campanias.map((campania) => campania.id));

  return {
    campanias: campanias.map((campania) =>
      aDto(campania, resumen.get(campania.id) ?? SIN_DONACIONES),
    ),
    hayMas,
    proximoCursor,
  };
}

/** HU-12.2: detalle con alias y CBU para transferir. */
export async function obtenerCampania(id: number): Promise<CampaniaDto> {
  const campania = await repo.buscarPorId(id);

  if (!campania) {
    throw new AppError('CAMPANIA_NO_ENCONTRADA', 'No encontramos esa campaña', 404);
  }

  return aDto(campania, await resumenDe(id));
}

/** HU-12.3: «Terminar donación». Nace Pendiente y NO suma al progreso. */
export async function donar(
  campaniaId: number,
  datos: DonarDto,
  usuarioId: number,
): Promise<DonacionDto> {
  const usuario = await repo.buscarUsuarioConRefugio(usuarioId);
  if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);

  const campania = await repo.buscarPorId(campaniaId);
  if (!campania) {
    throw new AppError('CAMPANIA_NO_ENCONTRADA', 'No encontramos esa campaña', 404);
  }

  // Igual que no se adopta una mascota propia (spec 021 §6.6).
  if (usuario.refugioId !== null && usuario.refugioId === campania.refugioId) {
    throw new AppError('DONACION_PROPIA', 'No podés donar a una campaña de tu propio refugio', 403);
  }

  if (campania.estadoCampania.nombre !== ESTADO_CAMPANIA.ACTIVA) {
    throw new AppError('CAMPANIA_NO_ACTIVA', 'Esta campaña no está recibiendo donaciones', 409);
  }

  const estados = await idsEstadosDonacion();
  const donacion = await repo.crearDonacion(
    { campaniaId, monto: datos.monto, estadoDonacionId: estados.Pendiente },
    usuarioId,
  );

  await registrarAuditoria({
    usuarioId,
    accion: 'CREAR',
    entidad: 'Donacion',
    entidadId: donacion.id,
    detalle: `campania=${campaniaId} monto=${datos.monto}`,
  });

  return aDtoDonacion(donacion);
}
