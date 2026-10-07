import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buscarPagos,
  canjearCodigo,
  TokenMercadoPagoInvalido,
  urlAutorizacion,
} from '../../../../src/modules/mercadopago/mercadopago.cliente';

const fetchMock = vi.fn();

function respuesta(status: number, cuerpo: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => cuerpo };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('urlAutorizacion', () => {
  it('arma la URL de OAuth con PKCE S256', () => {
    const url = new URL(
      urlAutorizacion({
        clientId: '123',
        redirectUri: 'https://x.test/cb',
        state: 'st',
        codeChallenge: 'ch',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://auth.mercadopago.com/authorization');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '123',
      response_type: 'code',
      platform_id: 'mp',
      state: 'st',
      redirect_uri: 'https://x.test/cb',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });
});

describe('canjearCodigo', () => {
  it('manda el código y el verificador, y calcula el vencimiento', async () => {
    fetchMock.mockResolvedValue(
      respuesta(200, {
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 15552000,
        user_id: 717,
      }),
    );
    const antes = Date.now();

    const tokens = await canjearCodigo({
      clientId: '1',
      clientSecret: 's',
      code: 'c',
      redirectUri: 'https://x.test/cb',
      codeVerifier: 'v',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.mercadopago.com/oauth/token');
    expect(JSON.parse(init.body)).toEqual({
      client_id: '1',
      client_secret: 's',
      grant_type: 'authorization_code',
      code: 'c',
      redirect_uri: 'https://x.test/cb',
      code_verifier: 'v',
    });
    expect(tokens).toMatchObject({ accessToken: 'AT', refreshToken: 'RT', mpUserId: '717' });
    expect(tokens.vence.getTime()).toBeGreaterThanOrEqual(antes + 15552000 * 1000);
  });

  it('400/401/403 es un rechazo del token (código vencido, refresh revocado)', async () => {
    fetchMock.mockResolvedValue(respuesta(400, { message: 'invalid_grant' }));
    await expect(
      canjearCodigo({
        clientId: '1',
        clientSecret: 's',
        code: 'c',
        redirectUri: 'r',
        codeVerifier: 'v',
      }),
    ).rejects.toBeInstanceOf(TokenMercadoPagoInvalido);
  });

  it('pide el token con timeout', async () => {
    fetchMock.mockResolvedValue(
      respuesta(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 10, user_id: 1 }),
    );
    await canjearCodigo({
      clientId: '1',
      clientSecret: 's',
      code: 'c',
      redirectUri: 'r',
      codeVerifier: 'v',
    });
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });

  it('un error de Mercado Pago no expone el cuerpo', async () => {
    fetchMock.mockResolvedValue(respuesta(500, { message: 'boom' }));
    await expect(
      canjearCodigo({
        clientId: '1',
        clientSecret: 's',
        code: 'c',
        redirectUri: 'r',
        codeVerifier: 'v',
      }),
    ).rejects.toThrow('Mercado Pago respondió 500 al pedir el token');
  });
});

describe('buscarPagos', () => {
  const filtro = {
    monto: 5000,
    desde: new Date('2026-09-29T00:00:00Z'),
    hasta: new Date('2026-10-02T00:00:00Z'),
  };

  it('filtra por monto y fechas del lado de Mercado Pago y mapea lo justo', async () => {
    fetchMock.mockResolvedValue(
      respuesta(200, {
        results: [
          {
            id: 181629377454,
            transaction_amount: 5000,
            date_created: '2026-09-30T11:58:47.000-04:00',
            status: 'approved',
            payer: { identification: { type: 'CUIL', number: '20301234569' }, email: 'x@y' },
          },
        ],
      }),
    );

    const pagos = await buscarPagos('AT', filtro);

    const [url, init] = fetchMock.mock.calls[0]!;
    const params = new URL(url).searchParams;
    expect(params.get('transaction_amount')).toBe('5000');
    expect(params.get('range')).toBe('date_created');
    expect(params.get('begin_date')).toBe('2026-09-29T00:00:00.000Z');
    expect(init.headers.Authorization).toBe('Bearer AT');
    expect(pagos).toEqual([
      {
        id: '181629377454',
        monto: 5000,
        fecha: new Date('2026-09-30T15:58:47.000Z'),
        estado: 'approved',
        tipoDoc: 'CUIL',
        numeroDoc: '20301234569',
      },
    ]);
  });

  it('401 o 403 es un token inválido', async () => {
    fetchMock.mockResolvedValue(respuesta(401, {}));
    await expect(buscarPagos('AT', filtro)).rejects.toBeInstanceOf(TokenMercadoPagoInvalido);
    fetchMock.mockResolvedValue(respuesta(403, {}));
    await expect(buscarPagos('AT', filtro)).rejects.toBeInstanceOf(TokenMercadoPagoInvalido);
  });
});
