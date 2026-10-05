import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';
import type { DatosCatalogo, NombreCatalogo } from './admin-catalogos.dto';

/** Fila de cualquier tabla paramétrica; los campos propios de una tabla son opcionales. */
export interface FilaCatalogo {
  id: number;
  nombre: string;
  descripcion?: string | null;
  secuenciaDias?: number;
  especieId?: number;
  especie?: { id: number; nombre: string };
  fechaAlta: Date;
  fechaBaja: Date | null;
  _count: Record<string, number>;
}

/**
 * Los delegates de Prisma no comparten tipo; los catálogos usan solo estas seis operaciones
 * con la misma forma, así que se tipan una vez acá en vez de repetir un `switch` por tabla.
 */
interface Delegado {
  findMany(args: unknown): Promise<FilaCatalogo[]>;
  findFirst(args: unknown): Promise<FilaCatalogo | null>;
  count(args: unknown): Promise<number>;
  create(args: unknown): Promise<FilaCatalogo>;
  update(args: unknown): Promise<FilaCatalogo>;
}

interface Config {
  delegado: Delegado;
  /**
   * Relaciones vivas (sin baja) que cuentan como «uso» del valor. Un valor con usos no se
   * puede dar de baja: las bajas nunca son en cascada.
   */
  usos: string[];
  orden: 'nombre' | 'id';
}

const CONFIG: Partial<Record<NombreCatalogo, Config>> = {
  especies: {
    delegado: prisma.especie as unknown as Delegado,
    usos: ['razas', 'animalesPerdidos'],
    orden: 'nombre',
  },
  razas: { delegado: prisma.raza as unknown as Delegado, usos: ['mascotas'], orden: 'nombre' },
  'estados-mascota': {
    delegado: prisma.estadoMascota as unknown as Delegado,
    usos: ['historicos'],
    orden: 'id',
  },
  'estados-publicacion': {
    delegado: prisma.estadoPublicacion as unknown as Delegado,
    usos: ['historicos'],
    orden: 'id',
  },
  'estados-solicitud': {
    delegado: prisma.estadoSolicitud as unknown as Delegado,
    usos: ['historicos'],
    orden: 'id',
  },
  'estados-campania': {
    delegado: prisma.estadoCampania as unknown as Delegado,
    usos: ['campanias'],
    orden: 'id',
  },
  'estados-refugio': {
    delegado: prisma.estadoRefugio as unknown as Delegado,
    usos: ['refugios'],
    orden: 'id',
  },
  'estados-animal-perdido': {
    delegado: prisma.estadoAnimalPerdido as unknown as Delegado,
    usos: ['reportes'],
    orden: 'id',
  },
  'tipos-solicitud': {
    delegado: prisma.tipoSolicitud as unknown as Delegado,
    usos: ['solicitudes'],
    orden: 'id',
  },
};

function config(catalogo: NombreCatalogo): Config {
  const c = CONFIG[catalogo];
  // `vacunas` no es una tabla: el service lo resuelve antes de llegar acá.
  if (!c) throw new Error(`El catálogo ${catalogo} no tiene tabla`);
  return c;
}

function include(catalogo: NombreCatalogo, c: Config) {
  return {
    _count: {
      select: Object.fromEntries(c.usos.map((rel) => [rel, { where: { fechaBaja: null } }])),
    },
    ...(catalogo === 'razas' ? { especie: { select: { id: true, nombre: true } } } : {}),
  };
}

export interface FiltrosListado {
  q?: string;
  especieId?: number;
  incluirBajas: boolean;
  page: number;
  limit: number;
}

export async function listar(catalogo: NombreCatalogo, f: FiltrosListado) {
  const c = config(catalogo);
  const where = {
    ...(f.incluirBajas ? {} : { fechaBaja: null }),
    ...(f.q ? { nombre: { contains: f.q, mode: 'insensitive' } } : {}),
    ...(catalogo === 'razas' && f.especieId ? { especieId: f.especieId } : {}),
  };

  const [items, total] = await Promise.all([
    c.delegado.findMany({
      where,
      include: include(catalogo, c),
      orderBy: c.orden === 'nombre' ? [{ nombre: 'asc' }, { id: 'asc' }] : { id: 'asc' },
      skip: (f.page - 1) * f.limit,
      take: f.limit,
    }),
    c.delegado.count({ where }),
  ]);

  return { items, total };
}

/** Sin filtro de baja: el admin también opera sobre los dados de baja (reactivar). */
export function buscar(catalogo: NombreCatalogo, id: number) {
  const c = config(catalogo);
  return c.delegado.findFirst({ where: { id }, include: include(catalogo, c) });
}

/** Por nombre sin distinguir mayúsculas, incluidos los dados de baja (el nombre es único). */
export function buscarPorNombre(catalogo: NombreCatalogo, nombre: string, especieId?: number) {
  return config(catalogo).delegado.findFirst({
    where: {
      nombre: { equals: nombre, mode: 'insensitive' },
      ...(catalogo === 'razas' ? { especieId } : {}),
    },
  });
}

export function crear(catalogo: NombreCatalogo, datos: DatosCatalogo, adminId: number) {
  const c = config(catalogo);
  return c.delegado.create({
    data: { ...datos, ...datosAlta(adminId) },
    include: include(catalogo, c),
  });
}

export function actualizar(
  catalogo: NombreCatalogo,
  id: number,
  datos: Record<string, unknown>,
  adminId: number,
) {
  const c = config(catalogo);
  return c.delegado.update({
    where: { id },
    data: { ...datos, ...datosModificacion(adminId) },
    include: include(catalogo, c),
  });
}

export function darDeBaja(catalogo: NombreCatalogo, id: number, adminId: number) {
  return actualizar(catalogo, id, datosBaja(adminId), adminId);
}

export function reactivar(catalogo: NombreCatalogo, id: number, adminId: number) {
  return actualizar(catalogo, id, { usuarioBaja: null, fechaBaja: null }, adminId);
}

export function buscarEspecieActiva(id: number) {
  return prisma.especie.findFirst({ where: { id, fechaBaja: null } });
}
