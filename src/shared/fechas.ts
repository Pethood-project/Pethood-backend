import { AppError } from '../middlewares/errorHandler';

const REGEX_DMY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/** Parsea fecha de nacimiento en DD/MM/AAAA o ISO. Año ≥ 1900 y no futura. */
export function parsearFechaNacimiento(valor: string): Date {
  const recortado = valor.trim();
  let fecha: Date;

  const dmy = REGEX_DMY.exec(recortado);
  if (dmy) {
    const dia = Number(dmy[1]);
    const mes = Number(dmy[2]);
    const anio = Number(dmy[3]);
    fecha = new Date(Date.UTC(anio, mes - 1, dia));

    if (
      fecha.getUTCFullYear() !== anio ||
      fecha.getUTCMonth() !== mes - 1 ||
      fecha.getUTCDate() !== dia
    ) {
      throw new AppError('VALIDACION', 'La fecha de nacimiento no es válida.', 400);
    }
  } else {
    fecha = new Date(recortado);
    if (Number.isNaN(fecha.getTime())) {
      throw new AppError(
        'VALIDACION',
        'La fecha de nacimiento no es válida. Usá el formato DD/MM/AAAA.',
        400,
      );
    }
  }

  if (fecha.getUTCFullYear() < 1900) {
    throw new AppError('VALIDACION', 'La fecha de nacimiento no puede ser anterior a 1900.', 400);
  }

  const hoy = new Date();
  const inicioHoyUtc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  if (fecha.getTime() >= inicioHoyUtc) {
    throw new AppError('VALIDACION', 'La fecha de nacimiento debe ser anterior a hoy.', 400);
  }

  return fecha;
}
