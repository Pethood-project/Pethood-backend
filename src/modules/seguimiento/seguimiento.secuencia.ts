/**
 * Reglas de tiempo del seguimiento post-adopción (spec 011, HU-9.1/HU-9.2).
 *
 * Todo acá son funciones puras: no tocan base, HTTP ni el reloj (la fecha "ahora" siempre
 * entra por parámetro). Esa es la razón de que esta lógica viva en su propio archivo y no
 * dentro del service — es la parte con más casos borde del módulo y se testea sola.
 *
 * La secuencia de días NO es configurable: es regla de negocio del sistema, no un catálogo
 * editable por usuarios ni por el panel admin.
 */

export type TipoFlujo = 'Adopcion' | 'Transito';

/**
 * HU-9.2, adopción: DÍAS [2, 5, 5, 5, 7, 7, 14, 14, 30, 30, 60, 90, 180, 365, 365].
 * Son intervalos ENTRE pedidos, no offsets desde la aprobación: el primero llega a los 2
 * días, el segundo 5 días después (día 7), y así. Son 15 pedidos; el último cae el día 1179
 * y después la secuencia se agota.
 */
export const SECUENCIA_ADOPCION = [2, 5, 5, 5, 7, 7, 14, 14, 30, 30, 60, 90, 180, 365, 365];

/**
 * HU-9.2, tránsito: "las primeras veces es siempre [2, 2, 3, 4, 5, 5, ...], luego siempre 5
 * días hasta finalizar". A diferencia de adopción no tiene un final propio: se corta cuando
 * termina el período de tránsito.
 */
export const SECUENCIA_TRANSITO_INICIAL = [2, 2, 3, 4, 5, 5];
export const INTERVALO_TRANSITO_ESTABLE = 5;

/**
 * ⚠️ ASUNCIÓN A CONFIRMAR CON EL EQUIPO (spec 011 §9).
 *
 * HU-9.2 dice que la secuencia de tránsito "depende del periodo de tránsito", pero el modelo
 * de datos no tiene ningún campo con la fecha de fin del tránsito: `Solicitud` solo guarda
 * `fecha_respuesta`. Hasta que se defina dónde vive ese dato se usa este valor por defecto.
 * Está aislado en una sola constante justamente para que ese cambio sea de una línea.
 *
 * NO se reutiliza `Tipo_Solicitud.secuencia_dias`: ese campo está documentado como la ventana
 * de cancelación automática de solicitudes pendientes (6 meses), y significaría dos cosas
 * distintas según el tipo de solicitud.
 */
export const DIAS_TRANSITO_POR_DEFECTO = 180;

/** HU-9.1: el adoptante tiene 48 h desde que llega el pedido para responderlo. */
export const HORAS_PARA_RESPONDER = 48;

/** HU-9.1: terminado el tránsito, "el registro de seguimiento se borra a los 5 días". */
export const DIAS_PARA_BORRAR_TRANSITO = 5;

const MS_POR_DIA = 24 * 60 * 60 * 1000;
const MS_POR_HORA = 60 * 60 * 1000;

export function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * MS_POR_DIA);
}

/** Un pedido de seguimiento: qué número de la secuencia es y qué día le toca. */
export interface PedidoProgramado {
  /** 1-based: el número que ve el usuario en GUI-21. */
  numero: number;
  fecha: Date;
}

/**
 * Todos los pedidos de la secuencia completa, como offsets acumulados desde la aprobación.
 *
 * En adopción la lista es finita por definición. En tránsito se corta al llegar al fin del
 * período: un pedido que caería después de que el tránsito terminó no se programa.
 */
