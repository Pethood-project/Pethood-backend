/**
 * Cliente HTTP de Mercado Pago (spec 027): OAuth y búsqueda de pagos recibidos. No sabe nada
 * del dominio de PetHood y nunca loguea tokens ni cuerpos de respuesta.
 */
const API = 'https://api.mercadopago.com';
const AUTORIZACION = 'https://auth.mercadopago.com/authorization';

/** El token ya no vale (revocado o vencido): la conexión hay que volver a vincularla. */
export class TokenMercadoPagoInvalido extends Error {
  constructor() {
    super('Mercado Pago rechazó el token');
  }
}

export interface TokensMp {
  accessToken: string;
  refreshToken: string;
  vence: Date;
  mpUserId: string;
}

export interface PagoMp {
  id: string;
  monto: number;
  fecha: Date;
  estado: string;
  tipoDoc: string | null;
  numeroDoc: string | null;
}

export function urlAutorizacion(opciones: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: opciones.clientId,
    response_type: 'code',
    platform_id: 'mp',
    state: opciones.state,
    redirect_uri: opciones.redirectUri,
    code_challenge: opciones.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTORIZACION}?${params.toString()}`;
}

async function pedirToken(cuerpo: Record<string, string>): Promise<TokensMp> {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(cuerpo),
    // Sin tope, un /oauth/token colgado dejaba el cron corriendo en paralelo con el siguiente.
    signal: AbortSignal.timeout(10000),
  });
  // Rechazo del código o del refresh token: hay que volver a vincular. Cualquier otro error
  // (caída, 5xx) es transitorio y se reintenta.
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new TokenMercadoPagoInvalido();
  }
  if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status} al pedir el token`);

  const datos = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user_id: number | string;
  };

  return {
    accessToken: datos.access_token,
    refreshToken: datos.refresh_token,
    vence: new Date(Date.now() + datos.expires_in * 1000),
    mpUserId: String(datos.user_id),
  };
}

export function canjearCodigo(opciones: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokensMp> {
  return pedirToken({
    client_id: opciones.clientId,
    client_secret: opciones.clientSecret,
    grant_type: 'authorization_code',
    code: opciones.code,
    redirect_uri: opciones.redirectUri,
    code_verifier: opciones.codeVerifier,
  });
}

/** El `refresh_token` cambia en cada renovación: hay que guardar el nuevo. */
export function renovarToken(opciones: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TokensMp> {
  return pedirToken({
    client_id: opciones.clientId,
    client_secret: opciones.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: opciones.refreshToken,
  });
}

interface PagoCrudo {
  id: number | string;
  transaction_amount: number;
  date_created: string;
  status: string;
  payer?: { identification?: { type?: string | null; number?: string | number | null } };
}

/**
 * Pagos recibidos por un monto exacto en un rango de fechas. El filtro por monto lo aplica
 * Mercado Pago (verificado en el spike): los demás movimientos de la cuenta no llegan acá.
 */
export async function buscarPagos(
  accessToken: string,
  filtro: { monto: number; desde: Date; hasta: Date },
  timeoutMs = 5000,
): Promise<PagoMp[]> {
  const params = new URLSearchParams({
    sort: 'date_created',
    criteria: 'asc',
    range: 'date_created',
    begin_date: filtro.desde.toISOString(),
    end_date: filtro.hasta.toISOString(),
    transaction_amount: String(filtro.monto),
    limit: '50',
  });

  const res = await fetch(`${API}/v1/payments/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401 || res.status === 403) throw new TokenMercadoPagoInvalido();
  if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status} al buscar pagos`);

  const { results = [] } = (await res.json()) as { results?: PagoCrudo[] };

  return results.map((pago) => ({
    id: String(pago.id),
    monto: pago.transaction_amount,
    fecha: new Date(pago.date_created),
    estado: pago.status,
    tipoDoc: pago.payer?.identification?.type ?? null,
    numeroDoc:
      pago.payer?.identification?.number != null ? String(pago.payer.identification.number) : null,
  }));
}
