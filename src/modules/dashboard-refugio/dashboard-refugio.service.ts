import { AppError } from '../../middlewares/errorHandler';
import { finDeMes, inicioDeMes, parsearMesISO } from '../../shared/validation/dates';
import type { EntidadExportableRefugio, PeriodoDashboardInput } from './dashboard-refugio.dto';
import * as repo from './dashboard-refugio.repository';

/** Solicitud sin resolver todavía (mismo criterio que "abiertas" en el repository). */
const ESTADOS_SOLICITUD_ABIERTA = ['Pendiente', 'En_Revision'];
/** A partir de cuántos días sin resolver una solicitud abierta se considera demorada. */
const UMBRAL_DEMORA_DIAS = 5;
/** Cuántas solicitudes demoradas se listan en el detalle (las más antiguas primero). */
const TOPE_DETALLE_DEMORADAS = 5;
/** A partir de cuántos días publicada una publicación se considera "demasiado antigua". */
const UMBRAL_PUBLICACION_ANTIGUA_DIAS = 60;
/** Cuántas publicaciones demasiado antiguas se listan en el detalle (las más antiguas primero). */
const TOPE_DETALLE_PUBLICACIONES_ANTIGUAS = 10;

const MESES_ES = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
] as const;

export interface DashboardRefugioDto {
  refugio: { nombre: string; localidad: string };
  periodo: { desde: string; hasta: string };
  kpis: {
    animalesAdoptados: number;
    solicitudesCreadas: number;
    animalesEnRefugio: number;
    montoDonado: number;
    objetivoDonaciones: number;
    solicitudesDemoradas: number;
  };
  solicitudesPorEstado: { estado: string; cantidad: number; porcentaje: number }[];
  donacionesPorMes: { mes: string; monto: number; objetivo: number }[];
  mascotasPorEstado: Record<string, number>;
  publicacionesPorAntiguedad: Record<string, number>;
  solicitudesDemoradasDetalle: { id: number; mascota: string; dias: number }[];
  publicacionesDemasiadoAntiguas: { id: number; mascota: string; dias: number }[];
}

/** Precondición compartida con mascotas.service.ts: solo un usuario Refugio con refugioId puede operar. */
async function exigirRefugioDeUsuario(usuarioId: number) {
  const usuario = await repo.buscarUsuarioConRefugio(usuarioId);

  if (!usuario) {
    throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
  }
  if (!usuario.refugioId) {
    throw new AppError('SIN_REFUGIO', 'Tu usuario no está asociado a ningún refugio', 403);
  }

  const refugio = await repo.buscarRefugio(usuario.refugioId);
  if (!refugio) {
    throw new AppError('NO_ENCONTRADO', 'El refugio no existe', 404);
  }

  return refugio;
}

function rangoDelPeriodo(periodo: PeriodoDashboardInput): { desde: Date; hasta: Date } {
  const desde = parsearMesISO(periodo.desde)!;
  const hasta = parsearMesISO(periodo.hasta)!;

  return {
    desde: inicioDeMes(desde.anio, desde.mes),
    hasta: finDeMes(hasta.anio, hasta.mes),
  };
}

/** Un elemento por mes calendario entre desde y hasta (inclusive), en orden cronológico. */
function clavesDeMeses(periodo: PeriodoDashboardInput): { clave: string; etiqueta: string }[] {
  const desde = parsearMesISO(periodo.desde)!;
  const hasta = parsearMesISO(periodo.hasta)!;
  const claves: { clave: string; etiqueta: string }[] = [];

  let anio = desde.anio;
  let mes = desde.mes;
  while (anio < hasta.anio || (anio === hasta.anio && mes <= hasta.mes)) {
    claves.push({ clave: `${anio}-${mes}`, etiqueta: `${MESES_ES[mes - 1]} ${anio}` });
    mes += 1;
    if (mes > 12) {
      mes = 1;
      anio += 1;
    }
  }

  return claves;
}

