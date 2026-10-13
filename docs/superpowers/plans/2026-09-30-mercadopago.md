# Confirmación automática con Mercado Pago + DNI obligatorio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar la spec 027. Primero, que cada refugio vincule su cuenta de Mercado Pago por OAuth y que las donaciones Pendientes se confirmen solas cuando llega una transferencia del mismo monto y el mismo DNI. Además, el DNI pasa a ser obligatorio (registro, «Editar perfil» y al donar).

**Architecture:** El módulo backend nuevo `src/modules/mercadopago/` se ocupa de OAuth con PKCE, los tokens cifrados y el cliente HTTP de Mercado Pago. La conciliación vive en el módulo de campañas: el emparejamiento es una función pura (`campanias.conciliacion.ts`) y el servicio confirma con la misma transición que la confirmación manual. La corren dos caminos: `donar()` en el acto, y el cron `src/jobs/conciliar-donaciones-mp.job.ts` cada 5 minutos, que además renueva los tokens. El DNI se carga una sola vez con `PATCH /usuarios/me/dni`. En mobile hay una tarjeta «Mercado Pago» en «Perfil del refugio», el campo DNI en el registro y en «Editar perfil», y el pedido de DNI en «Donar».

**Tech Stack:** Express 5, TypeScript, Prisma 5, Zod 3, Vitest, `node:crypto` (AES-256-GCM, SHA-256), `jsonwebtoken` y `fetch` nativo en el backend. Expo SDK 57, Expo Router, `expo-web-browser` y `node:test` en mobile.

**Spec:** `docs/specs/027-mercadopago.md` (APROBADA). Depende de `docs/specs/026-campanias.md`.

## Global Constraints

- **Sin commits en ningún paso**: preferencia explícita del usuario. Todo queda como cambios locales en las ramas `feature/mod12-campanias` de los dos repos.
- No tocar `docker-compose.yml` (cambio local del usuario) ni migraciones ya aplicadas.
- Tokens de Mercado Pago: cifrados con AES-256-GCM (`MP_CLAVE_CIFRADO`, 32 bytes en base64), **nunca** en respuestas, logs ni auditoría.
- Sin `MP_CLIENT_ID`/`MP_CLIENT_SECRET`/`MP_REDIRECT_URI`/`MP_CLAVE_CIFRADO` el módulo queda apagado (`disponible: false`) y todo funciona como en la spec 026.
- Match: pago `approved` + monto exacto (en centavos) + DNI del donante = DNI del CUIL/CUIT/DNI del pagador + `date_created` entre 24 h antes y 72 h después del alta de la donación + pago no usado. Dos Pendientes que matchean: la más vieja primero.
- Consulta a Mercado Pago filtrada por `transaction_amount` y rango de fechas; nunca se guarda ni se loguea un pago que no matchea.
- Timeout de 5 s a Mercado Pago dentro de `donar()`; si falla, la donación queda Pendiente sin error.
- DNI: 7 u 8 dígitos, único. Mensajes literales: «El DNI es obligatorio.», «El DNI debe tener 7 u 8 dígitos numéricos.», `DNI_YA_CARGADO` «Tu DNI ya está cargado. Si hay un error, escribinos desde Soporte.», `DNI_DUPLICADO` «Ya existe una cuenta con ese DNI.», `DNI_REQUERIDO` 409 «Cargá tu DNI para donar.».
- Textos de UI en voseo: «Vinculá tu cuenta de Mercado Pago para que las donaciones se confirmen solas.», «Vincular Mercado Pago», «Desvincular», «Mercado Pago dejó de aceptar la conexión. Volvé a vincularla.», «Si transferiste desde una cuenta a tu nombre, se confirma sola en unos minutos.», «Para registrar tu donación necesitamos tu DNI.», «Guardar y donar», «¡Listo! Tu donación ya se sumó a la campaña.», «Confirmada por Mercado Pago», «Para corregirlo, escribinos desde Soporte.», página del callback «Listo, ya vinculaste Mercado Pago. Podés volver a PetHood.».
- Verificación backend por tarea: `npx vitest run <tests>`; al cierre, `npm test`, `npm run lint`, `npx tsc --noEmit -p tsconfig.json` y `npx prettier --check --end-of-line auto "src/**/*.ts" "tests/**/*.ts"` (el `format:check` del repo falla por CRLF, deuda 8). Mobile: `npx tsc --noEmit`, `node --test --experimental-strip-types <archivos>` y `npx expo export --platform web` al final.
- Formatear los archivos nuevos del mobile con el Prettier del backend y opciones explícitas (`--no-config --single-quote --trailing-comma all --print-width 100 --end-of-line auto`). Nunca sobre archivos ajenos enteros: reformatea código de otros.

## Review Focus

- **Token revocado o vencido en medio de la conciliación:** la conexión pasa a `REVINCULAR`, el cron sigue con los demás refugios y la donación queda Pendiente. Test en Task 8 («token inválido marca revincular»).
- **La misma transferencia disputada por el cron y por `donar()` a la vez:** la columna única `donacion_mp_pago_id` hace que el segundo falle con P2002 y se ignore. Test en Task 8 («pago ya usado por otra carrera»).
- **CUIL de 11 dígitos con DNI de 7** (`20-07123456-3`) contra un DNI guardado como `7123456`: tienen que ser iguales. Test en Task 1.
- **State vencido o alterado en el callback:** página de error y no se guarda nada. Test en Task 5.
- **Donar sin DNI desde una app vieja** que no pide el DNI: 409 `DNI_REQUERIDO`, no una donación imposible de conciliar. Test en Task 8.

---

## Parte A — Backend (`PetHood_Back`)

### Task 1: Validación y cifrado compartidos

**Files:**
- Create: `src/shared/validation/documento.ts`, `src/shared/cifrado.ts`
- Modify: `src/shared/validation/schemas.ts` (agregar `dniSchema`)
- Test: `tests/unit/shared/validation/documento.test.ts`, `tests/unit/shared/cifrado.test.ts`

**Interfaces:**
- Produces: `validarDni(valor: unknown): { valido: true; valor: string } | { valido: false; error: string }`; `dniDesdeIdentificacion(tipo?: string | null, numero?: string | number | null): string | null`; `normalizarDni(dni: string): string`; `dniSchema()` (Zod, devuelve `string`); `cifrar(texto: string, claveBase64: string): string`; `descifrar(cifrado: string, claveBase64: string): string`.

- [ ] **Step 1: Tests que fallan**

`tests/unit/shared/validation/documento.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  dniDesdeIdentificacion,
  normalizarDni,
  validarDni,
} from '../../../../src/shared/validation/documento';

describe('validarDni', () => {
  it('acepta 7 u 8 dígitos, con trim', () => {
    expect(validarDni(' 30123456 ')).toEqual({ valido: true, valor: '30123456' });
    expect(validarDni('7123456')).toEqual({ valido: true, valor: '7123456' });
  });

  it('vacío es obligatorio', () => {
    expect(validarDni('')).toEqual({ valido: false, error: 'El DNI es obligatorio.' });
    expect(validarDni(undefined)).toEqual({ valido: false, error: 'El DNI es obligatorio.' });
  });

  it('rechaza otro largo, puntos o letras', () => {
    const error = { valido: false, error: 'El DNI debe tener 7 u 8 dígitos numéricos.' };
    expect(validarDni('123456')).toEqual(error);
    expect(validarDni('30.123.456')).toEqual(error);
    expect(validarDni('3012345A')).toEqual(error);
  });
});

describe('dniDesdeIdentificacion', () => {
  it('saca el DNI de los 8 dígitos del medio de un CUIL o CUIT', () => {
    expect(dniDesdeIdentificacion('CUIL', '20301234569')).toBe('30123456');
    expect(dniDesdeIdentificacion('CUIT', 27301234560)).toBe('30123456');
  });

  it('un DNI de 7 dígitos va con cero adelante en el CUIL y se compara sin él', () => {
    expect(dniDesdeIdentificacion('CUIL', '20071234563')).toBe('7123456');
  });

  it('acepta el DNI directo', () => {
    expect(dniDesdeIdentificacion('DNI', '30123456')).toBe('30123456');
  });

  it('null si no se puede sacar un DNI', () => {
    expect(dniDesdeIdentificacion('CUIL', '123')).toBeNull();
    expect(dniDesdeIdentificacion('PASAPORTE', 'AB123')).toBeNull();
    expect(dniDesdeIdentificacion(null, null)).toBeNull();
  });
});

describe('normalizarDni', () => {
  it('quita ceros a la izquierda para comparar', () => {
    expect(normalizarDni('07123456')).toBe('7123456');
  });
});
```

`tests/unit/shared/cifrado.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cifrar, descifrar } from '../../../src/shared/cifrado';

const CLAVE = randomBytes(32).toString('base64');

describe('cifrar / descifrar', () => {
  it('ida y vuelta', () => {
    expect(descifrar(cifrar('APP_USR-secreto', CLAVE), CLAVE)).toBe('APP_USR-secreto');
  });

  it('el mismo texto cifra distinto cada vez (IV aleatorio) y no contiene el texto', () => {
    const a = cifrar('APP_USR-secreto', CLAVE);
    expect(a).not.toBe(cifrar('APP_USR-secreto', CLAVE));
    expect(a).not.toContain('APP_USR');
  });

  it('un texto alterado no se descifra', () => {
    const [v, iv, tag, datos] = cifrar('APP_USR-secreto', CLAVE).split(':');
    const alterado = [v, iv, tag, Buffer.from('otra cosa').toString('base64')].join(':');
    expect(() => descifrar(alterado, CLAVE)).toThrow();
    expect(datos).toBeTruthy();
  });

  it('con otra clave no se descifra', () => {
    expect(() => descifrar(cifrar('x', CLAVE), randomBytes(32).toString('base64'))).toThrow();
  });

  it('exige una clave de 32 bytes', () => {
    expect(() => cifrar('x', Buffer.from('corta').toString('base64'))).toThrow(
      'La clave de cifrado tiene que tener 32 bytes',
    );
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/unit/shared/validation/documento.test.ts tests/unit/shared/cifrado.test.ts` → FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar**

