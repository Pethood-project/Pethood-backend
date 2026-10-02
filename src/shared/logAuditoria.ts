/**
 * Log de auditoría de operaciones críticas (CONSTITUTION.md §4).
 *
 * Decisión de equipo: NO es una tabla de la base (no hay modelo LogAuditoria en
 * prisma/schema.prisma) — es un archivo de texto append-only en logs/, gitignoreado.
 * Cada servicio decide qué operación es "crítica" y llama a registrarAuditoria()
 * después de que la escritura en base haya sido exitosa.
 *
 * En producción cada línea se repite además por stdout: en Render/Railway el disco es efímero
 * y `logs/` se pierde en cada deploy, mientras que stdout queda en el panel de logs de la
 * plataforma (DEUDA_TECNICA.md ítem 32).
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '../config/env';

const LOG_DIR = join(__dirname, '..', '..', 'logs');
const LOG_FILE = join(LOG_DIR, 'auditoria.log');

let dirListo: Promise<void> | null = null;

function asegurarDirectorio(): Promise<void> {
  if (!dirListo) {
    dirListo = mkdir(LOG_DIR, { recursive: true }).then(() => undefined);
  }
  return dirListo;
}

export interface EntradaAuditoria {
  usuarioId: number;
  accion: string;
  entidad: string;
  entidadId: number;
  detalle?: string;
}

export async function registrarAuditoria(entrada: EntradaAuditoria): Promise<void> {
  await asegurarDirectorio();

  const linea = {
    fecha: new Date().toISOString(),
    ...entrada,
  };

  const json = JSON.stringify(linea);
  if (env.NODE_ENV === 'production') console.info(`[auditoria] ${json}`);
  await appendFile(LOG_FILE, `${json}\n`, 'utf8');
}
