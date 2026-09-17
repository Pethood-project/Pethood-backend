// Helpers compartidos por todos los módulos del seed.
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export const CONTRASENA_PRUEBA = 'Pethood123';
export const SISTEMA_EMAIL = 'sistema@pethood.internal';

export const esProduccion = process.env.NODE_ENV === 'production';

export const MINUTO = 60_000;
export const HORA = 60 * MINUTO;
export const DIA = 24 * HORA;

export const hace = (ms: number): Date => new Date(Date.now() - ms);
export const haceDias = (dias: number): Date => hace(dias * DIA);
export const enDias = (dias: number): Date => new Date(Date.now() + dias * DIA);

/** Día 15 de hace N meses: cae siempre dentro del bucket mensual esperado. */
export function haceMeses(cantidad: number, dia = 15): Date {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth() - cantidad, dia);
}

/** Fecha de nacimiento para una edad dada. Los cachorros van en meses para caer en el rango 0–1. */
export function nacioHace(anios: number, meses = 0): Date {
  const hoy = new Date();
  return new Date(hoy.getFullYear() - anios, hoy.getMonth() - meses, hoy.getDate());
}

/**
 * Las fotos son de Unsplash porque el seed no puede subir archivos al storage local; el
 * cliente las usa tal cual al ser absolutas.
 */
export const foto = (id: string): string => `https://images.unsplash.com/${id}?w=1200&q=80`;

export const FOTOS_PERRO = [
  'photo-1552053831-71594a27632d',
  'photo-1543466835-00a7907e9de1',
  'photo-1561037404-61cd46aa615b',
  'photo-1517423440428-a5a00ad493e8',
  'photo-1591160690555-5debfba289f0',
  'photo-1526336024174-e58f5cdd8e13',
  'photo-1548199973-03cce0bbc87b',
  'photo-1568572933382-74d440642117',
  'photo-1587300003388-59208cc962cb',
  'photo-1601979031925-424e53b6caaa',
];

export const FOTOS_GATO = [
  'photo-1514888286974-6c03e2ca1dba',
  'photo-1495360010541-f48722b34f7d',
  'photo-1518791841217-8f162f1e1131',
  'photo-1583337130417-3346a1be7dee',
  'photo-1596492784531-6e6eb5ea9993',
];

export const FOTOS_PERSONA = [
  'photo-1494790108377-be9c29b29330',
  'photo-1507003211169-0a1dd7228f2d',
  'photo-1438761681033-6461ffad8d80',
  'photo-1500648767791-00dcc994a43e',
];

let hashCacheado: string | null = null;

/** bcrypt es lento a propósito: se calcula una sola vez para todas las cuentas de prueba. */
export async function hashContrasena(): Promise<string> {
  hashCacheado ??= await bcrypt.hash(CONTRASENA_PRUEBA, 10);
  return hashCacheado;
}

/** RolUsuario no tiene índice único, así que el upsert se hace a mano. */
export async function asignarRol(usuarioId: number, rolId: number, usuarioAlta: number) {
  const existente = await prisma.rolUsuario.findFirst({
    where: { usuarioId, rolId, fechaBaja: null },
  });
  if (existente) return;

  await prisma.rolUsuario.create({ data: { usuarioId, rolId, usuarioAlta } });
}

/** Ids de cada catálogo indexados por nombre, para no repetir findUniqueOrThrow en cada módulo. */
export interface Catalogos {
  sistemaId: number;
  estadosUsuario: Map<string, number>;
  estadosRefugio: Map<string, number>;
  estadosMascota: Map<string, number>;
  estadosSolicitud: Map<string, number>;
  estadosCampania: Map<string, number>;
  estadosAnimalPerdido: Map<string, number>;
  roles: Map<string, number>;
  tiposSolicitud: Map<string, number>;
  /** Clave `Especie/Raza`, ej. `Perro/Labrador`. */
  razas: Map<string, number>;
}

export function id(mapa: Map<string, number>, nombre: string): number {
  const valor = mapa.get(nombre);
  if (valor === undefined) throw new Error(`Catálogo sin el valor "${nombre}"`);
  return valor;
}

export function log(mensaje: string) {
  console.log(mensaje);
}
