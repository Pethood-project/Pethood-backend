import { AppError } from '../../middlewares/errorHandler';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { VACUNAS } from '../../shared/vacunas';
import {
  PERMISOS,
  type DatosCatalogo,
  type FiltrosCatalogo,
  type NombreCatalogo,
} from './admin-catalogos.dto';
import * as repo from './admin-catalogos.repository';
import type { FilaCatalogo } from './admin-catalogos.repository';

interface Bloqueo {
  codigo: 'CATALOGO_SIN_BAJA' | 'YA_DE_BAJA' | 'CATALOGO_EN_USO';
  mensaje: string;
  status: number;
}

function contarUsos(fila: FilaCatalogo): number {
  return Object.values(fila._count).reduce((suma, n) => suma + n, 0);
}

/** Por qué un valor no se puede dar de baja, o `null` si se puede. Única fuente de la regla. */
function bloqueoDeBaja(catalogo: NombreCatalogo, fila: FilaCatalogo): Bloqueo | null {
  if (!PERMISOS[catalogo].baja) {
    return {
      codigo: 'CATALOGO_SIN_BAJA',
      mensaje:
        'Los valores de este catálogo son parte de la lógica del sistema y no se dan de baja.',
      status: 403,
    };
  }
  if (fila.fechaBaja) {
    return { codigo: 'YA_DE_BAJA', mensaje: 'El valor ya está dado de baja.', status: 409 };
  }
  const usos = contarUsos(fila);
  if (usos > 0) {
    return {
      codigo: 'CATALOGO_EN_USO',
      mensaje: `No se puede dar de baja: está en uso por ${usos} registro(s) activo(s).`,
      status: 409,
    };
  }
  return null;
}

function aItemDto(catalogo: NombreCatalogo, fila: FilaCatalogo) {
  const bloqueo = bloqueoDeBaja(catalogo, fila);

  return {
    id: fila.id,
    nombre: fila.nombre,
    descripcion: fila.descripcion ?? null,
    ...(fila.secuenciaDias !== undefined ? { secuenciaDias: fila.secuenciaDias } : {}),
    ...(fila.especie ? { especie: fila.especie } : {}),
    fechaAlta: fila.fechaAlta,
    fechaBaja: fila.fechaBaja,
    cantidadUsos: contarUsos(fila),
    puedeDarseDeBaja: bloqueo === null,
    bloqueoBaja: bloqueo ? { codigo: bloqueo.codigo, mensaje: bloqueo.mensaje } : null,
  };
}

function exigir(catalogo: NombreCatalogo, operacion: 'alta' | 'edicion' | 'baja'): void {
  if (!PERMISOS[catalogo][operacion]) {
    throw new AppError('OPERACION_NO_PERMITIDA', 'Este catálogo no admite esa operación.', 403);
  }
}

async function buscarOFallar(catalogo: NombreCatalogo, id: number) {
  const fila = await repo.buscar(catalogo, id);
  if (!fila) throw new AppError('NO_ENCONTRADO', 'No encontramos ese valor.', 404);
  return fila;
}

async function exigirNombreLibre(
  catalogo: NombreCatalogo,
  nombre: string,
  especieId: number | undefined,
  propioId?: number,
): Promise<void> {
  const existente = await repo.buscarPorNombre(catalogo, nombre, especieId);
  if (!existente || existente.id === propioId) return;

  throw new AppError(
    existente.fechaBaja ? 'CATALOGO_DUPLICADO_DE_BAJA' : 'CATALOGO_DUPLICADO',
    existente.fechaBaja
      ? `Ya existió un valor con ese nombre y está dado de baja (id ${existente.id}): reactivalo.`
      : 'Ya existe un valor con ese nombre.',
    409,
  );
}

async function auditar(adminId: number, accion: string, catalogo: NombreCatalogo, id: number) {
  await registrarAuditoria({
    usuarioId: adminId,
    accion,
    entidad: `Catalogo:${catalogo}`,
    entidadId: id,
  });
}