function aSolicitudesPorEstado(
  estados: { id: number; nombre: string }[],
  conteos: { estadoSolicitudId: number; _count: { _all: number } }[],
) {
  const total = conteos.reduce((acc, c) => acc + c._count._all, 0);
  const porId = new Map(conteos.map((c) => [c.estadoSolicitudId, c._count._all]));

  return estados.map(({ id, nombre }) => {
    const cantidad = porId.get(id) ?? 0;
    return {
      estado: nombre,
      cantidad,
      porcentaje: total === 0 ? 0 : Math.round((cantidad / total) * 1000) / 10,
    };
  });
}

/** Junta un catálogo con su groupBy de conteos, en un Record nombre → cantidad (0 si no hubo filas). */
function aConteoPorNombre(
  catalogo: { id: number; nombre: string }[],
  conteos: { estadoMascotaId: number; _count: { _all: number } }[],
): Record<string, number> {
  const porId = new Map(conteos.map((c) => [c.estadoMascotaId, c._count._all]));

  return Object.fromEntries(catalogo.map((item) => [item.nombre, porId.get(item.id) ?? 0]));
}

function diasDesde(fecha: Date, hoy: Date): number {
  return Math.max(0, Math.floor((hoy.getTime() - fecha.getTime()) / 86_400_000));
}

const BUCKETS_ANTIGUEDAD_PUBLICACION = [
  '0-15 días',
  '15-30 días',
  '30-60 días',
  '+60 días',
] as const;

function bucketDeAntiguedadPublicacion(
  dias: number,
): (typeof BUCKETS_ANTIGUEDAD_PUBLICACION)[number] {
  if (dias <= 15) return '0-15 días';
  if (dias <= 30) return '15-30 días';
  if (dias <= 60) return '30-60 días';
  return '+60 días';
}

/**
 * Hace cuántos días está publicada cada publicación vigente del refugio, agrupadas en buckets, y
 * el detalle de las que superan UMBRAL_PUBLICACION_ANTIGUA_DIAS (mascota puntual, no solo el conteo).
 */
function aPublicacionesPorAntiguedad(
  publicaciones: { id: number; fechaAlta: Date; mascota: { nombre: string | null } }[],
  hoy: Date,
): {
  porBucket: Record<string, number>;
  demasiadoAntiguas: { id: number; mascota: string; dias: number }[];
} {
  const porBucket = Object.fromEntries(BUCKETS_ANTIGUEDAD_PUBLICACION.map((b) => [b, 0])) as Record<
    string,
    number
  >;
  const demasiadoAntiguas: { id: number; mascota: string; dias: number }[] = [];

  for (const { id, fechaAlta, mascota } of publicaciones) {
    const dias = diasDesde(fechaAlta, hoy);
    const bucket = bucketDeAntiguedadPublicacion(dias);
    porBucket[bucket] = (porBucket[bucket] ?? 0) + 1;

    if (dias >= UMBRAL_PUBLICACION_ANTIGUA_DIAS) {
      demasiadoAntiguas.push({ id, mascota: mascota.nombre ?? '', dias });
    }
  }

  demasiadoAntiguas.sort((a, b) => b.dias - a.dias);

  return { porBucket, demasiadoAntiguas };
}

/** Solicitudes abiertas (sin resolver) hace más de UMBRAL_DEMORA_DIAS, más antiguas primero. */
function aSolicitudesDemoradas(
  solicitudes: {
    id: number;
    publicacion: { mascota: { nombre: string | null } };
    historicoEstados: { fechaAlta: Date; estadoSolicitud: { nombre: string } }[];
  }[],
  hoy: Date,
): { id: number; mascota: string; dias: number }[] {
  return solicitudes
    .flatMap((s) => {
      const vigente = s.historicoEstados[0];
      if (!vigente || !ESTADOS_SOLICITUD_ABIERTA.includes(vigente.estadoSolicitud.nombre)) {
        return [];
      }
      const dias = diasDesde(vigente.fechaAlta, hoy);
      const mascota = s.publicacion.mascota.nombre ?? '';
      return dias >= UMBRAL_DEMORA_DIAS ? [{ id: s.id, mascota, dias }] : [];
    })
    .sort((a, b) => b.dias - a.dias);
}

