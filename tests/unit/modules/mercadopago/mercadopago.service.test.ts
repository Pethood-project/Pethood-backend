import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../src/middlewares/errorHandler';
import * as cliente from '../../../../src/modules/mercadopago/mercadopago.cliente';
import { leerEstado, secretoDelState } from '../../../../src/modules/mercadopago/mercadopago.oauth';
import * as repo from '../../../../src/modules/mercadopago/mercadopago.repository';
import * as service from '../../../../src/modules/mercadopago/mercadopago.service';
import { cifrar, descifrar } from '../../../../src/shared/cifrado';
import { registrarAuditoria } from '../../../../src/shared/logAuditoria';

const { envMock } = vi.hoisted(() => ({
  envMock: {} as Record<string, string | undefined>,
}));

vi.mock('../../../../src/config/env', () => ({ env: envMock }));
vi.mock('../../../../src/modules/mercadopago/mercadopago.repository', async (importOriginal) => {
  const real = await importOriginal<typeof repo>();
  return {
    ESTADO_CONEXION: real.ESTADO_CONEXION,
    buscarRefugioDeUsuario: vi.fn(),
    buscarConexion: vi.fn(),
    guardarConexion: vi.fn(),
    actualizarTokens: vi.fn(),
    marcarRevincular: vi.fn(),
    darDeBaja: vi.fn(),
    listarPorVencer: vi.fn(),
  };
});
vi.mock('../../../../src/modules/mercadopago/mercadopago.cliente', async (importOriginal) => {
  const real = await importOriginal<typeof cliente>();
  return { ...real, canjearCodigo: vi.fn(), renovarToken: vi.fn() };
});
vi.mock('../../../../src/shared/logAuditoria');

const CLAVE = randomBytes(32).toString('base64');
const SECRETO = 'secreto-de-prueba-largo';
const USUARIO = 7;
const REFUGIO = 3;
const VENCE = new Date('2027-03-30T00:00:00Z');

function configurar(completo = true): void {
  Object.assign(envMock, {
    MP_CLIENT_ID: completo ? '123' : undefined,
    MP_CLIENT_SECRET: 's',
    MP_REDIRECT_URI: 'https://x.test/api/v1/mercadopago/oauth/callback',
    MP_CLAVE_CIFRADO: CLAVE,
    JWT_SECRET: SECRETO,
  });
}

function conexion(estado = 'VINCULADA', id = 50) {
  return {
    id,
    refugioId: REFUGIO,
    mpUserId: '717',
    accessToken: cifrar('AT-claro', CLAVE),
    refreshToken: cifrar('RT-claro', CLAVE),
    vence: VENCE,
    estado,
    usuarioAlta: USUARIO,
    fechaAlta: new Date('2026-09-30T12:00:00Z'),
    usuarioModificacion: null,
    fechaModificacion: null,
    usuarioBaja: null,
    fechaBaja: null,
  };
}

async function codigoDeError(promesa: Promise<unknown>): Promise<string | undefined> {
  try {
    await promesa;
    return undefined;
  } catch (err) {
    return err instanceof AppError ? err.codigo : 'NO_ES_APP_ERROR';
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  configurar();
  vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: REFUGIO });
  vi.mocked(repo.buscarConexion).mockResolvedValue(null);
});

describe('obtenerEstado', () => {
  it('sin conexión, NO_VINCULADA', async () => {
    expect(await service.obtenerEstado(USUARIO)).toEqual({
      disponible: true,
      estado: 'NO_VINCULADA',
      fechaVinculacion: null,
    });
  });

  it('con conexión, su estado y la fecha', async () => {
    vi.mocked(repo.buscarConexion).mockResolvedValue(conexion());
    expect(await service.obtenerEstado(USUARIO)).toEqual({
      disponible: true,
      estado: 'VINCULADA',
      fechaVinculacion: '2026-09-30T12:00:00.000Z',
    });
  });

  it('sin configuración, disponible: false', async () => {
    configurar(false);
    expect((await service.obtenerEstado(USUARIO)).disponible).toBe(false);
  });
});

describe('iniciarVinculacion', () => {
  it('devuelve la URL de Mercado Pago con PKCE y un state del refugio', async () => {
    const { url } = await service.iniciarVinculacion(USUARIO);
    const params = new URL(url).searchParams;

    expect(url.startsWith('https://auth.mercadopago.com/authorization?')).toBe(true);
    expect(params.get('code_challenge')).toBeTruthy();
    expect(leerEstado(params.get('state')!, secretoDelState(CLAVE), CLAVE)).toMatchObject({
      refugioId: REFUGIO,
      usuarioId: USUARIO,
    });
  });

  it('el state no se firma con el secreto de las sesiones: no sirve como Bearer', async () => {
    const { url } = await service.iniciarVinculacion(USUARIO);
    const state = new URL(url).searchParams.get('state')!;

    expect(() => jwt.verify(state, SECRETO)).toThrow();
  });

  it('sin refugio, SIN_REFUGIO', async () => {
    vi.mocked(repo.buscarRefugioDeUsuario).mockResolvedValue({ refugioId: null });
    expect(await codigoDeError(service.iniciarVinculacion(USUARIO))).toBe('SIN_REFUGIO');
  });

  it('sin configuración, MP_NO_DISPONIBLE', async () => {
    configurar(false);
    expect(await codigoDeError(service.iniciarVinculacion(USUARIO))).toBe('MP_NO_DISPONIBLE');
  });
});

