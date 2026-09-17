/**
 * Instancia única del cliente Prisma para toda la app.
 *
 * Solo la importan los `repository.ts` de cada módulo — los services acceden a datos
 * únicamente a través de su repository (CLAUDE.md / ARQUITECTURA.md), para poder testear
 * la lógica de negocio mockeando el repository sin levantar base.
 */
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
