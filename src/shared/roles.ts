/** Nombres de Rol en la base (prisma/seed.ts / MODELO_DATOS.md). */
export const ROL_DB = {
  ADOPTANTE: 'Adoptante',
  MIEMBRO_REFUGIO: 'Refugio',
  ADMIN: 'Administrador',
} as const;

/** Códigos de rol en el contrato de la API (spec 001 / frontend). */
export const ROL_API = {
  ADOPTANTE: 'ADOPTANTE',
  MIEMBRO_REFUGIO: 'MIEMBRO_REFUGIO',
  ADMIN: 'ADMIN',
} as const;

export type RolApi = (typeof ROL_API)[keyof typeof ROL_API];

const DB_A_API: Record<string, RolApi> = {
  [ROL_DB.ADOPTANTE]: ROL_API.ADOPTANTE,
  [ROL_DB.MIEMBRO_REFUGIO]: ROL_API.MIEMBRO_REFUGIO,
  [ROL_DB.ADMIN]: ROL_API.ADMIN,
};

const API_A_DB: Record<string, string> = {
  [ROL_API.ADOPTANTE]: ROL_DB.ADOPTANTE,
  [ROL_API.MIEMBRO_REFUGIO]: ROL_DB.MIEMBRO_REFUGIO,
  [ROL_API.ADMIN]: ROL_DB.ADMIN,
};

export function rolDbAApi(nombreDb: string): RolApi {
  return DB_A_API[nombreDb] ?? (nombreDb as RolApi);
}

export function rolesDbAApi(nombresDb: string[]): RolApi[] {
  return nombresDb.map(rolDbAApi);
}

export function rolApiADb(rolApi: string): string {
  return API_A_DB[rolApi] ?? ROL_DB.ADOPTANTE;
}

export const ESTADO_USUARIO = {
  PENDIENTE: 'Pendiente_Verificacion',
  ACTIVO: 'Activo',
  SUSPENDIDO: 'Suspendido',
  INACTIVO: 'Inactivo',
} as const;