describe('completarVinculacion', () => {
  it('canjea con el verificador del state y guarda los tokens cifrados', async () => {
    const { url } = await service.iniciarVinculacion(USUARIO);
    const state = new URL(url).searchParams.get('state')!;
    const { verificador } = leerEstado(state, secretoDelState(CLAVE), CLAVE);
    vi.mocked(cliente.canjearCodigo).mockResolvedValue({
      accessToken: 'AT-claro',
      refreshToken: 'RT-claro',
      vence: VENCE,
      mpUserId: '717',
    });

    await service.completarVinculacion('codigo', state);

    expect(cliente.canjearCodigo).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'codigo', codeVerifier: verificador }),
    );
    const [refugioId, datos, usuarioId] = vi.mocked(repo.guardarConexion).mock.calls[0]!;
    expect([refugioId, usuarioId]).toEqual([REFUGIO, USUARIO]);
    expect(datos.accessToken).not.toContain('AT-claro');
    expect(descifrar(datos.accessToken, CLAVE)).toBe('AT-claro');
    expect(descifrar(datos.refreshToken, CLAVE)).toBe('RT-claro');
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'VINCULAR', entidadId: REFUGIO }),
    );
  });

  it('state alterado o sin code: VINCULACION_INVALIDA y no guarda nada', async () => {
    expect(await codigoDeError(service.completarVinculacion('codigo', 'basura'))).toBe(
      'VINCULACION_INVALIDA',
    );
    expect(await codigoDeError(service.completarVinculacion(undefined, 'x'))).toBe(
      'VINCULACION_INVALIDA',
    );
    expect(repo.guardarConexion).not.toHaveBeenCalled();
  });
});

describe('desvincular', () => {
  it('da de baja y audita', async () => {
    vi.mocked(repo.darDeBaja).mockResolvedValue(true);

    await service.desvincular(USUARIO);

    expect(repo.darDeBaja).toHaveBeenCalledWith(REFUGIO, USUARIO);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'DESVINCULAR', entidadId: REFUGIO }),
    );
  });
});

describe('tokenDeRefugio', () => {
  it('descifra el token de una conexión vinculada', async () => {
    vi.mocked(repo.buscarConexion).mockResolvedValue(conexion());
    expect(await service.tokenDeRefugio(REFUGIO)).toBe('AT-claro');
  });

  it('null si hay que revincular, si no hay conexión o sin configuración', async () => {
    vi.mocked(repo.buscarConexion).mockResolvedValue(conexion('REVINCULAR'));
    expect(await service.tokenDeRefugio(REFUGIO)).toBeNull();

    vi.mocked(repo.buscarConexion).mockResolvedValue(null);
    expect(await service.tokenDeRefugio(REFUGIO)).toBeNull();

    configurar(false);
    vi.mocked(repo.buscarConexion).mockResolvedValue(conexion());
    expect(await service.tokenDeRefugio(REFUGIO)).toBeNull();
  });
});

describe('renovarTokensPorVencer: sólo un rechazo de Mercado Pago obliga a revincular', () => {
  it('una caída o timeout de Mercado Pago no marca revincular: se reintenta en la próxima corrida', async () => {
    vi.mocked(repo.listarPorVencer).mockResolvedValue([conexion('VINCULADA', 1)]);
    vi.mocked(cliente.renovarToken).mockRejectedValue(new Error('Mercado Pago respondió 503'));

    expect(await service.renovarTokensPorVencer(new Date('2026-09-30T00:00:00Z'))).toBe(0);
    expect(repo.marcarRevincular).not.toHaveBeenCalled();
  });

  it('si se renovó pero no se pudo guardar, sí: el refresh viejo ya no sirve', async () => {
    vi.mocked(repo.listarPorVencer).mockResolvedValue([conexion('VINCULADA', 1)]);
    vi.mocked(cliente.renovarToken).mockResolvedValue({
      accessToken: 'AT2',
      refreshToken: 'RT2',
      vence: VENCE,
      mpUserId: '717',
    });
    vi.mocked(repo.actualizarTokens).mockRejectedValue(new Error('db caída'));

    await service.renovarTokensPorVencer(new Date('2026-09-30T00:00:00Z'));
    expect(repo.marcarRevincular).toHaveBeenCalledWith(1, 1);
  });
});

describe('renovarTokensPorVencer', () => {
  it('renueva con el refresh descifrado, guarda los nuevos cifrados y sigue si uno falla', async () => {
    vi.mocked(repo.listarPorVencer).mockResolvedValue([
      conexion('VINCULADA', 1),
      conexion('VINCULADA', 2),
    ]);
    vi.mocked(cliente.renovarToken)
      .mockRejectedValueOnce(new cliente.TokenMercadoPagoInvalido())
      .mockResolvedValueOnce({
        accessToken: 'AT2',
        refreshToken: 'RT2',
        vence: VENCE,
        mpUserId: '717',
      });

    expect(await service.renovarTokensPorVencer(new Date('2026-09-30T00:00:00Z'))).toBe(1);

    expect(cliente.renovarToken).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'RT-claro' }),
    );
    expect(repo.marcarRevincular).toHaveBeenCalledWith(1, 1);
    const [id, datos] = vi.mocked(repo.actualizarTokens).mock.calls[0]!;
    expect(id).toBe(2);
    expect(descifrar(datos.accessToken, CLAVE)).toBe('AT2');
    expect(descifrar(datos.refreshToken, CLAVE)).toBe('RT2');
  });
});