function aDonacionesPorMes(
  periodo: PeriodoDashboardInput,
  donaciones: { fechaAlta: Date; monto: unknown }[],
  objetivo: number,
): { mes: string; monto: number; objetivo: number }[] {
  const montoPorClave = new Map<string, number>();
  for (const { fechaAlta, monto } of donaciones) {
    const clave = `${fechaAlta.getFullYear()}-${fechaAlta.getMonth() + 1}`;
    montoPorClave.set(clave, (montoPorClave.get(clave) ?? 0) + Number(monto));
  }

  return clavesDeMeses(periodo).map(({ clave, etiqueta }) => ({
    mes: etiqueta,
    monto: montoPorClave.get(clave) ?? 0,
    objetivo,
  }));
}

export async function obtenerDashboard(
  usuarioId: number,
  periodo: PeriodoDashboardInput,
): Promise<DashboardRefugioDto> {
  const refugio = await exigirRefugioDeUsuario(usuarioId);
  const { desde, hasta } = rangoDelPeriodo(periodo);

  const [
    animalesEnRefugio,
    estadosSolicitud,
    solicitudesPorEstado,
    solicitudesCreadas,
    donaciones,
    objetivoDonaciones,
    estadosMascota,
    mascotasPorEstado,
    publicacionesActivas,
    solicitudesAbiertas,
  ] = await Promise.all([
    repo.contarMascotasEnRefugio(refugio.id),
    repo.listarEstadosSolicitud(),
    repo.contarSolicitudesPorEstado(refugio.id, desde, hasta),
    repo.contarSolicitudesCreadas(refugio.id, desde, hasta),
    repo.listarDonaciones(refugio.id, desde, hasta),
    repo.sumarObjetivoCampaniasActivas(refugio.id),
    repo.listarEstadosMascota(),
    repo.contarMascotasPorEstado(refugio.id),
    repo.listarPublicacionesActivas(refugio.id),
    repo.listarSolicitudesAbiertas(refugio.id),
  ]);

  const solicitudesPorEstadoConPorcentaje = aSolicitudesPorEstado(
    estadosSolicitud,
    solicitudesPorEstado,
  );
  const mascotasPorEstadoDto = aConteoPorNombre(estadosMascota, mascotasPorEstado);
  // Snapshot: mascotas del refugio cuyo estado vigente es "Adoptado" ahora mismo, no una cuenta de
  // solicitudes aprobadas en el período (mismo criterio snapshot que animalesEnRefugio).
  const animalesAdoptados = mascotasPorEstadoDto['Adoptado'] ?? 0;
  const montoDonado = donaciones.reduce((acc, d) => acc + Number(d.monto), 0);

  const hoy = new Date();
  const { porBucket, demasiadoAntiguas } = aPublicacionesPorAntiguedad(publicacionesActivas, hoy);
  const solicitudesDemoradasDetalle = aSolicitudesDemoradas(solicitudesAbiertas, hoy);

  return {
    refugio: { nombre: refugio.nombre, localidad: refugio.direccion },
    periodo: { desde: periodo.desde, hasta: periodo.hasta },
    kpis: {
      animalesAdoptados,
      solicitudesCreadas,
      animalesEnRefugio,
      montoDonado,
      objetivoDonaciones,
      solicitudesDemoradas: solicitudesDemoradasDetalle.length,
    },
    solicitudesPorEstado: solicitudesPorEstadoConPorcentaje,
    donacionesPorMes: aDonacionesPorMes(periodo, donaciones, objetivoDonaciones),
    mascotasPorEstado: mascotasPorEstadoDto,
    publicacionesPorAntiguedad: porBucket,
    solicitudesDemoradasDetalle: solicitudesDemoradasDetalle.slice(0, TOPE_DETALLE_DEMORADAS),
    publicacionesDemasiadoAntiguas: demasiadoAntiguas.slice(0, TOPE_DETALLE_PUBLICACIONES_ANTIGUAS),
  };
}

