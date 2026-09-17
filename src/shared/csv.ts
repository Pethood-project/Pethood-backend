/**
 * Serialización CSV mínima (RFC 4180 básico: comillas si el campo tiene coma, comilla o
 * salto de línea). Transversal a cualquier export masivo (CLAUDE.md regla #12) — no vive
 * en un módulo particular porque más de uno la va a necesitar.
 */
export function escaparCampoCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return '';

  let texto = valor instanceof Date ? valor.toISOString() : String(valor);

  // Varios campos exportados (nombre, apellido, titulo, ubicacion) son texto libre de
  // usuario: si empieza con = + - @ , Excel/Sheets lo interpreta como fórmula al abrir el
  // CSV (CSV formula injection). Comilla simple al inicio lo fuerza a texto plano.
  if (/^[=+\-@\t\r]/.test(texto)) {
    texto = `'${texto}`;
  }

  if (/[",\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

export function filaCsv(campos: unknown[]): string {
  return campos.map(escaparCampoCsv).join(',') + '\n';
}