// ─────────────── Operaciones ───────────────

export async function listar(catalogo: NombreCatalogo, filtros: FiltrosCatalogo) {
  const { page, limit } = filtros;
  const permisos = PERMISOS[catalogo];

  if (catalogo === 'vacunas') {
    // Enum de código, no tabla: ver `shared/vacunas.ts`. El `id` es el `tipo`.
    const q = filtros.q?.toLowerCase();
    const todas = VACUNAS.filter((v) => !q || v.nombre.toLowerCase().includes(q));
    const items = todas.slice((page - 1) * limit, page * limit).map((v) => ({
      id: v.tipo,
      nombre: v.nombre,
      descripcion: v.descripcion,
      especie: v.especie,
      fechaAlta: null,
      fechaBaja: null,
      cantidadUsos: 0,
      puedeDarseDeBaja: false,
      bloqueoBaja: {
        codigo: 'CATALOGO_SIN_BAJA',
        mensaje: 'Las vacunas son un plan fijo del sistema y no se administran desde el panel.',
      },
    }));
    return { catalogo, permisos, items, total: todas.length, page, limit };
  }

  const { items, total } = await repo.listar(catalogo, filtros);
  return {
    catalogo,
    permisos,
    items: items.map((f) => aItemDto(catalogo, f)),
    total,
    page,
    limit,
  };
}

export async function crear(adminId: number, catalogo: NombreCatalogo, datos: DatosCatalogo) {
  exigir(catalogo, 'alta');

  if (catalogo === 'razas') {
    const especie = await repo.buscarEspecieActiva(datos.especieId!);
    if (!especie) throw new AppError('ESPECIE_NO_ENCONTRADA', 'La especie no existe.', 404);
  }
  await exigirNombreLibre(catalogo, datos.nombre!, datos.especieId);

  const fila = await repo.crear(catalogo, datos, adminId);
  await auditar(adminId, 'CREAR', catalogo, fila.id);
  return aItemDto(catalogo, fila);
}

export async function editar(
  adminId: number,
  catalogo: NombreCatalogo,
  id: number,
  datos: DatosCatalogo,
) {
  exigir(catalogo, 'edicion');
  const actual = await buscarOFallar(catalogo, id);
  if (actual.fechaBaja) {
    throw new AppError('YA_DE_BAJA', 'El valor está dado de baja: reactivalo para editarlo.', 409);
  }
  if (datos.nombre !== undefined) {
    await exigirNombreLibre(catalogo, datos.nombre, actual.especieId, id);
  }

  const fila = await repo.actualizar(catalogo, id, datos as Record<string, unknown>, adminId);
  await auditar(adminId, 'MODIFICAR', catalogo, id);
  return aItemDto(catalogo, fila);
}

export async function darDeBaja(adminId: number, catalogo: NombreCatalogo, id: number) {
  const actual = await buscarOFallar(catalogo, id);
  const bloqueo = bloqueoDeBaja(catalogo, actual);
  if (bloqueo) throw new AppError(bloqueo.codigo, bloqueo.mensaje, bloqueo.status);

  const fila = await repo.darDeBaja(catalogo, id, adminId);
  await auditar(adminId, 'BAJA', catalogo, id);
  return aItemDto(catalogo, fila);
}

export async function reactivar(adminId: number, catalogo: NombreCatalogo, id: number) {
  exigir(catalogo, 'baja');
  const actual = await buscarOFallar(catalogo, id);
  if (!actual.fechaBaja) {
    throw new AppError('NO_DE_BAJA', 'El valor no está dado de baja.', 409);
  }
  if (catalogo === 'razas' && !(await repo.buscarEspecieActiva(actual.especieId!))) {
    throw new AppError('ESPECIE_DE_BAJA', 'La especie de la raza está dada de baja.', 409);
  }

  const fila = await repo.reactivar(catalogo, id, adminId);
  await auditar(adminId, 'REACTIVAR', catalogo, id);
  return aItemDto(catalogo, fila);
}