`src/shared/validation/documento.ts`:

```ts
/**
 * DNI: validación y comparación (spec 027). Funciones puras, sin dependencias.
 *
 * Mercado Pago informa al pagador de una transferencia por CUIL/CUIT (11 dígitos: 2 de tipo,
 * los 8 del DNI con cero adelante si tiene 7, y 1 verificador). Para compararlo con el DNI del
 * usuario se sacan los 8 del medio y se ignoran los ceros a la izquierda.
 */
const REGEX_DNI = /^\d{7,8}$/;

export type ResultadoDni = { valido: true; valor: string } | { valido: false; error: string };

export function validarDni(valor: unknown): ResultadoDni {
  const dni = typeof valor === 'string' ? valor.trim() : '';

  if (dni === '') return { valido: false, error: 'El DNI es obligatorio.' };
  if (!REGEX_DNI.test(dni)) {
    return { valido: false, error: 'El DNI debe tener 7 u 8 dígitos numéricos.' };
  }

  return { valido: true, valor: dni };
}

/** Para comparar: «07123456» y «7123456» son el mismo DNI. */
export function normalizarDni(dni: string): string {
  return dni.replace(/^0+/, '');
}

/** El DNI que sale de la identificación del pagador, o `null` si no se puede saber. */
export function dniDesdeIdentificacion(
  tipo?: string | null,
  numero?: string | number | null,
): string | null {
  const digitos = String(numero ?? '').replace(/\D/g, '');
  const tipoNormalizado = (tipo ?? '').toUpperCase();

  let dni: string | null = null;
  if ((tipoNormalizado === 'CUIL' || tipoNormalizado === 'CUIT') && digitos.length === 11) {
    dni = digitos.slice(2, 10);
  } else if (tipoNormalizado === 'DNI' && REGEX_DNI.test(digitos)) {
    dni = digitos;
  }

  return dni ? normalizarDni(dni) || null : null;
}
```

`src/shared/cifrado.ts`:

```ts
/**
 * Cifrado simétrico para secretos guardados en la base (tokens de Mercado Pago, spec 027).
 *
 * AES-256-GCM: además de ocultar, detecta si el texto cifrado fue alterado. Formato
 * `v1:<iv>:<tag>:<datos>` en base64, con IV aleatorio por mensaje: el mismo token cifra distinto
 * cada vez. La clave es de 32 bytes en base64 y vive en `.env`, nunca en la base.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITMO = 'aes-256-gcm';

function clave(claveBase64: string): Buffer {
  const buffer = Buffer.from(claveBase64, 'base64');
  if (buffer.length !== 32) throw new Error('La clave de cifrado tiene que tener 32 bytes');
  return buffer;
}

export function cifrar(texto: string, claveBase64: string): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv(ALGORITMO, clave(claveBase64), iv);
  const datos = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);

  return [
    VERSION,
    iv.toString('base64'),
    cifrador.getAuthTag().toString('base64'),
    datos.toString('base64'),
  ].join(':');
}

export function descifrar(cifrado: string, claveBase64: string): string {
  const [version, iv, tag, datos] = cifrado.split(':');
  if (version !== VERSION || !iv || !tag || !datos) throw new Error('Formato de cifrado inválido');

  const descifrador = createDecipheriv(ALGORITMO, clave(claveBase64), Buffer.from(iv, 'base64'));
  descifrador.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    descifrador.update(Buffer.from(datos, 'base64')),
    descifrador.final(),
  ]).toString('utf8');
}
```

`src/shared/validation/schemas.ts`: importar `validarDni` desde `./documento` y agregar, junto a los otros schemas:

```ts
/** DNI obligatorio: 7 u 8 dígitos (spec 027). */
export function dniSchema() {
  return z.unknown().transform((valor, ctx) => {
    const resultado = validarDni(valor);

    if (!resultado.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.valor;
  });
}
```

- [ ] **Step 4:** mismo comando → PASS; `npx tsc --noEmit -p tsconfig.json` sin errores.

---

### Task 2: Configuración y modelo

**Files:**
- Modify: `src/config/env.ts`, `.env.example`, `prisma/schema.prisma`, `docs/MODELO_DATOS.md`
- Create: migración `prisma/migrations/<ts>_mp_conexion_donacion_pago/`

**Interfaces:**
- Produces: `env.MP_CLIENT_ID`, `env.MP_CLIENT_SECRET`, `env.MP_REDIRECT_URI`, `env.MP_CLAVE_CIFRADO` (opcionales); `prisma.conexionMercadoPago`; `Donacion.mpPagoId: string | null`; `Refugio.conexionMercadoPago`.

- [ ] **Step 1: env.** En `envSchema` de `src/config/env.ts`, después de las de Google:

```ts
  // Mercado Pago (spec 027). Sin las cuatro, el módulo queda apagado y todo es manual.
  MP_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  MP_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  MP_REDIRECT_URI: z.preprocess(emptyToUndefined, z.string().url().optional()),
  // 32 bytes en base64: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
  MP_CLAVE_CIFRADO: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
```

y en `.env.example`, al final:

```
# Mercado Pago (spec 027): confirmación automática de donaciones. Opcional: sin estas keys
# todo sigue manual. Crear la aplicación en https://www.mercadopago.com.ar/developers/panel/app,
# registrar MP_REDIRECT_URI (HTTPS, termina en /api/v1/mercadopago/oauth/callback) y habilitar
# offline_access. MP_CLAVE_CIFRADO: 32 bytes aleatorios en base64.
MP_CLIENT_ID=
MP_CLIENT_SECRET=
MP_REDIRECT_URI=
MP_CLAVE_CIFRADO=
```

- [ ] **Step 2: schema.** En `prisma/schema.prisma`:
  - `model Refugio`: sumar la relación `conexionMercadoPago ConexionMercadoPago?`.
  - `model Donacion`: después de `motivoRechazo`:

    ```prisma
      /// Id del pago de Mercado Pago que la confirmó sola (spec 027). Único: una transferencia
      /// no confirma dos donaciones.
      mpPagoId         String? @unique @map("donacion_mp_pago_id")
    ```
  - Modelo nuevo, después de `Donacion`:

    ```prisma
    // Conexión de un refugio con su cuenta de Mercado Pago por OAuth (spec 027). Una por
    // refugio: revincular reactiva la misma fila. Los tokens van cifrados (shared/cifrado.ts).
    model ConexionMercadoPago {
      id           Int      @id @default(autoincrement()) @map("conexion_mp_id")
      refugioId    Int      @unique @map("refugio_id")
      mpUserId     String   @map("conexion_mp_user_id")
      accessToken  String   @map("conexion_mp_access_token")
      refreshToken String   @map("conexion_mp_refresh_token")
      vence        DateTime @map("conexion_mp_vence")
      /// VINCULADA | REVINCULAR
      estado       String   @map("conexion_mp_estado")

      usuarioAlta         Int       @map("conexion_mp_usuario_alta")
      fechaAlta           DateTime  @default(now()) @map("conexion_mp_fecha_alta")
      usuarioModificacion Int?      @map("conexion_mp_usuario_modificacion")
      fechaModificacion   DateTime? @map("conexion_mp_fecha_modificacion")
      usuarioBaja         Int?      @map("conexion_mp_usuario_baja")
      fechaBaja           DateTime? @map("conexion_mp_fecha_baja")

      refugio Refugio @relation(fields: [refugioId], references: [id])

      @@map("conexion_mercado_pago")
    }
    ```

- [ ] **Step 3: migración y drift.** Sin `prisma format` (realinea modelos ajenos):