export function programaDeSeguimiento(
  aprobacion: Date,
  tipo: TipoFlujo,
  duracionTransitoDias: number = DIAS_TRANSITO_POR_DEFECTO,
): PedidoProgramado[] {
  const pedidos: PedidoProgramado[] = [];
  let acumulado = 0;

  if (tipo === 'Adopcion') {
    for (const intervalo of SECUENCIA_ADOPCION) {
      acumulado += intervalo;
      pedidos.push({ numero: pedidos.length + 1, fecha: sumarDias(aprobacion, acumulado) });
    }
    return pedidos;
  }

  for (const intervalo of SECUENCIA_TRANSITO_INICIAL) {
    acumulado += intervalo;
    if (acumulado > duracionTransitoDias) return pedidos;
    pedidos.push({ numero: pedidos.length + 1, fecha: sumarDias(aprobacion, acumulado) });
  }

  // Tramo estable: cada 5 días hasta que se termina el período de tránsito.
  while (acumulado + INTERVALO_TRANSITO_ESTABLE <= duracionTransitoDias) {
    acumulado += INTERVALO_TRANSITO_ESTABLE;
    pedidos.push({ numero: pedidos.length + 1, fecha: sumarDias(aprobacion, acumulado) });
  }

  return pedidos;
}

/**
 * Los pedidos que a la fecha `ahora` ya tendrían que existir. Un pedido nunca se materializa
 * por adelantado: el adoptante no puede responder algo que todavía no le pidieron.
 */
export function pedidosExigiblesA(
  aprobacion: Date,
  tipo: TipoFlujo,
  ahora: Date,
  duracionTransitoDias?: number,
): PedidoProgramado[] {
  return programaDeSeguimiento(aprobacion, tipo, duracionTransitoDias).filter(
    (pedido) => pedido.fecha.getTime() <= ahora.getTime(),
  );
}

/** Cuándo llega el próximo pedido, o null si la secuencia ya se agotó (GUI-21). */
export function proximoAviso(
  aprobacion: Date,
  tipo: TipoFlujo,
  ahora: Date,
  duracionTransitoDias?: number,
): Date | null {
  const siguiente = programaDeSeguimiento(aprobacion, tipo, duracionTransitoDias).find(
    (pedido) => pedido.fecha.getTime() > ahora.getTime(),
  );

  return siguiente?.fecha ?? null;
}

/** HU-9.1: la ventana de respuesta de un pedido son 48 h desde que llegó. */
export function plazoDeRespuesta(fechaPedido: Date): Date {
  return new Date(fechaPedido.getTime() + HORAS_PARA_RESPONDER * MS_POR_HORA);
}

export function finDeTransito(
  aprobacion: Date,
  duracionTransitoDias: number = DIAS_TRANSITO_POR_DEFECTO,
): Date {
  return sumarDias(aprobacion, duracionTransitoDias);
}

/**
 * HU-9.1: pasados 5 días del fin del tránsito, los pedidos de esa solicitud se dan de baja.
 * Solo aplica a tránsito — una adopción no "termina".
 */
export function correspondeBorrarSeguimientos(
  aprobacion: Date,
  tipo: TipoFlujo,
  ahora: Date,
  duracionTransitoDias?: number,
): boolean {
  if (tipo !== 'Transito') return false;

  const limite = sumarDias(
    finDeTransito(aprobacion, duracionTransitoDias),
    DIAS_PARA_BORRAR_TRANSITO,
  );

  return ahora.getTime() > limite.getTime();
}

/**
 * HU-9.2: las preguntas son "precargadas y agregadas de manera aleatoria". Se evita repetir
 * mientras queden preguntas sin usar en esa solicitud; agotado el catálogo se vuelve a
 * sortear sobre todas, que es preferible a quedarse sin pregunta (adopción llega a 15
 * pedidos y el catálogo puede ser más chico).
 *
 * `aleatorio` entra por parámetro para poder testear la elección sin depender de Math.random.
 */
export function elegirPregunta<T extends { id: number }>(
  preguntas: T[],
  idsYaUsados: number[],
  aleatorio: () => number = Math.random,
): T | null {
  if (preguntas.length === 0) return null;

  const usados = new Set(idsYaUsados);
  const sinUsar = preguntas.filter((pregunta) => !usados.has(pregunta.id));
  const candidatas = sinUsar.length > 0 ? sinUsar : preguntas;

  const indice = Math.floor(aleatorio() * candidatas.length);
  // Math.random() nunca devuelve 1, pero un `aleatorio` inyectado podría: se acota igual.
  return candidatas[Math.min(indice, candidatas.length - 1)] ?? null;
}