// ─────────────── EXPORT CSV (por entidad, mismo patrón que dashboard-admin.service.ts) ───────────────

const FILAS_POR_PAGINA = 500;

const HEADERS_EXPORT: Record<EntidadExportableRefugio, string[]> = {
  mascotas: ['id', 'nombre', 'especie', 'raza', 'estado', 'fechaAlta'],
  solicitudes: ['id', 'mascota', 'tipoSolicitud', 'estado', 'fechaAlta'],
  donaciones: ['id', 'donante', 'campania', 'monto', 'fechaAlta'],
};

/** Snapshot, no depende del período — mismo criterio que mascotasPorEstado en obtenerDashboard. */
async function* filasMascotas(refugioId: number) {
  let cursorId: number | undefined;
  for (;;) {
    const pagina = await repo.paginaMascotasParaExport(refugioId, cursorId, FILAS_POR_PAGINA);
    if (pagina.length === 0) return;
    for (const m of pagina) {
      yield [
        m.id,
        m.nombre,
        m.raza.especie.nombre,
        m.raza.nombre,
        m.historicoEstados[0]?.estadoMascota.nombre ?? '',
        m.fechaAlta,
      ];
    }
    cursorId = pagina[pagina.length - 1]!.id;
    if (pagina.length < FILAS_POR_PAGINA) return;
  }
}

async function* filasSolicitudes(refugioId: number, desde: Date, hasta: Date) {
  let cursorId: number | undefined;
  for (;;) {
    const pagina = await repo.paginaSolicitudesParaExport(
      refugioId,
      desde,
      hasta,
      cursorId,
      FILAS_POR_PAGINA,
    );
    if (pagina.length === 0) return;
    for (const s of pagina) {
      yield [
        s.id,
        s.publicacion.mascota.nombre,
        s.tipoSolicitud.nombre,
        s.historicoEstados[0]?.estadoSolicitud.nombre ?? '',
        s.fechaAlta,
      ];
    }
    cursorId = pagina[pagina.length - 1]!.id;
    if (pagina.length < FILAS_POR_PAGINA) return;
  }
}

async function* filasDonaciones(refugioId: number, desde: Date, hasta: Date) {
  let cursorId: number | undefined;
  for (;;) {
    const pagina = await repo.paginaDonacionesParaExport(
      refugioId,
      desde,
      hasta,
      cursorId,
      FILAS_POR_PAGINA,
    );
    if (pagina.length === 0) return;
    for (const d of pagina) {
      yield [
        d.id,
        `${d.usuario.nombre} ${d.usuario.apellido}`,
        d.campania.titulo,
        d.monto.toString(),
        d.fechaAlta,
      ];
    }
    cursorId = pagina[pagina.length - 1]!.id;
    if (pagina.length < FILAS_POR_PAGINA) return;
  }
}

/**
 * Resuelve permisos y período ANTES de que el controller empiece a escribir la respuesta CSV
 * (una vez que res.write() corrió no se puede volver a un 403/400 JSON) — mismo motivo por el
 * que dashboard-admin valida la entidad antes de setear headers.
 */
export async function prepararExportEntidad(
  usuarioId: number,
  entidad: EntidadExportableRefugio,
  periodo: PeriodoDashboardInput,
) {
  const refugio = await exigirRefugioDeUsuario(usuarioId);
  const { desde, hasta } = rangoDelPeriodo(periodo);

  const filasPorEntidad: Record<EntidadExportableRefugio, () => AsyncGenerator<unknown[]>> = {
    mascotas: () => filasMascotas(refugio.id),
    solicitudes: () => filasSolicitudes(refugio.id, desde, hasta),
    donaciones: () => filasDonaciones(refugio.id, desde, hasta),
  };

  return {
    headers: HEADERS_EXPORT[entidad],
    filas: filasPorEntidad[entidad],
  };
}