```bash
npx prisma migrate dev --name mp_conexion_donacion_pago
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: se aplica (sólo agrega una tabla y una columna nullable: no necesita SQL a mano) y «No difference detected».

- [ ] **Step 4: MODELO_DATOS.md.** Sección nueva «### Conexion_MercadoPago» con los campos de arriba, la regla «1 a 1 con Refugio, baja lógica al desvincular y tokens borrados» y «Agregada fuera del diagrama de clases (2026-09-30, spec 027)». En «### Donacion», sumar `donacion_mp_pago_id` (único, nullable). En «Relaciones» de Refugio: «1 Refugio → 0..1 Conexion_MercadoPago».

- [ ] **Step 5:** `npm test` → PASS (nada existente se rompe con el cliente regenerado).

---

### Task 3: Cliente HTTP de Mercado Pago

**Files:**
- Create: `src/modules/mercadopago/mercadopago.cliente.ts`
- Test: `tests/unit/modules/mercadopago/mercadopago.cliente.test.ts`

**Interfaces:**
- Produces: `class TokenMercadoPagoInvalido extends Error`; `interface TokensMp { accessToken: string; refreshToken: string; vence: Date; mpUserId: string }`; `interface PagoMp { id: string; monto: number; fecha: Date; estado: string; tipoDoc: string | null; numeroDoc: string | null }`; `urlAutorizacion(o: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string`; `canjearCodigo(o: { clientId; clientSecret; code; redirectUri; codeVerifier }): Promise<TokensMp>`; `renovarToken(o: { clientId; clientSecret; refreshToken }): Promise<TokensMp>`; `buscarPagos(accessToken: string, filtro: { monto: number; desde: Date; hasta: Date }, timeoutMs?: number): Promise<PagoMp[]>`.

- [ ] **Step 1: Test que falla**

```ts
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
      urlAutorizacion({ clientId: '123', redirectUri: 'https://x.test/cb', state: 'st', codeChallenge: 'ch' }),
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
      respuesta(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 15552000, user_id: 717 }),
    );
    const antes = Date.now();

    const tokens = await canjearCodigo({
      clientId: '1', clientSecret: 's', code: 'c', redirectUri: 'https://x.test/cb', codeVerifier: 'v',
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.mercadopago.com/oauth/token');
    expect(JSON.parse(init.body)).toEqual({
      client_id: '1', client_secret: 's', grant_type: 'authorization_code', code: 'c',
      redirect_uri: 'https://x.test/cb', code_verifier: 'v',
    });
    expect(tokens).toMatchObject({ accessToken: 'AT', refreshToken: 'RT', mpUserId: '717' });
    expect(tokens.vence.getTime()).toBeGreaterThanOrEqual(antes + 15552000 * 1000);
  });

  it('un error de Mercado Pago no expone el cuerpo', async () => {
    fetchMock.mockResolvedValue(respuesta(400, { message: 'invalid_grant' }));
    await expect(
      canjearCodigo({ clientId: '1', clientSecret: 's', code: 'c', redirectUri: 'r', codeVerifier: 'v' }),
    ).rejects.toThrow('Mercado Pago respondió 400 al pedir el token');
  });
});

describe('buscarPagos', () => {
  const filtro = { monto: 5000, desde: new Date('2026-09-29T00:00:00Z'), hasta: new Date('2026-10-02T00:00:00Z') };

  it('filtra por monto y fechas del lado de Mercado Pago y mapea lo justo', async () => {
    fetchMock.mockResolvedValue(
      respuesta(200, {
        results: [
          {
            id: 181629377454, transaction_amount: 5000, date_created: '2026-09-30T11:58:47.000-04:00',
            status: 'approved', payer: { identification: { type: 'CUIL', number: '20301234569' }, email: 'x@y' },
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
        id: '181629377454', monto: 5000, fecha: new Date('2026-09-30T15:58:47.000Z'),
        estado: 'approved', tipoDoc: 'CUIL', numeroDoc: '20301234569',
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
```

- [ ] **Step 2:** `npx vitest run tests/unit/modules/mercadopago` → FAIL.

- [ ] **Step 3: Implementar `src/modules/mercadopago/mercadopago.cliente.ts`**

```ts
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
  });
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
```

- [ ] **Step 4:** PASS.

---

### Task 4: Repository y `state` de la vinculación

**Files:**
- Create: `src/modules/mercadopago/mercadopago.repository.ts`, `src/modules/mercadopago/mercadopago.oauth.ts`
- Test: `tests/unit/modules/mercadopago/mercadopago.oauth.test.ts`

**Interfaces:**
- Produces (oauth): `generarPkce(): { verificador: string; desafio: string }`; `interface EstadoVinculacion { refugioId: number; usuarioId: number; verificador: string }`; `firmarEstado(e: EstadoVinculacion, secreto: string, claveCifrado: string): string`; `leerEstado(state: string, secreto: string, claveCifrado: string): EstadoVinculacion` (tira si venció o fue alterado).
- Produces (repo): `buscarRefugioDeUsuario(usuarioId): Promise<{ refugioId: number | null } | null>`; `buscarConexion(refugioId)`; `guardarConexion(refugioId, datos: { mpUserId; accessToken; refreshToken; vence }, usuarioId)`; `actualizarTokens(id, datos: { accessToken; refreshToken; vence }, usuarioId)`; `marcarRevincular(id, usuarioId)`; `darDeBaja(refugioId, usuarioId): Promise<boolean>`; `listarPorVencer(limite: Date)`.

- [ ] **Step 1: Test que falla**

```ts
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { firmarEstado, generarPkce, leerEstado } from '../../../../src/modules/mercadopago/mercadopago.oauth';

const SECRETO = 'secreto-de-prueba-largo';
const CLAVE = randomBytes(32).toString('base64');

describe('generarPkce', () => {
  it('el desafío es el SHA-256 del verificador en base64url', () => {
    const { verificador, desafio } = generarPkce();
    expect(verificador.length).toBeGreaterThanOrEqual(43);
    expect(desafio).toBe(createHash('sha256').update(verificador).digest('base64url'));
  });
});

describe('state firmado', () => {
  it('ida y vuelta, sin el verificador en claro', () => {
    const state = firmarEstado({ refugioId: 3, usuarioId: 7, verificador: 'v'.repeat(64) }, SECRETO, CLAVE);
    expect(state).not.toContain('v'.repeat(20));
    expect(leerEstado(state, SECRETO, CLAVE)).toEqual({ refugioId: 3, usuarioId: 7, verificador: 'v'.repeat(64) });
  });

  it('alterado o firmado con otro secreto, tira', () => {
    const state = firmarEstado({ refugioId: 3, usuarioId: 7, verificador: 'v' }, SECRETO, CLAVE);
    expect(() => leerEstado(`${state}x`, SECRETO, CLAVE)).toThrow();
    expect(() => leerEstado(state, 'otro-secreto-largo', CLAVE)).toThrow();
  });

  it('vencido, tira', () => {
    const vencido = jwt.sign({ r: 3, u: 7, v: 'x', exp: Math.floor(Date.now() / 1000) - 10 }, SECRETO, {
      audience: 'mp-vinculacion',
    });
    expect(() => leerEstado(vencido, SECRETO, CLAVE)).toThrow();
  });
});
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Implementar**

`src/modules/mercadopago/mercadopago.oauth.ts`:

```ts
/**
 * `state` y PKCE de la vinculación con Mercado Pago (spec 027 §6.9).
 *
 * El `state` es un JWT firmado que vence a los 10 minutos (lo mismo que el código de Mercado
 * Pago) y lleva el refugio, el usuario y el verificador de PKCE **cifrado**: pasa por el
 * navegador y por Mercado Pago, así que no puede ir en claro. No se guarda en ningún lado
 * (sesión stateless, CONSTITUTION): el código de Mercado Pago ya es de un solo uso.
 */
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { cifrar, descifrar } from '../../shared/cifrado';

const AUDIENCIA = 'mp-vinculacion';

export function generarPkce(): { verificador: string; desafio: string } {
  const verificador = randomBytes(48).toString('base64url');
  const desafio = createHash('sha256').update(verificador).digest('base64url');
  return { verificador, desafio };
}

export interface EstadoVinculacion {
  refugioId: number;
  usuarioId: number;
  verificador: string;
}

export function firmarEstado(
  estado: EstadoVinculacion,
  secreto: string,
  claveCifrado: string,
): string {
  return jwt.sign(
    { r: estado.refugioId, u: estado.usuarioId, v: cifrar(estado.verificador, claveCifrado) },
    secreto,
    { expiresIn: '10m', audience: AUDIENCIA },
  );
}

export function leerEstado(state: string, secreto: string, claveCifrado: string): EstadoVinculacion {
  const datos = jwt.verify(state, secreto, { audience: AUDIENCIA }) as {
    r: number;
    u: number;
    v: string;
  };
  return { refugioId: datos.r, usuarioId: datos.u, verificador: descifrar(datos.v, claveCifrado) };
}
```

`src/modules/mercadopago/mercadopago.repository.ts`:

```ts
import { prisma } from '../../shared/prisma';
import { datosAlta, datosBaja, datosModificacion } from '../../shared/auditoria';

export const ESTADO_CONEXION = { VINCULADA: 'VINCULADA', REVINCULAR: 'REVINCULAR' } as const;

export function buscarRefugioDeUsuario(usuarioId: number) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: { refugioId: true },
  });
}

/** La conexión vigente del refugio (no dada de baja), con los tokens cifrados. */
export function buscarConexion(refugioId: number) {
  return prisma.conexionMercadoPago.findFirst({ where: { refugioId, fechaBaja: null } });
}

/** Vincular o revincular: una fila por refugio, que se reactiva si estaba dada de baja. */
export function guardarConexion(
  refugioId: number,
  datos: { mpUserId: string; accessToken: string; refreshToken: string; vence: Date },
  usuarioId: number,
) {
  return prisma.conexionMercadoPago.upsert({
    where: { refugioId },
    create: { refugioId, ...datos, estado: ESTADO_CONEXION.VINCULADA, ...datosAlta(usuarioId) },
    update: {
      ...datos,
      estado: ESTADO_CONEXION.VINCULADA,
      usuarioBaja: null,
      fechaBaja: null,
      ...datosModificacion(usuarioId),
    },
  });
}

export function actualizarTokens(
  id: number,
  datos: { accessToken: string; refreshToken: string; vence: Date },
  usuarioId: number,
) {
  return prisma.conexionMercadoPago.update({
    where: { id },
    data: { ...datos, ...datosModificacion(usuarioId) },
  });
}

export function marcarRevincular(id: number, usuarioId: number) {
  return prisma.conexionMercadoPago.update({
    where: { id },
    data: { estado: ESTADO_CONEXION.REVINCULAR, ...datosModificacion(usuarioId) },
  });
}

/** Desvincular: baja lógica y los tokens se borran (no quedan secretos de más). */
export async function darDeBaja(refugioId: number, usuarioId: number): Promise<boolean> {
  const { count } = await prisma.conexionMercadoPago.updateMany({
    where: { refugioId, fechaBaja: null },
    data: { accessToken: '', refreshToken: '', ...datosBaja(usuarioId) },
  });
  return count === 1;
}

export function listarPorVencer(limite: Date) {
  return prisma.conexionMercadoPago.findMany({
    where: { fechaBaja: null, estado: ESTADO_CONEXION.VINCULADA, vence: { lte: limite } },
  });
}
```

- [ ] **Step 4:** PASS; `npx tsc --noEmit -p tsconfig.json` sin errores.

---

### Task 5: Servicio de Mercado Pago

**Files:**
- Create: `src/modules/mercadopago/mercadopago.service.ts`
- Test: `tests/unit/modules/mercadopago/mercadopago.service.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3 y 4; `env`; `registrarAuditoria`; `USUARIO_SISTEMA_ID`.
- Produces: `disponible(): boolean`; `obtenerEstado(usuarioId): Promise<EstadoConexionDto>` con `EstadoConexionDto = { disponible: boolean; estado: 'NO_VINCULADA' | 'VINCULADA' | 'REVINCULAR'; fechaVinculacion: string | null }`; `iniciarVinculacion(usuarioId): Promise<{ url: string }>`; `completarVinculacion(code: string | undefined, state: string | undefined): Promise<void>`; `desvincular(usuarioId): Promise<void>`; `tokenDeRefugio(refugioId): Promise<string | null>`; `marcarTokenInvalido(refugioId): Promise<void>`; `renovarTokensPorVencer(ahora?: Date): Promise<number>`.

- [ ] **Step 1: Test que falla.** Mockear `../../../../src/config/env` (con `vi.mock` devolviendo `{ env: { MP_CLIENT_ID: '1', MP_CLIENT_SECRET: 's', MP_REDIRECT_URI: 'https://x.test/cb', MP_CLAVE_CIFRADO: CLAVE, JWT_SECRET: 'secreto-de-prueba-largo' } }`, con `CLAVE` de 32 bytes definida con `vi.hoisted`), el repository, el cliente y `logAuditoria`. Casos:
  - `obtenerEstado` → `NO_VINCULADA` sin conexión; `VINCULADA` con conexión y `fechaVinculacion` ISO; `disponible: false` si `MP_CLIENT_ID` falta (reasignar el mock).
  - `iniciarVinculacion` → la URL empieza con `https://auth.mercadopago.com/authorization`, lleva `code_challenge` y un `state` que `leerEstado` abre con `refugioId` del usuario; sin refugio → `SIN_REFUGIO`; sin configuración → `MP_NO_DISPONIBLE` (503).
  - `completarVinculacion` con un `state` válido → `canjearCodigo` recibe el `code_verifier` del state, `guardarConexion` recibe tokens **cifrados** (`not.toContain('AT-claro')`) y se audita `VINCULAR`; con `state` alterado o sin `code` → `VINCULACION_INVALIDA` y `guardarConexion` no se llama.
  - `desvincular` → `darDeBaja(refugioId, usuarioId)` y auditoría `DESVINCULAR`.
  - `tokenDeRefugio` → descifra el access token de una conexión `VINCULADA`; `null` si `REVINCULAR`, sin conexión o sin configuración.
  - `renovarTokensPorVencer` → llama `renovarToken` con el refresh descifrado y guarda los nuevos cifrados; si `renovarToken` tira, marca `REVINCULAR` y sigue con la siguiente.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Implementar**

```ts
/**
 * Conexión de cada refugio con su cuenta de Mercado Pago (spec 027): vincular por OAuth con
 * PKCE, desvincular, dar el token vigente para conciliar y renovarlo antes de que venza.
 */
import { env } from '../../config/env';
import { AppError } from '../../middlewares/errorHandler';
import { USUARIO_SISTEMA_ID } from '../../shared/auditoria';
import { cifrar, descifrar } from '../../shared/cifrado';
import { registrarAuditoria } from '../../shared/logAuditoria';
import * as cliente from './mercadopago.cliente';
import { firmarEstado, generarPkce, leerEstado } from './mercadopago.oauth';
import * as repo from './mercadopago.repository';

/** Renovar los tokens que vencen antes de esto (duran 180 días). */
const MARGEN_RENOVACION_MS = 30 * 24 * 60 * 60 * 1000;

export interface EstadoConexionDto {
  disponible: boolean;
  estado: 'NO_VINCULADA' | 'VINCULADA' | 'REVINCULAR';
  fechaVinculacion: string | null;
}

function config() {
  const { MP_CLIENT_ID, MP_CLIENT_SECRET, MP_REDIRECT_URI, MP_CLAVE_CIFRADO } = env;
  if (!MP_CLIENT_ID || !MP_CLIENT_SECRET || !MP_REDIRECT_URI || !MP_CLAVE_CIFRADO) return null;
  return {
    clientId: MP_CLIENT_ID,
    clientSecret: MP_CLIENT_SECRET,
    redirectUri: MP_REDIRECT_URI,
    clave: MP_CLAVE_CIFRADO,
  };
}

/** Sin configuración el módulo queda apagado y todo sigue manual (spec 027 §3). */
export function disponible(): boolean {
  return config() !== null;
}

function exigirConfig() {
  const c = config();
  if (!c) {
    throw new AppError('MP_NO_DISPONIBLE', 'La conexión con Mercado Pago no está disponible.', 503);
  }
  return c;
}

async function refugioDe(usuarioId: number): Promise<number> {
  const usuario = await repo.buscarRefugioDeUsuario(usuarioId);
  if (!usuario?.refugioId) {
    throw new AppError('SIN_REFUGIO', 'Tu usuario no está asociado a ningún refugio', 403);
  }
  return usuario.refugioId;
}

export async function obtenerEstado(usuarioId: number): Promise<EstadoConexionDto> {
  const refugioId = await refugioDe(usuarioId);
  const conexion = await repo.buscarConexion(refugioId);

  return {
    disponible: disponible(),
    estado: conexion ? (conexion.estado as 'VINCULADA' | 'REVINCULAR') : 'NO_VINCULADA',
    fechaVinculacion: conexion?.fechaAlta.toISOString() ?? null,
  };
}

export async function iniciarVinculacion(usuarioId: number): Promise<{ url: string }> {
  const c = exigirConfig();
  const refugioId = await refugioDe(usuarioId);
  const { verificador, desafio } = generarPkce();
  const state = firmarEstado({ refugioId, usuarioId, verificador }, env.JWT_SECRET, c.clave);

  return {
    url: cliente.urlAutorizacion({
      clientId: c.clientId,
      redirectUri: c.redirectUri,
      state,
      codeChallenge: desafio,
    }),
  };
}

function vinculacionInvalida(): AppError {
  return new AppError(
    'VINCULACION_INVALIDA',
    'El enlace de vinculación venció o no es válido. Volvé a intentarlo desde la app.',
    400,
  );
}

/** El callback: el refugio sale del `state` firmado, nunca de un parámetro suelto. */
export async function completarVinculacion(
  code: string | undefined,
  state: string | undefined,
): Promise<void> {
  const c = exigirConfig();
  if (!code || !state) throw vinculacionInvalida();

  let estado;
  try {
    estado = leerEstado(state, env.JWT_SECRET, c.clave);
  } catch {
    throw vinculacionInvalida();
  }

  let tokens: cliente.TokensMp;
  try {
    tokens = await cliente.canjearCodigo({
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      code,
      redirectUri: c.redirectUri,
      codeVerifier: estado.verificador,
    });
  } catch {
    throw vinculacionInvalida();
  }

  await repo.guardarConexion(
    estado.refugioId,
    {
      mpUserId: tokens.mpUserId,
      accessToken: cifrar(tokens.accessToken, c.clave),
      refreshToken: cifrar(tokens.refreshToken, c.clave),
      vence: tokens.vence,
    },
    estado.usuarioId,
  );

  await registrarAuditoria({
    usuarioId: estado.usuarioId,
    accion: 'VINCULAR',
    entidad: 'ConexionMercadoPago',
    entidadId: estado.refugioId,
    detalle: `mpUserId=${tokens.mpUserId}`,
  });
}

export async function desvincular(usuarioId: number): Promise<void> {
  const refugioId = await refugioDe(usuarioId);
  if (!(await repo.darDeBaja(refugioId, usuarioId))) return;

  await registrarAuditoria({
    usuarioId,
    accion: 'DESVINCULAR',
    entidad: 'ConexionMercadoPago',
    entidadId: refugioId,
  });
}

/** Token vigente para conciliar, o `null` si el refugio no puede confirmar solo. */
export async function tokenDeRefugio(refugioId: number): Promise<string | null> {
  const c = config();
  if (!c) return null;

  const conexion = await repo.buscarConexion(refugioId);
  if (!conexion || conexion.estado !== repo.ESTADO_CONEXION.VINCULADA) return null;

  return descifrar(conexion.accessToken, c.clave);
}

/** Mercado Pago rechazó el token: hay que volver a vincular, y mientras tanto todo es manual. */
export async function marcarTokenInvalido(refugioId: number): Promise<void> {
  const conexion = await repo.buscarConexion(refugioId);
  if (!conexion) return;
  await repo.marcarRevincular(conexion.id, USUARIO_SISTEMA_ID);
}

export async function renovarTokensPorVencer(ahora = new Date()): Promise<number> {
  const c = config();
  if (!c) return 0;

  let renovados = 0;
  for (const conexion of await repo.listarPorVencer(
    new Date(ahora.getTime() + MARGEN_RENOVACION_MS),
  )) {
    try {
      const tokens = await cliente.renovarToken({
        clientId: c.clientId,
        clientSecret: c.clientSecret,
        refreshToken: descifrar(conexion.refreshToken, c.clave),
      });
      await repo.actualizarTokens(
        conexion.id,
        {
          accessToken: cifrar(tokens.accessToken, c.clave),
          refreshToken: cifrar(tokens.refreshToken, c.clave),
          vence: tokens.vence,
        },
        USUARIO_SISTEMA_ID,
      );
      renovados++;
    } catch {
      // Un refresh vencido o revocado no frena a los demás refugios.
      await repo.marcarRevincular(conexion.id, USUARIO_SISTEMA_ID);
    }
  }
  return renovados;
}
```

- [ ] **Step 4:** PASS.

---

### Task 6: Rutas de Mercado Pago

**Files:**
- Create: `src/modules/mercadopago/mercadopago.controller.ts`, `src/modules/mercadopago/mercadopago.routes.ts`
- Modify: `src/routes/index.ts`

**Interfaces:**
- Produces: `mercadopagoRefugioRouter` (montado en `/refugio`: `GET /mercadopago`, `POST /mercadopago/vinculacion`, `DELETE /mercadopago`) y `mercadopagoRouter` (montado en `/mercadopago`: `GET /oauth/callback`, público).

- [ ] **Step 1: Controller**

```ts
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../middlewares/errorHandler';
import * as service from './mercadopago.service';

export async function estado(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.obtenerEstado(req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

export async function iniciar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.iniciarVinculacion(req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

export async function desvincular(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.desvincular(req.usuario!.usuarioId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/** Página mínima para el navegador del teléfono: textos fijos, nada que venga del pedido. */
function pagina(titulo: string, mensaje: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>PetHood</title>
<style>body{font-family:system-ui,sans-serif;background:#FFF5ED;color:#2e2b25;display:flex;
min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}
h1{color:#FF8A3D;font-size:22px}</style></head>
<body><main><h1>${titulo}</h1><p>${mensaje}</p></main></body></html>`;
}

/** Retorno de Mercado Pago (spec 027 §4). Responde HTML: lo abre el navegador, no la app. */
export async function callback(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query;
  try {
    await service.completarVinculacion(
      typeof code === 'string' ? code : undefined,
      typeof state === 'string' ? state : undefined,
    );
    res.type('html').send(pagina('¡Listo!', 'Listo, ya vinculaste Mercado Pago. Podés volver a PetHood.'));
  } catch (err) {
    const mensaje =
      err instanceof AppError
        ? err.mensaje
        : 'No pudimos vincular Mercado Pago. Volvé a intentarlo desde la app.';
    res.status(err instanceof AppError ? err.status : 500).type('html').send(pagina('No se pudo vincular', mensaje));
  }
}
```

(Verificar los nombres de las propiedades de `AppError` en `src/middlewares/errorHandler.ts` —`mensaje`/`status` o `message`/`httpStatus`— y usarlos tal cual.)

- [ ] **Step 2: Rutas**

```ts
import { Router } from 'express';
import { requiereAmbito } from '../../middlewares/ambito';
import { autenticar } from '../../middlewares/auth';
import { requiereRol } from '../../middlewares/roles';
import { ROL_API } from '../../shared/roles';
import * as controller from './mercadopago.controller';

/** Del refugio (spec 027). Se monta en `/refugio`: middlewares por ruta, no con `use`. */
export const mercadopagoRefugioRouter = Router();

const soloRefugio = [autenticar, requiereRol(ROL_API.MIEMBRO_REFUGIO), requiereAmbito('REFUGIO')];

mercadopagoRefugioRouter.get('/mercadopago', ...soloRefugio, controller.estado);
mercadopagoRefugioRouter.post('/mercadopago/vinculacion', ...soloRefugio, controller.iniciar);
mercadopagoRefugioRouter.delete('/mercadopago', ...soloRefugio, controller.desvincular);

/** Público: lo llama el navegador al volver de Mercado Pago. La identidad viaja en el `state`. */
export const mercadopagoRouter = Router();

mercadopagoRouter.get('/oauth/callback', controller.callback);
```

`src/routes/index.ts`, después de las líneas de campañas:

```ts
apiRouter.use('/refugio', mercadopagoRefugioRouter); // spec 027
apiRouter.use('/mercadopago', mercadopagoRouter); // spec 027 — callback OAuth
```

- [ ] **Step 3: Verificar.** `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npm test`. Con el server arriba y sin las variables MP: `GET /refugio/mercadopago` con token de refugio → `{ disponible: false, estado: 'NO_VINCULADA', ... }`; `POST /refugio/mercadopago/vinculacion` → 503 `MP_NO_DISPONIBLE`; `GET /mercadopago/oauth/callback` → HTML de error.

---

### Task 7: DNI obligatorio y carga única

**Files:**
- Modify: `src/modules/auth/auth.dto.ts` (dni obligatorio con `dniSchema`), `src/modules/usuarios/usuarios.{dto,routes,controller,service,repository}.ts`
- Test: `tests/unit/modules/usuarios/usuarios.service.test.ts` (agregar casos), `tests/unit/modules/auth/auth.dto.test.ts` (nuevo si no existe)

**Interfaces:**
- Produces: `POST /auth/registro` con `dni` obligatorio; `PATCH /usuarios/me/dni` `{ dni }` → `PerfilPropio`; `PerfilPropio.dni: string | null`; `usuariosService.cargarDni(usuarioId, dni, ambito)`.

- [ ] **Step 1: Tests que fallan.**
  - Auth DTO: `registroBodySchema.safeParse({...válido sin dni})` → falla con «El DNI es obligatorio.»; con `'30.123.456'` → «El DNI debe tener 7 u 8 dígitos numéricos.».
  - Usuarios service (mismo estilo de mocks que el test existente): `cargarDni(7, '30123456', 'PERSONAL')`:
    - usuario sin DNI → `repo.guardarDni(7, '30123456')` y audita `CARGAR_DNI`; devuelve el perfil con `dni`;
    - usuario con DNI → `DNI_YA_CARGADO` (409) y no guarda;
    - `guardarDni` devuelve `false` (otra pestaña lo cargó en el medio) → `DNI_YA_CARGADO`;
    - `guardarDni` tira P2002 → `DNI_DUPLICADO` (409, «Ya existe una cuenta con ese DNI.»).
  - `obtenerPerfil` incluye `dni`.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Implementar.**
  - `auth.dto.ts`: reemplazar el bloque `dni: z.string()...optional()` por `dni: dniSchema(),` (import desde `../../shared/validation/schemas`). Revisar `auth.service.ts:179/195`: `body.dni` ahora siempre es `string`.
  - `usuarios.dto.ts`: `export const cargarDniBodySchema = z.object({ dni: dniSchema() });` y sumar `dni: string | null;` a `PerfilPropio` (después de `telefono`).
  - `usuarios.repository.ts`:

    ```ts
    /** Carga el DNI sólo si todavía no tiene (spec 027 §6.11). `false` si ya tenía. */
    export async function guardarDni(usuarioId: number, dni: string): Promise<boolean> {
      const { count } = await prisma.usuario.updateMany({
        where: { id: usuarioId, fechaBaja: null, dni: null },
        data: { dni, ...datosModificacion(usuarioId) },
      });
      return count === 1;
    }
    ```

    (importar `datosModificacion` si el archivo no lo tiene; `buscarPerfil` ya trae el usuario completo, así que `dni` está disponible para el mapeo).
  - `usuarios.service.ts`: en el armado de `PerfilPropio` (dentro de `obtenerPerfil`), sumar `dni: usuario.dni`. Y:

    ```ts
    /** Carga única del DNI (spec 027 §6.11): con DNI ya cargado sólo lo corrige un admin. */
    export async function cargarDni(
      usuarioId: number,
      dni: string,
      ambito: Ambito,
    ): Promise<PerfilPropio> {
      const yaCargado = () =>
        new AppError(
          'DNI_YA_CARGADO',
          'Tu DNI ya está cargado. Si hay un error, escribinos desde Soporte.',
          409,
        );

      const usuario = await repo.buscarPerfil(usuarioId);
      if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);
      if (usuario.dni) throw yaCargado();

      let guardado: boolean;
      try {
        guardado = await repo.guardarDni(usuarioId, dni);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new AppError('DNI_DUPLICADO', 'Ya existe una cuenta con ese DNI.', 409);
        }
        throw err;
      }
      if (!guardado) throw yaCargado();

      await registrarAuditoria({ usuarioId, accion: 'CARGAR_DNI', entidad: 'Usuario', entidadId: usuarioId });
      return obtenerPerfil(usuarioId, ambito);
    }
    ```

    (El DNI completo no va al detalle de la auditoría.)
  - `usuarios.controller.ts`: `cargarDni` con el mismo molde que `actualizarPerfil`, usando `req.body` ya validado y `req.ambito`.
  - `usuarios.routes.ts`: `usuariosRouter.patch('/me/dni', autenticar, validar(cargarDniBodySchema), controller.cargarDni);`.

- [ ] **Step 4:** PASS + `npm test` completo (el registro con DNI obligatorio puede romper fixtures de tests de auth: agregarles `dni: '30123456'`).

---

### Task 8: Conciliación de donaciones

**Files:**
- Create: `src/modules/campanias/campanias.conciliacion.ts`
- Modify: `src/modules/campanias/campanias.{repository,service,dto}.ts`
- Test: `tests/unit/modules/campanias.conciliacion.test.ts` (nuevo), `tests/unit/modules/campanias.service.test.ts` (fixtures + casos)

**Interfaces:**
- Consumes: `dniDesdeIdentificacion`, `normalizarDni` (Task 1); `buscarPagos`, `TokenMercadoPagoInvalido`, `PagoMp` (Task 3); `mpService.tokenDeRefugio`, `mpService.marcarTokenInvalido`, `mpService.disponible` (Task 5).
- Produces: `emparejar(donaciones: DonacionAConciliar[], pagos: PagoMp[], usados: Set<string>): { donacionId: number; pagoId: string }[]`; `VENTANA_ANTES_MS`, `VENTANA_DESPUES_MS`; `campaniasService.conciliarGrupo(g: { refugioId: number; usuarioId: number; monto: number }, ahora?: Date): Promise<number>`; repo `pendientesDelGrupo`, `pagosYaUsados`, `confirmarConPagoMp`, `gruposConciliables`; `DonacionDto.confirmadaPorMercadoPago`; `CampaniaDto.confirmacionAutomatica`.

- [ ] **Step 1: Test del emparejamiento (puro)**

```ts
import { describe, expect, it } from 'vitest';
import { emparejar } from '../../../src/modules/campanias/campanias.conciliacion';

const H = 60 * 60 * 1000;
const T0 = new Date('2026-09-30T15:00:00Z');
const en = (horas: number) => new Date(T0.getTime() + horas * H);

const donacion = (id: number, horas = 0, monto = 5000, dni = '30123456') => ({ id, monto, fechaAlta: en(horas), dni });
const pago = (id: string, horas = -0.1, monto = 5000, numeroDoc = '20301234569', estado = 'approved') => ({
  id, monto, fecha: en(horas), estado, tipoDoc: 'CUIL', numeroDoc,
});

describe('emparejar', () => {
  it('monto + DNI + ventana: la transferencia hecha un rato antes de «Terminar donación»', () => {
    expect(emparejar([donacion(1)], [pago('p1')], new Set())).toEqual([{ donacionId: 1, pagoId: 'p1' }]);
  });

  it('no empareja otro DNI, otro monto, un pago no aprobado ni uno ya usado', () => {
    expect(emparejar([donacion(1)], [pago('p1', -1, 5000, '20999999999')], new Set())).toEqual([]);
    expect(emparejar([donacion(1)], [pago('p1', -1, 5000.01)], new Set())).toEqual([]);
    expect(emparejar([donacion(1)], [pago('p1', -1, 5000, '20301234569', 'pending')], new Set())).toEqual([]);
    expect(emparejar([donacion(1)], [pago('p1')], new Set(['p1']))).toEqual([]);
  });

  it('respeta la ventana: hasta 24 h antes y 72 h después', () => {
    expect(emparejar([donacion(1)], [pago('p1', -25)], new Set())).toEqual([]);
    expect(emparejar([donacion(1)], [pago('p1', 73)], new Set())).toEqual([]);
    expect(emparejar([donacion(1)], [pago('p1', 71)], new Set())).toHaveLength(1);
  });

  it('dos donaciones iguales: la más vieja se lleva el primer pago y un pago no se usa dos veces', () => {
    expect(emparejar([donacion(2, 1), donacion(1, 0)], [pago('p1', 0.5)], new Set())).toEqual([
      { donacionId: 1, pagoId: 'p1' },
    ]);
    expect(emparejar([donacion(1, 0), donacion(2, 1)], [pago('p1', 0.5), pago('p2', 1.5)], new Set())).toEqual([
      { donacionId: 1, pagoId: 'p1' },
      { donacionId: 2, pagoId: 'p2' },
    ]);
  });

  it('DNI de 7 dígitos guardado sin cero contra CUIL con cero', () => {
    expect(emparejar([donacion(1, 0, 5000, '7123456')], [pago('p1', -1, 5000, '20071234563')], new Set())).toHaveLength(1);
  });
});
```

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: `src/modules/campanias/campanias.conciliacion.ts`**

```ts
/**
 * Emparejamiento de donaciones Pendientes con transferencias de Mercado Pago (spec 027 §6.1).
 * Función pura: el servicio le pasa las donaciones de un mismo donante y monto, y los pagos que
 * devolvió Mercado Pago para ese monto.
 */
import type { PagoMp } from '../mercadopago/mercadopago.cliente';
import { dniDesdeIdentificacion, normalizarDni } from '../../shared/validation/documento';

const HORA_MS = 60 * 60 * 1000;
/** El adoptante transfiere antes de tocar «Terminar donación». */
export const VENTANA_ANTES_MS = 24 * HORA_MS;
/** Las transferencias bancarias a veces tardan en acreditarse. */
export const VENTANA_DESPUES_MS = 72 * HORA_MS;

export interface DonacionAConciliar {
  id: number;
  monto: number;
  fechaAlta: Date;
  dni: string;
}

const centavos = (monto: number): number => Math.round(monto * 100);

function dentroDeLaVentana(donacion: DonacionAConciliar, pago: PagoMp): boolean {
  const desde = donacion.fechaAlta.getTime() - VENTANA_ANTES_MS;
  const hasta = donacion.fechaAlta.getTime() + VENTANA_DESPUES_MS;
  return pago.fecha.getTime() >= desde && pago.fecha.getTime() <= hasta;
}

/**
 * Cada donación, de la más vieja a la más nueva, se queda con el primer pago que cumple todo y
 * todavía nadie tomó. Un pago nunca confirma dos donaciones.
 */
export function emparejar(
  donaciones: DonacionAConciliar[],
  pagos: PagoMp[],
  usados: Set<string>,
): { donacionId: number; pagoId: string }[] {
  const tomados = new Set(usados);
  const pares: { donacionId: number; pagoId: string }[] = [];

  const porFecha = [...donaciones].sort(
    (a, b) => a.fechaAlta.getTime() - b.fechaAlta.getTime() || a.id - b.id,
  );
  const pagosPorFecha = [...pagos].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  for (const donacion of porFecha) {
    const dni = normalizarDni(donacion.dni);
    const pago = pagosPorFecha.find(
      (candidato) =>
        !tomados.has(candidato.id) &&
        candidato.estado === 'approved' &&
        centavos(candidato.monto) === centavos(donacion.monto) &&
        dniDesdeIdentificacion(candidato.tipoDoc, candidato.numeroDoc) === dni &&
        dentroDeLaVentana(donacion, candidato),
    );
    if (!pago) continue;

    tomados.add(pago.id);
    pares.push({ donacionId: donacion.id, pagoId: pago.id });
  }

  return pares;
}
```

- [ ] **Step 4:** test puro PASS.

- [ ] **Step 5: Repository.** En `campanias.repository.ts`:
  - `SELECCION_DONACION` suma `mpPagoId: true`.
  - `SELECCION_CAMPANIA.refugio.select` suma `conexionMercadoPago: { select: { estado: true, fechaBaja: true } }`.
  - `buscarUsuarioConRefugio` suma `dni: true` al `select`.
  - Nuevas:

    ```ts
    /** Pendientes de un donante y monto en un refugio, dentro de la ventana de conciliación. */
    export function pendientesDelGrupo(
      grupo: { refugioId: number; usuarioId: number; monto: number },
      desde: Date,
    ) {
      return prisma.donacion.findMany({
        where: {
          usuarioId: grupo.usuarioId,
          monto: grupo.monto,
          fechaBaja: null,
          fechaAlta: { gte: desde },
          estadoDonacion: { nombre: ESTADO_DONACION.PENDIENTE },
          campania: { refugioId: grupo.refugioId },
        },
        orderBy: [{ fechaAlta: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          monto: true,
          fechaAlta: true,
          campaniaId: true,
          usuario: { select: { dni: true } },
        },
      });
    }

    export async function pagosYaUsados(ids: string[]): Promise<Set<string>> {
      if (ids.length === 0) return new Set();
      const filas = await prisma.donacion.findMany({
        where: { mpPagoId: { in: ids } },
        select: { mpPagoId: true },
      });
      return new Set(filas.map((fila) => fila.mpPagoId!));
    }

    /** Pendiente → Realizada con el pago que la confirmó. Condicional, como la manual. */
    export async function confirmarConPagoMp(
      id: number,
      pendienteId: number,
      realizadaId: number,
      mpPagoId: string,
      usuarioId: number,
    ): Promise<boolean> {
      const { count } = await prisma.donacion.updateMany({
        where: { id, estadoDonacionId: pendienteId, fechaBaja: null },
        data: { estadoDonacionId: realizadaId, mpPagoId, ...datosModificacion(usuarioId) },
      });
      return count === 1;
    }

    /** Lo que recorre el cron: grupos donante + refugio + monto con algo para conciliar. */
    export async function gruposConciliables(desde: Date) {
      const filas = await prisma.donacion.findMany({
        where: {
          fechaBaja: null,
          fechaAlta: { gte: desde },
          estadoDonacion: { nombre: ESTADO_DONACION.PENDIENTE },
          usuario: { dni: { not: null } },
          campania: {
            refugio: { conexionMercadoPago: { estado: 'VINCULADA', fechaBaja: null } },
          },
        },
        select: { usuarioId: true, monto: true, campania: { select: { refugioId: true } } },
      });

      const vistos = new Map<string, { refugioId: number; usuarioId: number; monto: number }>();
      for (const fila of filas) {
        const grupo = { refugioId: fila.campania.refugioId, usuarioId: fila.usuarioId, monto: Number(fila.monto) };
        vistos.set(`${grupo.refugioId}|${grupo.usuarioId}|${grupo.monto}`, grupo);
      }
      return [...vistos.values()];
    }
    ```

- [ ] **Step 6: Tests del servicio (fallan primero).** En `tests/unit/modules/campanias.service.test.ts`:
  - Mockear también `../../../src/modules/mercadopago/mercadopago.service` y `../../../src/modules/mercadopago/mercadopago.cliente` (este último con `vi.mock` parcial que conserve la clase real `TokenMercadoPagoInvalido` vía `importActual`).
  - Fixtures: `campania()` suma `conexionMercadoPago: null` en `refugio`; `donacion()` suma `mpPagoId: null`; `usuarioDeRefugio()` suma `dni: '30123456'`.
  - Casos nuevos:
    - `donar` sin DNI (`dni: null`) → `DNI_REQUERIDO` y no crea nada.
    - `donar` con refugio vinculado y un pago que matchea → `confirmarConPagoMp(30, 11, 12, 'p1', USUARIO_SISTEMA_ID)`, la respuesta viene `Realizada` y `confirmadaPorMercadoPago: true`.
    - `donar` con Mercado Pago que tira (timeout) → la donación se crea y vuelve `Pendiente`, sin error.
    - `conciliarGrupo` con `TokenMercadoPagoInvalido` → `marcarTokenInvalido(refugioId)` y devuelve 0.
    - Carrera: `confirmarConPagoMp` tira P2002 (`new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: '5' })`) → no se propaga, devuelve 0.
    - Confirmar la que completa el objetivo → `cambiarEstadoSi(8, 2, 3, USUARIO_SISTEMA_ID)`.
    - `obtenerCampania` → `confirmacionAutomatica: true` con `conexionMercadoPago: { estado: 'VINCULADA', fechaBaja: null }` y `mpService.disponible()` en `true`; `false` sin conexión.

- [ ] **Step 7: Servicio.** En `campanias.service.ts`:
  - `import * as mpService from '../mercadopago/mercadopago.service';`, `import { buscarPagos, TokenMercadoPagoInvalido } from '../mercadopago/mercadopago.cliente';`, `import { emparejar, VENTANA_ANTES_MS, VENTANA_DESPUES_MS } from './campanias.conciliacion';`, `import { Prisma } from '@prisma/client';`.
  - `aDto` suma:

    ```ts
        // El refugio de la campaña confirma solo (spec 027): la pantalla Donar elige el texto.
        confirmacionAutomatica:
          mpService.disponible() &&
          campania.refugio.conexionMercadoPago?.estado === 'VINCULADA' &&
          campania.refugio.conexionMercadoPago.fechaBaja === null,
    ```

    y el `refugio` del DTO sigue siendo `{ id, nombre, imagenUrl }` (sin la conexión). Sumar `confirmacionAutomatica: boolean` a `CampaniaDto` en el DTO.
  - `aDtoDonacion` suma `confirmadaPorMercadoPago: donacion.mpPagoId !== null` (y el campo en `DonacionDto`).
  - Nueva función exportada:

    ```ts
    /**
     * Confirma con Mercado Pago las Pendientes de un donante y monto en un refugio (spec 027
     * §6). Busca una sola vez los pagos de ese monto en la ventana de todas, empareja y
     * confirma. Nunca tira: cualquier problema deja las donaciones Pendientes para el refugio.
     */
    export async function conciliarGrupo(
      grupo: { refugioId: number; usuarioId: number; monto: number },
      ahora = new Date(),
      timeoutMs = 5000,
    ): Promise<number> {
      try {
        const token = await mpService.tokenDeRefugio(grupo.refugioId);
        if (!token) return 0;

        const pendientes = (
          await repo.pendientesDelGrupo(grupo, new Date(ahora.getTime() - VENTANA_DESPUES_MS))
        ).filter((d) => d.usuario.dni);
        if (pendientes.length === 0) return 0;

        const desde = new Date(pendientes[0]!.fechaAlta.getTime() - VENTANA_ANTES_MS);
        const hasta = new Date(
          Math.min(ahora.getTime(), pendientes[pendientes.length - 1]!.fechaAlta.getTime() + VENTANA_DESPUES_MS),
        );

        let pagos;
        try {
          pagos = await buscarPagos(token, { monto: grupo.monto, desde, hasta }, timeoutMs);
        } catch (err) {
          if (err instanceof TokenMercadoPagoInvalido) await mpService.marcarTokenInvalido(grupo.refugioId);
          return 0;
        }

        const usados = await repo.pagosYaUsados(pagos.map((pago) => pago.id));
        const pares = emparejar(
          pendientes.map((d) => ({ id: d.id, monto: Number(d.monto), fechaAlta: d.fechaAlta, dni: d.usuario.dni! })),
          pagos,
          usados,
        );

        const estados = await idsEstadosDonacion();
        let confirmadas = 0;
        for (const par of pares) {
          const donacion = pendientes.find((d) => d.id === par.donacionId)!;
          try {
            if (!(await repo.confirmarConPagoMp(par.donacionId, estados.Pendiente, estados.Realizada, par.pagoId, USUARIO_SISTEMA_ID))) continue;
          } catch (err) {
            // El mismo pago lo tomó otra corrida en paralelo (donacion_mp_pago_id es único).
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue;
            throw err;
          }
          confirmadas++;
          await registrarAuditoria({
            usuarioId: USUARIO_SISTEMA_ID,
            accion: 'CONFIRMAR_MP',
            entidad: 'Donacion',
            entidadId: par.donacionId,
            detalle: `pago=${par.pagoId}`,
          });
          await cerrarSiCompleta(donacion.campaniaId);
        }
        return confirmadas;
      } catch {
        return 0;
      }
    }
    ```
  - En `donar`: después de resolver `usuario`, si `!usuario.dni` → `throw new AppError('DNI_REQUERIDO', 'Cargá tu DNI para donar.', 409);`. Después de `registrarAuditoria` de la creación:

    ```ts
      // Si el refugio tiene Mercado Pago, se intenta confirmar ya (spec 027 §6.5). Si no
      // aparece todavía, lo retoma el cron.
      await conciliarGrupo({ refugioId: campania.refugioId, usuarioId, monto: datos.monto });
      const actualizada = await repo.buscarDonacionCompleta(donacion.id);
      return aDtoDonacion(actualizada ?? donacion);
    ```

- [ ] **Step 8:** `npx vitest run tests/unit/modules/campanias.conciliacion.test.ts tests/unit/modules/campanias.service.test.ts` → PASS; `npx tsc --noEmit -p tsconfig.json`.

---

### Task 9: Cron de conciliación y renovación

**Files:**
- Create: `src/jobs/conciliar-donaciones-mp.job.ts`
- Test: `tests/unit/jobs/conciliar-donaciones-mp.job.test.ts`

**Interfaces:**
- Produces: `conciliarDonacionesMp(ahora?: Date): Promise<{ renovados: number; confirmadas: number }>`.

- [ ] **Step 1: Test que falla** (mockear `mercadopago.service`, `campanias.repository` y `campanias.service`, este último con `conciliarGrupo` mockeado): sin `disponible()` → `{ 0, 0 }` sin tocar nada; con dos grupos → llama `renovarTokensPorVencer(AHORA)`, `gruposConciliables` con `AHORA - 72 h` y `conciliarGrupo` una vez por grupo, sumando lo confirmado; si un grupo tira, sigue con el otro.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3: Implementar**

```ts
/**
 * Spec 027 §6.5 y §6.8: cada 5 minutos, renueva los tokens de Mercado Pago que vencen pronto y
 * reintenta confirmar las donaciones Pendientes de refugios vinculados (usuario SISTEMA).
 *
 * Función pura + entrypoint CLI, como los otros jobs. Crontab:
 *   *\/5 * * * * cd /ruta/al/repo && node dist/jobs/conciliar-donaciones-mp.job.js
 */
import * as campaniasRepo from '../modules/campanias/campanias.repository';
import { conciliarGrupo } from '../modules/campanias/campanias.service';
import { VENTANA_DESPUES_MS } from '../modules/campanias/campanias.conciliacion';
import * as mpService from '../modules/mercadopago/mercadopago.service';

export async function conciliarDonacionesMp(
  ahora = new Date(),
): Promise<{ renovados: number; confirmadas: number }> {
  if (!mpService.disponible()) return { renovados: 0, confirmadas: 0 };

  const renovados = await mpService.renovarTokensPorVencer(ahora);
  const grupos = await campaniasRepo.gruposConciliables(
    new Date(ahora.getTime() - VENTANA_DESPUES_MS),
  );

  let confirmadas = 0;
  for (const grupo of grupos) {
    try {
      // Sin apuro: el tope de 5 s es para el pedido del usuario; acá se espera más.
      confirmadas += await conciliarGrupo(grupo, ahora, 15000);
    } catch {
      // Un grupo con problemas no frena a los demás.
    }
  }

  return { renovados, confirmadas };
}

if (require.main === module) {
  conciliarDonacionesMp()
    .then(({ renovados, confirmadas }) => {
      console.log(`✅ conciliar-donaciones-mp: ${confirmadas} confirmada(s), ${renovados} token(s) renovado(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en conciliar-donaciones-mp:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 4:** PASS; `npx tsx src/jobs/conciliar-donaciones-mp.job.ts` sin variables MP → «0 confirmada(s), 0 token(s)».

---

### Task 10: Documentación del backend

- [ ] `docs/api-mercadopago.md` con el molde de `docs/api-campanias.md`: los 4 endpoints nuevos + `PATCH /usuarios/me/dni`, bodies, respuestas, errores literales, la página del callback, el cron, cómo configurar la aplicación en Mercado Pago Developers (URL de retorno y `offline_access`) y cómo probar en local con ngrok.
- [ ] `docs/api-campanias.md`: `confirmacionAutomatica`, `confirmadaPorMercadoPago`, `DNI_REQUERIDO` en «Donar», y que la donación puede volver `Realizada`.
- [ ] Regla transversal 11 en `AGENTS.md`, `docs/CONSTITUTION.md` y `docs/REQUISITOS.md` §8.9: «Donaciones: el monto declarado suma al progreso cuando se confirma la transferencia: automáticamente con Mercado Pago (monto + DNI) o a mano por el refugio (spec 027, decisión del equipo 2026-09-30).»
- [ ] `REQUISITOS.md` HU-1.1: DNI obligatorio (ya estaba en la lista de campos; aclarar «obligatorio, 7 u 8 dígitos»).
- [ ] `docs/DEUDA_TECNICA.md`: ítem nuevo «Sin webhook de Mercado Pago: la confirmación tarda hasta 5 minutos si la transferencia llega después de "Terminar donación"» (Baja).
- [ ] Spec 027: §4 queda con la tabla y el link a `docs/api-mercadopago.md`.

---

## Parte B — App mobile (`PetHood_Front/apps/mobile`)

### Task 11: DNI en validación, servicios y tipos

**Files:**
- Create: `shared/validation/documento.ts`, `shared/validation/documento.test.ts`
- Modify: `types/auth.ts` (`Perfil.dni`), `services/auth.ts` (`RegistroPayload.dni`), `services/usuarios.ts` (`cargarDni`), `services/campanias.ts` (tipos), `services/catalogos.ts` (nada)

- [ ] **Step 1: Test que falla (`node:test`)**: `validarDni('')` → «El DNI es obligatorio.»; `'30.123.456'` → «El DNI debe tener 7 u 8 dígitos numéricos.»; `'30123456'` → `null`.
- [ ] **Step 2: `shared/validation/documento.ts`** (espejo del backend, sin imports):

```ts
/** DNI: 7 u 8 dígitos (spec 027). Espejo de `pethood-backend/src/shared/validation/documento.ts`. */
export function validarDni(valor: string): string | null {
  const dni = valor.trim();
  if (dni === '') return 'El DNI es obligatorio.';
  if (!/^\d{7,8}$/.test(dni)) return 'El DNI debe tener 7 u 8 dígitos numéricos.';
  return null;
}
```

- [ ] **Step 3: tipos y servicios.**
  - `types/auth.ts`: `Perfil` suma `dni: string | null;`.
  - `services/auth.ts`: `RegistroPayload` suma `dni: string;` y `form.append('dni', payload.dni);`.
  - `services/usuarios.ts`: `export function cargarDni(token: string, dni: string): Promise<RespuestaPerfil> { return apiFetch('/usuarios/me/dni', { method: 'PATCH', token, body: { dni } }); }` (mismo molde que `actualizarUbicacion`; verificar la firma de `apiFetch`).
  - `services/campanias.ts`: `Campania` suma `confirmacionAutomatica: boolean;`, `Donacion` suma `confirmadaPorMercadoPago: boolean;`.
- [ ] **Step 4:** `node --test --experimental-strip-types shared/validation/documento.test.ts` PASS; `npx tsc --noEmit`.

### Task 12: Registro y «Editar perfil» con DNI; aviso de perfil incompleto

**Files:** `app/(auth)/register.tsx`, `app/perfil/editar.tsx`, `app/(tabs)/perfil.tsx`

- [ ] **Registro:** sumar `dni` al estado del formulario y a la validación, con un `CustomInput` «DNI» (`keyboardType="number-pad"`, `maxLength={8}`, `required`, `onChangeText` que deja sólo dígitos, `onBlur` con `validarDni`) después de «Teléfono», y `dni: form.dni.trim()` en el payload. El botón de registro sólo se habilita con DNI válido (mismo mecanismo que el resto de los campos del archivo).
- [ ] **Editar perfil:** leer `respuesta.usuario.dni` al cargar. Si es `null`, un `TextField` «DNI» editable (dígitos, 8 máximo, validado con `validarDni` sólo si se escribió algo). Al guardar, si se cargó, primero `cargarDni(token, dni)` y después el `actualizarPerfil` de siempre; si `cargarDni` falla, mostrar su mensaje y no seguir. Si ya tiene DNI, mostrarlo de solo lectura con `ayuda="Para corregirlo, escribinos desde Soporte."`.
- [ ] **Perfil (pestaña):** en el cálculo de `incompleto` de la vista personal, sumar `|| !visible?.dni`.
- [ ] `npx tsc --noEmit`. Formatear sólo las líneas propias (no pasar Prettier sobre estos archivos enteros).

### Task 13: Tarjeta «Mercado Pago» en «Perfil del refugio»

**Files:**
- Create: `services/mercadoPago.ts`, `components/refugio/TarjetaMercadoPago.tsx`
- Modify: `app/perfil/refugio.tsx` (insertar la tarjeta debajo del `FormCard`, antes de los botones de «Guardar cambios»)

- [ ] `services/mercadoPago.ts`:

```ts
/** Conexión del refugio con Mercado Pago (spec 027). */
import { del, get, post } from './api';

export interface EstadoMercadoPago {
  disponible: boolean;
  estado: 'NO_VINCULADA' | 'VINCULADA' | 'REVINCULAR';
  fechaVinculacion: string | null;
}

export function obtenerEstadoMercadoPago(): Promise<EstadoMercadoPago> {
  return get('/refugio/mercadopago');
}

export function iniciarVinculacion(): Promise<{ url: string }> {
  return post('/refugio/mercadopago/vinculacion', {});
}

export function desvincularMercadoPago(): Promise<void> {
  return del('/refugio/mercadopago');
}
```

- [ ] `components/refugio/TarjetaMercadoPago.tsx`: carga el estado al montar y en `useFocusEffect` (con el cuidado de dependencias estables del arreglo de «Mis Campañas»: la función de carga en `useCallback` sin dependencias cambiantes). No renderiza nada si `!disponible`. Textos de la spec §5; «Vincular Mercado Pago» → `const { url } = await iniciarVinculacion(); await WebBrowser.openBrowserAsync(url);` y al volver recarga el estado. «Desvincular» con `ConfirmDialog` tono `peligro` («¿Desvincular Mercado Pago?», «Las donaciones vuelven a confirmarse a mano.»). Errores con `toast.mostrarError(err.message)`.
- [ ] `npx tsc --noEmit`.

### Task 14: «Donar» con DNI y confirmación automática; marca en «Revisar donaciones»

**Files:** `app/campanias/[id]/donar.tsx`, `app/campanias/refugio/[id]/donaciones.tsx`

- [ ] **Donar:**
  - Al montar, además de la campaña, pedir el perfil (`obtenerPerfil(token)` de `services/usuarios.ts`, token de `useSesion()`) para saber si tiene DNI.
  - Si `campania.confirmacionAutomatica`, la `Nota` dice «Si transferiste desde una cuenta a tu nombre, se confirma sola en unos minutos.».
  - Al tocar «Terminar donación» sin DNI: `ConfirmDialog` («Para registrar tu donación necesitamos tu DNI.», con un `TextField` DNI como `children`, `textoConfirmar="Guardar y donar"`). Al confirmar: `validarDni` → `cargarDni` → sigue con `donar`. Errores del backend (`DNI_DUPLICADO`, etc.) en el toast, sin cerrar el cartel.
  - Si la respuesta de `donar` vuelve `estado.nombre === 'Realizada'`: toast «¡Listo! Tu donación ya se sumó a la campaña.»; si no, el de siempre.
- [ ] **Revisar donaciones:** en `FilaDonacion`, si `donacion.confirmadaPorMercadoPago`, una pastilla «Confirmada por Mercado Pago» (`bg-sky-50 border-sky-200`, texto `text-sky-700`) debajo del monto.
- [ ] `npx tsc --noEmit`; `node --test --experimental-strip-types lib/*.test.ts shared/validation/*.test.ts`.

---

### Task 15: Cierre

- [ ] Backend: `npm test`, `npm run lint`, `npx tsc --noEmit -p tsconfig.json`, `npx prettier --check --end-of-line auto "src/**/*.ts" "tests/**/*.ts" "prisma/**/*.ts"`.
- [ ] Mobile: `npx tsc --noEmit`, `node --test ...`, `npx expo export --platform web`.
- [ ] Prueba de punta a punta **con el usuario** (necesita su cuenta y ngrok): configurar la aplicación de Mercado Pago (URL de retorno, `offline_access`), completar las 4 variables en `.env`, vincular desde la app, transferir $X desde una cuenta a nombre de un usuario con DNI, donar $X y ver que queda Realizada. Criterios de la spec §7, uno por uno.
- [ ] Revisión final de la rama (subagente) y spec 027 → IMPLEMENTADA sólo después de la prueba de punta a punta.
