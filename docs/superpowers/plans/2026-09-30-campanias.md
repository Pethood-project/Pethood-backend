# Campañas de donación (Módulo 12) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar HU-12.1 a HU-12.7: un refugio crea campañas con alias/CBU, el adoptante avisa lo que donó por transferencia, el refugio aplica o rechaza cada donación, y un cron mueve las campañas entre estados. Backend (API + cron + dashboards) y app mobile (pantallas 13, 21, 27 y dos nuevas).

**Architecture:** Módulo backend `src/modules/campanias/` en capas (routes → controller → service → repository) con la máquina de estados en un archivo puro (`campanias.estados.ts`) que comparten el servicio y el cron `src/jobs/transicion-estados-campana.job.ts`. En mobile: `services/campanias.ts` + helpers puros en `lib/campanias.ts` + pantallas bajo `app/campanias/`, siguiendo el patrón de mascotas perdidas (spec 020).

**Tech Stack:** Express 5 + TypeScript + Prisma 5 + PostgreSQL + Zod 3 + Vitest (backend). Expo SDK 57 + Expo Router + NativeWind + `node:test` para helpers puros (mobile).

**Spec:** `docs/specs/026-campanias.md` (APROBADA). Leerla antes de cada tarea.

## Global Constraints

- Repos: backend `PetHood_Back`, frontend `PetHood_Front` (monorepo, app en `apps/mobile`). Trabajar en la rama `feature/mod12-campanias` de **cada** repo, creada desde `dev`. No commitear en `dev`.
- **No tocar ni commitear `docker-compose.yml`** del backend: tiene un cambio local del usuario.
- Estados de campaña (catálogo existente): `Inactiva`, `Activa`, `Finalizada`, `Cancelada`. Estados de donación (catálogo nuevo): `Pendiente`, `Realizada`, `Cancelada`.
- Motivos de rechazo: `NO_RECIBIDA`, `MONTO_NO_COINCIDE`.
- Límites (espejados a mano en `apps/mobile/shared/validation/limits.ts`): título 3–50; descripción ≤300; objetivo 10.000–2.500.000 sin decimales; alias 6–20 `[A-Za-z0-9.-]`; CBU/CVU 22 dígitos; monto de donación 1–2.500.000 con hasta 2 decimales; máximo 5 campañas `Inactiva`+`Activa` por refugio.
- Textos de UI y de error en español con tildes y **voseo rioplatense**. Botones de HU-12.1: «Cancelar» (rojo) y «Confirmar» (verde). Vacío del listado del refugio: «No tiene campañas creadas».
- Errores del backend siempre `AppError(codigo, mensaje, http)` → `{ error: { codigo, mensaje } }`.
- `service.ts` nunca importa Prisma. Validaciones genéricas sólo en `src/shared/validation/` (y su espejo en mobile).
- Rutas: `/api/v1/campanias` (perfil PERSONAL salvo el detalle) y `/api/v1/refugio/...` (perfil REFUGIO + rol `MIEMBRO_REFUGIO`).
- Listados mobile paginan por cursor: `{ <items>, hayMas, proximoCursor }`, se piden `limite + 1` filas, orden con `id` de desempate.
- Operaciones críticas escriben `registrarAuditoria`. Transiciones automáticas con `USUARIO_SISTEMA_ID`.
- Antes de cada commit del backend: `npm test`, `npm run lint`, `npm run format:check`. Commits en español, terminados con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- **Carreras de estado:** dos miembros resuelven la misma donación, o el cron y «Finalizar» chocan. Esperado: la segunda escritura no cambia nada y responde 409 `TRANSICION_INVALIDA` (el cron la saltea). Tests en Task 5 («carrera») y Task 7 («carrera con el refugio»).
- **Montos con coma o punto y con separador de miles:** «5000,50» y «5000.50» son válidos para donar. «10.000» en el objetivo (sin decimales) es inválido, con un mensaje claro y no una excepción. Tests en Task 1 (numbers).
- **Fechas en el borde del día:** una campaña que empieza hoy queda `Activa` al crearla. Una que termina hoy sigue `Activa` hasta el fin del día. Tests en Task 3 (estados) y Task 5 («empieza hoy»).
- **Acceso cruzado entre refugios:** ninguna ruta de refugio deja ver ni tocar campañas o donaciones de otro refugio (404, no 403, para no revelar que existen). Tests en Task 5.
- **Donaciones sobre campañas ya cerradas:** una `Pendiente` se puede aplicar aunque la campaña esté `Finalizada`; aplicarla no reabre ni vuelve a finalizar nada. Test en Task 5.

---

## Parte A — Backend (`PetHood_Back`)

### Task 0: Rama de trabajo

- [ ] **Step 1: Crear la rama desde `dev` sin arrastrar `docker-compose.yml`**

```bash
cd PetHood_Back
git checkout dev
git pull
git checkout -b feature/mod12-campanias
git status -s   # docker-compose.yml sigue modificado: NO se agrega en ningún commit
```

---

### Task 1: Validación compartida — decimales enteros, fecha no pasada, alias y CBU

**Files:**
- Modify: `src/shared/validation/numbers.ts` (función `patronDecimal` y mensaje de `parsearDecimal`)
- Modify: `src/shared/validation/dates.ts` (agregar `validarFechaNoPasada`)
- Create: `src/shared/validation/bancario.ts`
- Modify: `src/shared/validation/schemas.ts` (agregar `fechaNoPasadaSchema`, `aliasOpcionalSchema`, `cbuOpcionalSchema`)
- Modify: `src/shared/validation/limits.ts` (agregar `campania` y `donacion`)
- Test: `tests/unit/shared/validation/numbers.test.ts`, `tests/unit/shared/validation/dates.test.ts`, `tests/unit/shared/validation/bancario.test.ts`

**Interfaces:**
- Produces: `validarFechaNoPasada(valor, etiqueta): ResultadoFecha`; `fechaNoPasadaSchema(etiqueta)`; `validarAliasOpcional(valor): ResultadoBancario`; `validarCbuOpcional(valor): ResultadoBancario` con `ResultadoBancario = { valido: true; valor: string | null } | { valido: false; error: string }`; `aliasOpcionalSchema()`, `cbuOpcionalSchema()` (devuelven `string | null`); `LIMITES.campania`, `LIMITES.donacion`.

- [ ] **Step 1: Tests que fallan**

Agregar a `tests/unit/shared/validation/numbers.test.ts` (dentro del archivo existente, al final):

```ts
describe('parsearDecimal sin decimales', () => {
  const OBJETIVO = { min: 10000, max: 2500000, decimales: 0, etiqueta: 'El objetivo' };

  it('acepta un entero dentro del rango', () => {
    expect(parsearDecimal('150000', OBJETIVO)).toEqual({ valido: true, valor: 150000 });
  });

  it('rechaza decimales y separador de miles con un mensaje claro, sin tirar', () => {
    expect(parsearDecimal('10.000', OBJETIVO)).toEqual({
      valido: false,
      error: 'El objetivo debe ser un número entero, sin puntos ni comas',
    });
    expect(parsearDecimal('15000,5', OBJETIVO)).toMatchObject({ valido: false });
  });

  it('respeta el rango', () => {
    expect(parsearDecimal('9999', OBJETIVO)).toMatchObject({ valido: false });
  });
});
```

Si el archivo no importa `parsearDecimal` todavía, sumarlo al import existente de `../../../../src/shared/validation/numbers`.

Agregar a `tests/unit/shared/validation/dates.test.ts` (sumar `validarFechaNoPasada` al import):

```ts
describe('validarFechaNoPasada', () => {
  it('acepta hoy y fechas futuras', () => {
    expect(validarFechaNoPasada(new Date(), 'La fecha de inicio')).toMatchObject({ valida: true });
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    expect(validarFechaNoPasada(manana, 'La fecha de inicio')).toMatchObject({ valida: true });
  });

  it('rechaza ayer', () => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    expect(validarFechaNoPasada(ayer, 'La fecha de inicio')).toEqual({
      valida: false,
      error: 'La fecha de inicio no puede ser anterior a hoy',
    });
  });

  it('rechaza vacío y texto inválido', () => {
    expect(validarFechaNoPasada('', 'La fecha de inicio')).toMatchObject({ valida: false });
    expect(validarFechaNoPasada('nada', 'La fecha de inicio')).toMatchObject({ valida: false });
  });
});
```

Crear `tests/unit/shared/validation/bancario.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validarAliasOpcional, validarCbuOpcional } from '../../../../src/shared/validation/bancario';

describe('validarAliasOpcional', () => {
  it('vacío o ausente es null: el campo es opcional', () => {
    expect(validarAliasOpcional('')).toEqual({ valido: true, valor: null });
    expect(validarAliasOpcional('   ')).toEqual({ valido: true, valor: null });
    expect(validarAliasOpcional(undefined)).toEqual({ valido: true, valor: null });
  });

  it('acepta letras, números, puntos y guiones, con trim', () => {
    expect(validarAliasOpcional(' refugio.patitas-mp ')).toEqual({
      valido: true,
      valor: 'refugio.patitas-mp',
    });
  });

  it('rechaza largo fuera de 6 a 20', () => {
    expect(validarAliasOpcional('abc')).toEqual({
      valido: false,
      error: 'El alias debe tener entre 6 y 20 caracteres',
    });
    expect(validarAliasOpcional('a'.repeat(21))).toMatchObject({ valido: false });
  });

  it('rechaza espacios y símbolos', () => {
    expect(validarAliasOpcional('refugio patitas')).toEqual({
      valido: false,
      error: 'El alias sólo puede tener letras, números, puntos y guiones',
    });
    expect(validarAliasOpcional('refugio@mp')).toMatchObject({ valido: false });
  });
});

describe('validarCbuOpcional', () => {
  it('vacío es null', () => {
    expect(validarCbuOpcional('')).toEqual({ valido: true, valor: null });
  });

  it('acepta 22 dígitos y quita espacios pegados', () => {
    expect(validarCbuOpcional('0000003100 012345678901')).toEqual({
      valido: true,
      valor: '0000003100012345678901',
    });
  });

  it('rechaza otro largo o letras', () => {
    const error = { valido: false, error: 'El CBU o CVU debe tener 22 números' };
    expect(validarCbuOpcional('123')).toEqual(error);
    expect(validarCbuOpcional('000000310001234567890A')).toEqual(error);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run tests/unit/shared/validation`
Expected: FAIL. `numbers` tira `SyntaxError: numbers out of order in {} quantifier` (es el bug); `validarFechaNoPasada` y `bancario` no existen.

- [ ] **Step 3: Implementar**

`src/shared/validation/numbers.ts` — reemplazar `patronDecimal` y el mensaje de formato de `parsearDecimal`:

```ts
function patronDecimal(enteros: number, decimales: number): RegExp {
  // Sin decimales no hay parte decimal: `\d{1,0}` ni siquiera es una regex válida.
  const parteDecimal = decimales > 0 ? `([.,]\\d{1,${decimales}})?` : '';
  return new RegExp(`^\\d{1,${enteros}}${parteDecimal}$`);
}

/** Qué se esperaba, para el mensaje de formato inválido. */
function mensajeFormato(etiqueta: string, decimales: number): string {
  if (decimales === 0) return `${etiqueta} debe ser un número entero, sin puntos ni comas`;
  const ejemplo = ' (ej. 12,5)';
  return `${etiqueta} debe ser un número con hasta ${decimales} decimal${decimales === 1 ? '' : 'es'}${ejemplo}`;
}
```

y dentro de `parsearDecimal`, reemplazar el bloque del `if (!patronDecimal(...))` por:

```ts
  if (!patronDecimal(enteros, decimales).test(texto)) {
    return { valido: false, error: mensajeFormato(etiqueta, decimales) };
  }
```

`src/shared/validation/dates.ts` — al final del archivo:

```ts
/** Fecha de algo planificado (inicio de una campaña): existente y de hoy en adelante. */
export function validarFechaNoPasada(
  valor: string | Date | null | undefined,
  etiqueta: string,
): ResultadoFecha {
  const fecha = parsearFecha(valor);

  if (!fecha) return { valida: false, error: `${etiqueta} no es válida` };
  if (esPasada(fecha)) return { valida: false, error: `${etiqueta} no puede ser anterior a hoy` };

  return { valida: true, fecha };
}
```

Crear `src/shared/validation/bancario.ts`:

```ts
/**
 * Datos para transferir: alias y CBU/CVU (spec 026). Funciones puras, sin dependencias.
 *
 * Los dos son opcionales por separado (la campaña exige al menos uno, eso lo decide el DTO).
 * Sólo se valida el formato: los dígitos verificadores del CBU quedan fuera de alcance.
 */
import { LIMITES } from './limits';

export type ResultadoBancario =
  { valido: true; valor: string | null } | { valido: false; error: string };

const REGEX_ALIAS = /^[A-Za-z0-9.-]+$/;
const REGEX_CBU = /^\d+$/;

/** Formato BCRA: de 6 a 20 caracteres entre letras, números, puntos y guiones. */
export function validarAliasOpcional(valor: unknown): ResultadoBancario {
  const alias = typeof valor === 'string' ? valor.trim() : '';
  const { min, max } = LIMITES.campania.alias;

  if (alias === '') return { valido: true, valor: null };
  if (alias.length < min || alias.length > max) {
    return { valido: false, error: `El alias debe tener entre ${min} y ${max} caracteres` };
  }
  if (!REGEX_ALIAS.test(alias)) {
    return {
      valido: false,
      error: 'El alias sólo puede tener letras, números, puntos y guiones',
    };
  }

  return { valido: true, valor: alias };
}

/** CBU o CVU: 22 dígitos. Los espacios se descartan porque suelen venir al copiar y pegar. */
export function validarCbuOpcional(valor: unknown): ResultadoBancario {
  const cbu = typeof valor === 'string' ? valor.replace(/\s+/g, '') : '';
  const { largo } = LIMITES.campania.cbu;

  if (cbu === '') return { valido: true, valor: null };
  if (cbu.length !== largo || !REGEX_CBU.test(cbu)) {
    return { valido: false, error: `El CBU o CVU debe tener ${largo} números` };
  }

  return { valido: true, valor: cbu };
}
```

`src/shared/validation/schemas.ts` — sumar los imports (`validarFechaNoPasada` desde `./dates`, y `validarAliasOpcional`, `validarCbuOpcional` desde `./bancario`) y agregar después de `fechaFuturaOpcionalSchema`:

```ts
/** Fecha de hoy en adelante y obligatoria (ej. inicio de una campaña). */
export function fechaNoPasadaSchema(etiqueta: string) {
  return z.unknown().transform((valor, ctx) => {
    const resultado = validarFechaNoPasada(valor as string | Date, etiqueta);

    if (!resultado.valida) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.fecha;
  });
}

/** Alias para transferir. Vacío o ausente → `null`. */
export function aliasOpcionalSchema() {
  return z.unknown().transform((valor, ctx) => {
    const resultado = validarAliasOpcional(valor);

    if (!resultado.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.valor;
  });
}

/** CBU o CVU. Vacío o ausente → `null`. */
export function cbuOpcionalSchema() {
  return z.unknown().transform((valor, ctx) => {
    const resultado = validarCbuOpcional(valor);

    if (!resultado.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: resultado.error });
      return z.NEVER;
    }

    return resultado.valor;
  });
}
```

`src/shared/validation/limits.ts` — agregar al final del objeto `LIMITES`, después de `animalPerdido`:

```ts
  /** Campaña de donación (spec 026, HU-12.1). */
  campania: {
    /** La HU no lo fija: el equipo lo acotó a lo que entra en la tarjeta (spec 026 §6.1). */
    titulo: { min: 3, max: 50 },
    /** Lo fija la HU. */
    descripcion: { max: 300 },
    /** Lo fija la HU: «solo números», sin decimales. */
    objetivo: { min: 10000, max: 2500000, decimales: 0 },
    /** Formato BCRA del alias. */
    alias: { min: 6, max: 20 },
    /** CBU o CVU: siempre 22 dígitos. */
    cbu: { largo: 22 },
    /** Campañas Inactiva + Activa por refugio (regla transversal 7, spec 026 §6.3). */
    vigentesPorRefugio: 5,
    /** Tamaño de página de los listados (paginación por cursor). */
    pagina: { porDefecto: 20, maximo: 50 },
  },

  /** Donación declarada por el adoptante (spec 026, HU-12.3). */
  donacion: {
    /** La HU no lo fija: el techo es el objetivo máximo de una campaña. */
    monto: { min: 1, max: 2500000, decimales: 2 },
    /** Tamaño de página de la bandeja de revisión del refugio. */
    pagina: { porDefecto: 30, maximo: 50 },
  },
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run tests/unit/shared/validation`
Expected: PASS (todos, incluidos los que ya existían).

- [ ] **Step 5: Commit**

```bash
git add src/shared/validation tests/unit/shared/validation
git commit -m "Validación compartida para campañas: enteros, fecha no pasada, alias y CBU

parsearDecimal tiraba con decimales: 0 (la regex quedaba \d{1,0}).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Modelo de datos — alias/CBU, `EstadoDonacion`, estado y motivo de la donación

**Files:**
- Modify: `prisma/schema.prisma` (modelos `Campania`, `Donacion`, nuevo `EstadoDonacion`)
- Create: `prisma/migrations/<timestamp>_hu12_campanias_donaciones/migration.sql`
- Modify: `prisma/seed/catalogos.ts`, `prisma/seed/comun.ts`, `prisma/seed/comunidad.ts`
- Modify: `docs/MODELO_DATOS.md` (secciones Campaña, Estado_Campaña, Donacion, catálogo nuevo)
- Add: `docs/specs/026-campanias.md`, `docs/specs/README.md` (vienen sin commitear desde `dev`)

**Interfaces:**
- Produces: `prisma.estadoDonacion`; `Campania.alias: string | null`, `Campania.cbu: string | null`; `Donacion.estadoDonacionId: number`, `Donacion.motivoRechazo: string | null`, relación `Donacion.estadoDonacion`; `Catalogos.estadosDonacion: Map<string, number>`.

- [ ] **Step 1: Editar `prisma/schema.prisma`**

En `model Campania`, después de `imagenUrl`:

```prisma
  // Datos para transferir (spec 026): al menos uno de los dos, lo exige el DTO.
  alias            String?  @map("campania_alias")
  cbu              String?  @map("campania_cbu")
```

y antes de `@@map("campania")`:

```prisma
  @@index([refugioId, estadoCampaniaId])
```

Agregar el catálogo nuevo después de `model EstadoCampania { ... }`:

```prisma
// Estado de una donación declarada (spec 026, HU-12.3): Pendiente hasta que el refugio la
// aplica (Realizada, suma al progreso) o la rechaza (Cancelada, no suma).
model EstadoDonacion {
  id          Int     @id @default(autoincrement()) @map("estado_donacion_id")
  nombre      String  @unique @map("estado_donacion_nombre")
  descripcion String? @map("estado_donacion_descripcion")

  usuarioAlta         Int       @map("estado_donacion_usuario_alta")
  fechaAlta           DateTime  @default(now()) @map("estado_donacion_fecha_alta")
  usuarioModificacion Int?      @map("estado_donacion_usuario_modificacion")
  fechaModificacion   DateTime? @map("estado_donacion_fecha_modificacion")
  usuarioBaja         Int?      @map("estado_donacion_usuario_baja")
  fechaBaja           DateTime? @map("estado_donacion_fecha_baja")

  donaciones Donacion[]

  @@map("estado_donacion")
}
```

En `model Donacion`, después de `usuarioId`:

```prisma
  estadoDonacionId Int     @map("estado_donacion_id")
  /// NO_RECIBIDA | MONTO_NO_COINCIDE. Sólo en una donación Cancelada.
  motivoRechazo    String? @map("donacion_motivo_rechazo")
```

después de la relación `usuario`:

```prisma
  estadoDonacion EstadoDonacion @relation(fields: [estadoDonacionId], references: [id])
```

y antes de `@@map("donacion")`:

```prisma
  @@index([campaniaId, estadoDonacionId])
```

- [ ] **Step 2: Generar la migración vacía y reemplazar su SQL**

Run (con la base local levantada: `docker compose up -d`):

```bash
npx prisma migrate dev --create-only --name hu12_campanias_donaciones
```

Prisma genera un `ALTER TABLE "donacion" ADD COLUMN "estado_donacion_id" INTEGER NOT NULL`, que falla con donaciones existentes. Reemplazar TODO el contenido del `migration.sql` generado por:

```sql
-- Spec 026 (HU-12.1 a HU-12.3): alias/CBU por campaña y estado de la donación.

-- CreateTable
CREATE TABLE "estado_donacion" (
    "estado_donacion_id" SERIAL NOT NULL,
    "estado_donacion_nombre" TEXT NOT NULL,
    "estado_donacion_descripcion" TEXT,
    "estado_donacion_usuario_alta" INTEGER NOT NULL,
    "estado_donacion_fecha_alta" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado_donacion_usuario_modificacion" INTEGER,
    "estado_donacion_fecha_modificacion" TIMESTAMP(3),
    "estado_donacion_usuario_baja" INTEGER,
    "estado_donacion_fecha_baja" TIMESTAMP(3),

    CONSTRAINT "estado_donacion_pkey" PRIMARY KEY ("estado_donacion_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estado_donacion_estado_donacion_nombre_key" ON "estado_donacion"("estado_donacion_nombre");

-- Los estados van acá y no sólo en el seed: la columna NOT NULL de abajo necesita "Realizada"
-- para las donaciones que ya existen. El seed los upsertea por nombre, así que no se duplican.
-- usuario_alta = 1 es el usuario SISTEMA (src/shared/auditoria.ts).
INSERT INTO "estado_donacion" ("estado_donacion_nombre", "estado_donacion_usuario_alta")
VALUES ('Pendiente', 1), ('Realizada', 1), ('Cancelada', 1);

-- AlterTable
ALTER TABLE "campania" ADD COLUMN "campania_alias" TEXT,
ADD COLUMN "campania_cbu" TEXT;

-- AlterTable: primero nullable, se completa y recién después NOT NULL. Las donaciones que ya
-- existían quedan "Realizada" porque hasta hoy los dashboards las contaban como donadas.
ALTER TABLE "donacion" ADD COLUMN "estado_donacion_id" INTEGER,
ADD COLUMN "donacion_motivo_rechazo" TEXT;

UPDATE "donacion"
SET "estado_donacion_id" = (
    SELECT "estado_donacion_id" FROM "estado_donacion" WHERE "estado_donacion_nombre" = 'Realizada'
);

ALTER TABLE "donacion" ALTER COLUMN "estado_donacion_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "campania_refugio_id_estado_campania_id_idx" ON "campania"("refugio_id", "estado_campania_id");

-- CreateIndex
CREATE INDEX "donacion_campania_id_estado_donacion_id_idx" ON "donacion"("campania_id", "estado_donacion_id");

-- AddForeignKey
ALTER TABLE "donacion" ADD CONSTRAINT "donacion_estado_donacion_id_fkey" FOREIGN KEY ("estado_donacion_id") REFERENCES "estado_donacion"("estado_donacion_id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Aplicar y verificar que no queda drift**

```bash
npx prisma migrate dev
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

Expected: la migración se aplica; `migrate diff` sale con código 0 («No difference detected»). Si reporta diferencias, corregir los nombres de índice/constraint del SQL para que coincidan con lo que pide el diff.

- [ ] **Step 4: Seed — catálogo**

`prisma/seed/catalogos.ts`:
- Sumar `| 'estadoDonacion'` al tipo `CatalogoSimple`.
- Sumar al `switch` de `upsertPorNombre`:

```ts
      case 'estadoDonacion':
        await prisma.estadoDonacion.upsert(args);
        break;
```

- Después del `upsertPorNombre('estadoCampania', ...)`:

```ts
  await upsertPorNombre('estadoDonacion', ['Pendiente', 'Realizada', 'Cancelada'], sistemaId);
```

- En `cargarCatalogos`, después de `estadosCampania`:

```ts
    estadosDonacion: mapaPorNombre(await prisma.estadoDonacion.findMany()),
```

`prisma/seed/comun.ts` — en `interface Catalogos`, después de `estadosCampania: Map<string, number>;`:

```ts
  estadosDonacion: Map<string, number>;
```

- [ ] **Step 5: Seed — campañas con alias/CBU y donaciones en los tres estados**

`prisma/seed/comunidad.ts`:
- En `interface DefCampania`, agregar `alias?: string;` y `cbu?: string;`, y cambiar el tipo de `donaciones` a:

```ts
  /** Repartidas en varios meses para poblar donacionesPorMes. Sin estado → Realizada. */
  donaciones: {
    usuario: Donante;
    monto: number;
    haceMeses: number;
    estado?: 'Pendiente' | 'Realizada' | 'Cancelada';
    motivo?: 'NO_RECIBIDA' | 'MONTO_NO_COINCIDE';
  }[];
```

- En «Castraciones de primavera»: `alias: 'patitas.castra.mp', cbu: '0000003100012345678901',` y sumar a sus donaciones:

```ts
      { usuario: 'carla', monto: 3500, haceMeses: 0, estado: 'Pendiente' },
      { usuario: 'lucia', monto: 2500, haceMeses: 0, estado: 'Pendiente' },
      { usuario: 'martin', monto: 20000, haceMeses: 1, estado: 'Cancelada', motivo: 'MONTO_NO_COINCIDE' },
```

- En «Techo nuevo para los caniles»: `alias: 'patitas.techo.mp',`. En «Rifa solidaria de fin de año»: `alias: 'patitas.rifa.mp',`. En «Alimento para el invierno»: `cbu: '2850590940090418135201',` y sumar `{ usuario: 'martin', monto: 5000, haceMeses: 0, estado: 'Pendiente' }`.
- En `seedCampanias`, en el `create` de la campaña sumar `alias: def.alias ?? null, cbu: def.cbu ?? null,`. Y justo después del bloque `if (!campania) { ... }`, completar las campañas sembradas antes de esta migración:

```ts
    // Campañas sembradas antes de la spec 026: sin datos para transferir no se puede donar.
    if (campania.alias === null && campania.cbu === null && (def.alias || def.cbu)) {
      campania = await prisma.campania.update({
        where: { id: campania.id },
        data: { alias: def.alias ?? null, cbu: def.cbu ?? null },
      });
    }
```

- En el `create` de la donación sumar:

```ts
          estadoDonacionId: id(catalogos.estadosDonacion, donacion.estado ?? 'Realizada'),
          motivoRechazo: donacion.motivo ?? null,
```

- [ ] **Step 6: Correr el seed dos veces (idempotencia) y los tests**

```bash
npm run seed
npm run seed
npm test
```

Expected: el seed termina sin error las dos veces; `npm test` en verde (el cliente de Prisma regenerado no rompe nada existente).

- [ ] **Step 7: Actualizar `docs/MODELO_DATOS.md`**

- En «### Campaña», agregar a la lista de campos `campaña_alias` y `campaña_cbu`, y un párrafo: «**Campos agregados fuera del diagrama de clases (2026-09-30, spec 026):** `campaña_alias` y `campaña_cbu`, nullables; la campaña exige al menos uno (DTO). Índice `(refugio_id, estado_campaña_id)` para la quota y el listado del refugio.»
- Nueva sección «### Estado_Donacion» después de «### Estado_Campaña»: «Catálogo nuevo (spec 026). Valores: Pendiente, Realizada, Cancelada.»
- En «### Donacion», agregar `FK estado_donacion_id FK NOT NULL` y `donacion_motivo_rechazo` (nullable: `NO_RECIBIDA` | `MONTO_NO_COINCIDE`), y reemplazar la «Regla de negocio crítica» por: «El monto declarado nace en «Pendiente» y NO impacta el progreso. Sólo suman las «Realizada»: el refugio verifica el ingreso real y la aplica (HU-12.3). Si la rechaza queda «Cancelada» con motivo. Quién y cuándo la revisó sale de la auditoría (`donacion_usuario_modificacion`, `donacion_fecha_modificacion`).»
- En el catálogo de estados de la sección de catálogos (línea ~31, junto a `Estado_Campaña`), agregar la línea de `Estado_Donacion`.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations prisma/seed docs/MODELO_DATOS.md docs/specs/026-campanias.md docs/specs/README.md
git commit -m "Modelo de campañas: alias/CBU y estado de la donación (spec 026)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Máquina de estados pura

**Files:**
- Create: `src/modules/campanias/campanias.estados.ts`
- Test: `tests/unit/modules/campanias.estados.test.ts`

**Interfaces:**
- Produces:
  - `ESTADO_CAMPANIA = { INACTIVA: 'Inactiva', ACTIVA: 'Activa', FINALIZADA: 'Finalizada', CANCELADA: 'Cancelada' }`, `type NombreEstadoCampania`
  - `ESTADO_DONACION = { PENDIENTE: 'Pendiente', REALIZADA: 'Realizada', CANCELADA: 'Cancelada' }`, `type NombreEstadoDonacion`
  - `ESTADOS_VIGENTES: readonly NombreEstadoCampania[]` (`['Inactiva', 'Activa']`)
  - `ESTADOS_MANUALES = ['Finalizada', 'Cancelada'] as const`, `type EstadoManual`
  - `MOTIVOS_RECHAZO = ['NO_RECIBIDA', 'MONTO_NO_COINCIDE'] as const`, `type MotivoRechazo`
  - `transicionManualPermitida(desde: string, hacia: EstadoManual): boolean`
  - `interface CampaniaParaEvaluar { estado: string; fechaInicio: Date; fechaFin: Date; objetivo: number; recaudado: number }`
  - `siguienteEstadoAutomatico(c: CampaniaParaEvaluar, ahora: Date): NombreEstadoCampania | null`
  - `calcularPorcentaje(recaudado: number, objetivo: number): number`

- [ ] **Step 1: Test que falla**

```ts
import { describe, expect, it } from 'vitest';
import {
  calcularPorcentaje,
  siguienteEstadoAutomatico,
  transicionManualPermitida,
  type CampaniaParaEvaluar,
} from '../../../src/modules/campanias/campanias.estados';

const AHORA = new Date(2026, 8, 30, 12, 0, 0);

function dia(offset: number): Date {
  return new Date(2026, 8, 30 + offset);
}

function campania(opciones: Partial<CampaniaParaEvaluar>): CampaniaParaEvaluar {
  return {
    estado: 'Activa',
    fechaInicio: dia(-10),
    fechaFin: dia(10),
    objetivo: 100000,
    recaudado: 0,
    ...opciones,
  };
}

describe('siguienteEstadoAutomatico', () => {
  it('activa una Inactiva cuya fecha de inicio es hoy', () => {
    expect(siguienteEstadoAutomatico(campania({ estado: 'Inactiva', fechaInicio: dia(0) }), AHORA)).toBe('Activa');
  });

  it('deja Inactiva una que empieza mañana', () => {
    expect(siguienteEstadoAutomatico(campania({ estado: 'Inactiva', fechaInicio: dia(1) }), AHORA)).toBeNull();
  });

  it('una Activa que termina hoy sigue Activa hasta el fin del día', () => {
    expect(siguienteEstadoAutomatico(campania({ fechaFin: dia(0) }), AHORA)).toBeNull();
  });

  it('finaliza una Activa cuya fecha de fin ya pasó', () => {
    expect(siguienteEstadoAutomatico(campania({ fechaFin: dia(-1) }), AHORA)).toBe('Finalizada');
  });

  it('finaliza una Activa que alcanzó el objetivo', () => {
    expect(siguienteEstadoAutomatico(campania({ recaudado: 100000 }), AHORA)).toBe('Finalizada');
  });

  it('una Inactiva con el fin vencido termina Finalizada en una sola corrida', () => {
    expect(
      siguienteEstadoAutomatico(campania({ estado: 'Inactiva', fechaInicio: dia(-5), fechaFin: dia(-1) }), AHORA),
    ).toBe('Finalizada');
  });

  it('no toca estados finales', () => {
    expect(siguienteEstadoAutomatico(campania({ estado: 'Finalizada', fechaFin: dia(-1) }), AHORA)).toBeNull();
    expect(siguienteEstadoAutomatico(campania({ estado: 'Cancelada', recaudado: 999999 }), AHORA)).toBeNull();
  });
});

describe('transicionManualPermitida', () => {
  it('finalizar sólo desde Activa', () => {
    expect(transicionManualPermitida('Activa', 'Finalizada')).toBe(true);
    expect(transicionManualPermitida('Inactiva', 'Finalizada')).toBe(false);
    expect(transicionManualPermitida('Cancelada', 'Finalizada')).toBe(false);
  });

  it('cancelar desde Inactiva o Activa', () => {
    expect(transicionManualPermitida('Inactiva', 'Cancelada')).toBe(true);
    expect(transicionManualPermitida('Activa', 'Cancelada')).toBe(true);
    expect(transicionManualPermitida('Finalizada', 'Cancelada')).toBe(false);
  });
});

describe('calcularPorcentaje', () => {
  it('redondea hacia abajo', () => {
    expect(calcularPorcentaje(1430000, 2500000)).toBe(57);
  });

  it('se topea en 100 aunque el recaudado supere el objetivo', () => {
    expect(calcularPorcentaje(150000, 100000)).toBe(100);
  });

  it('0 con objetivo 0, para no dividir por cero', () => {
    expect(calcularPorcentaje(10, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/unit/modules/campanias.estados.test.ts`
Expected: FAIL, «Failed to resolve import».

- [ ] **Step 3: Implementar `src/modules/campanias/campanias.estados.ts`**

```ts
/**
 * Máquina de estados de la campaña y cuentas del progreso (spec 026 §6.4). Funciones puras:
 * las usan el servicio (alta, finalizar/cancelar, aplicar una donación) y el cron (HU-12.4),
 * así la regla vive en un solo lugar.
 */
import { finDelDia, inicioDelDia } from '../../shared/validation/dates';

export const ESTADO_CAMPANIA = {
  INACTIVA: 'Inactiva',
  ACTIVA: 'Activa',
  FINALIZADA: 'Finalizada',
  CANCELADA: 'Cancelada',
} as const;

export type NombreEstadoCampania = (typeof ESTADO_CAMPANIA)[keyof typeof ESTADO_CAMPANIA];

export const ESTADO_DONACION = {
  PENDIENTE: 'Pendiente',
  REALIZADA: 'Realizada',
  CANCELADA: 'Cancelada',
} as const;

export type NombreEstadoDonacion = (typeof ESTADO_DONACION)[keyof typeof ESTADO_DONACION];

/** Las que cuentan para la quota de 5 (§6.3): todavía no cerraron. */
export const ESTADOS_VIGENTES: readonly NombreEstadoCampania[] = [
  ESTADO_CAMPANIA.INACTIVA,
  ESTADO_CAMPANIA.ACTIVA,
];

/** Los únicos estados que un miembro del refugio puede pedir a mano (HU-12.5 y HU-12.6). */
export const ESTADOS_MANUALES = [ESTADO_CAMPANIA.FINALIZADA, ESTADO_CAMPANIA.CANCELADA] as const;
export type EstadoManual = (typeof ESTADOS_MANUALES)[number];

/** Por qué el refugio rechaza una donación (HU-12.3). */
export const MOTIVOS_RECHAZO = ['NO_RECIBIDA', 'MONTO_NO_COINCIDE'] as const;
export type MotivoRechazo = (typeof MOTIVOS_RECHAZO)[number];

/** Desde qué estados se llega a cada estado manual. Finalizada y Cancelada son finales. */
const ORIGENES_MANUALES: Record<EstadoManual, readonly string[]> = {
  Finalizada: [ESTADO_CAMPANIA.ACTIVA],
  Cancelada: [ESTADO_CAMPANIA.INACTIVA, ESTADO_CAMPANIA.ACTIVA],
};

export function transicionManualPermitida(desde: string, hacia: EstadoManual): boolean {
  return ORIGENES_MANUALES[hacia].includes(desde);
}

export interface CampaniaParaEvaluar {
  estado: string;
  fechaInicio: Date;
  fechaFin: Date;
  objetivo: number;
  /** Suma de las donaciones Realizada. */
  recaudado: number;
}

/**
 * A qué estado lleva el SISTEMA a la campaña en este momento (HU-12.4), o `null` si no cambia.
 *
 * Aplica los dos pasos de una vez: una Inactiva con la fecha de fin ya vencida (por ejemplo, si
 * el cron no corrió) termina Finalizada en la misma corrida. La fecha de inicio cuenta desde el
 * comienzo de ese día y la de fin hasta su último instante.
 */
export function siguienteEstadoAutomatico(
  campania: CampaniaParaEvaluar,
  ahora: Date,
): NombreEstadoCampania | null {
  let estado = campania.estado;

  if (
    estado === ESTADO_CAMPANIA.INACTIVA &&
    inicioDelDia(campania.fechaInicio).getTime() <= ahora.getTime()
  ) {
    estado = ESTADO_CAMPANIA.ACTIVA;
  }

  if (
    estado === ESTADO_CAMPANIA.ACTIVA &&
    (finDelDia(campania.fechaFin).getTime() < ahora.getTime() ||
      campania.recaudado >= campania.objetivo)
  ) {
    estado = ESTADO_CAMPANIA.FINALIZADA;
  }

  return estado === campania.estado ? null : (estado as NombreEstadoCampania);
}

/** Para la barra: hacia abajo y topeado en 100 (el recaudado real puede superar el objetivo). */
export function calcularPorcentaje(recaudado: number, objetivo: number): number {
  if (objetivo <= 0) return 0;
  return Math.min(100, Math.floor((recaudado / objetivo) * 100));
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/unit/modules/campanias.estados.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/campanias/campanias.estados.ts tests/unit/modules/campanias.estados.test.ts
git commit -m "Máquina de estados de campañas (HU-12.4 a HU-12.7)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: DTOs y repository

**Files:**
- Create: `src/modules/campanias/campanias.dto.ts`
- Create: `src/modules/campanias/campanias.repository.ts`
- Test: `tests/unit/modules/campanias.dto.test.ts`

**Interfaces:**
- Consumes: schemas de Task 1; constantes de Task 3.
- Produces (DTO): `crearCampaniaSchema` → `CrearCampaniaDto { titulo; descripcion; objetivo: number; fechaInicio: Date; fechaFin: Date; alias: string | null; cbu: string | null }`; `paginaCampaniasSchema` → `PaginaCampaniasDto { cursor?: number; limite: number }`; `filtrosMisCampaniasSchema` → `FiltrosMisCampaniasDto { cursor?; limite; fechaDesde?: Date; fechaHasta?: Date; estados: number[] }`; `donarSchema` → `DonarDto { monto: number }`; `cambiarEstadoCampaniaSchema` → `{ estado: EstadoManual }`; `filtrosDonacionesSchema` → `FiltrosDonacionesDto { cursor?; limite; estado?: NombreEstadoDonacion }`; `resolverDonacionSchema` → `ResolverDonacionDto = { estado: 'Realizada' } | { estado: 'Cancelada'; motivo: MotivoRechazo }`; salidas `CampaniaDto`, `CampaniaRefugioDto`, `ListaCampaniasDto<T>`, `DonacionDto`, `ListaDonacionesDto`.
- Produces (repository): ver el código del Step 3. Nombres exactos: `SELECCION_CAMPANIA`, `CampaniaConRelaciones`, `DonacionConRelaciones`, `ResumenDonaciones`, `resumirDonaciones`, `buscarUsuarioConRefugio`, `buscarEstadosCampania`, `buscarEstadosDonacion`, `contarVigentes`, `crear`, `buscarPorId`, `existeCampania`, `listarDelRefugio`, `listarActivas`, `cambiarEstadoSi`, `listarVigentesParaCron`, `crearDonacion`, `buscarDonacion`, `buscarDonacionCompleta`, `existeDonacion`, `listarDonaciones`, `resolverDonacionSi`.

- [ ] **Step 1: Test del DTO que falla**

```ts
import { describe, expect, it } from 'vitest';
import {
  crearCampaniaSchema,
  donarSchema,
  resolverDonacionSchema,
} from '../../../src/modules/campanias/campanias.dto';

/** `AAAA-MM-DD` en hora LOCAL: con `toISOString` (UTC), de noche en Argentina sería mañana. */
function enDias(n: number): string {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + n);
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${mes}-${dia}`;
}

const VALIDA = {
  titulo: 'Castraciones de primavera',
  descripcion: 'Queremos castrar 80 animales del barrio.',
  objetivo: '250000',
  fechaInicio: enDias(1),
  fechaFin: enDias(60),
  alias: 'patitas.castra.mp',
  cbu: '',
};

function primerError(resultado: { success: boolean; error?: { issues: { message: string }[] } }) {
  return resultado.success ? undefined : resultado.error!.issues[0]!.message;
}

describe('crearCampaniaSchema', () => {
  it('acepta una campaña válida y normaliza alias/CBU', () => {
    const resultado = crearCampaniaSchema.parse(VALIDA);
    expect(resultado.objetivo).toBe(250000);
    expect(resultado.alias).toBe('patitas.castra.mp');
    expect(resultado.cbu).toBeNull();
  });

  it('exige alias o CBU', () => {
    expect(primerError(crearCampaniaSchema.safeParse({ ...VALIDA, alias: '', cbu: '' }))).toBe(
      'Cargá el alias o el CBU/CVU para que puedan donarte',
    );
  });

  it('exige fin posterior al inicio', () => {
    expect(
      primerError(crearCampaniaSchema.safeParse({ ...VALIDA, fechaFin: VALIDA.fechaInicio })),
    ).toBe('La fecha de fin tiene que ser posterior a la de inicio');
  });

  it('rechaza inicio en el pasado', () => {
    expect(primerError(crearCampaniaSchema.safeParse({ ...VALIDA, fechaInicio: enDias(-1) }))).toBe(
      'La fecha de inicio no puede ser anterior a hoy',
    );
  });

  it('rechaza objetivo fuera de rango y descripción larga', () => {
    expect(crearCampaniaSchema.safeParse({ ...VALIDA, objetivo: '9999' }).success).toBe(false);
    expect(crearCampaniaSchema.safeParse({ ...VALIDA, objetivo: '2500001' }).success).toBe(false);
    expect(crearCampaniaSchema.safeParse({ ...VALIDA, descripcion: 'a'.repeat(301) }).success).toBe(false);
  });
});

describe('donarSchema', () => {
  it('acepta coma o punto decimal', () => {
    expect(donarSchema.parse({ monto: '5000,50' }).monto).toBe(5000.5);
    expect(donarSchema.parse({ monto: '5000.50' }).monto).toBe(5000.5);
  });

  it('rechaza 0 y más de dos decimales', () => {
    expect(donarSchema.safeParse({ monto: '0' }).success).toBe(false);
    expect(donarSchema.safeParse({ monto: '10,555' }).success).toBe(false);
  });
});

describe('resolverDonacionSchema', () => {
  it('aplicar no pide motivo', () => {
    expect(resolverDonacionSchema.parse({ estado: 'Realizada' })).toEqual({ estado: 'Realizada' });
  });

  it('rechazar exige un motivo válido', () => {
    expect(primerError(resolverDonacionSchema.safeParse({ estado: 'Cancelada' }))).toBe(
      'Elegí por qué rechazás la donación',
    );
    expect(
      resolverDonacionSchema.parse({ estado: 'Cancelada', motivo: 'NO_RECIBIDA' }),
    ).toEqual({ estado: 'Cancelada', motivo: 'NO_RECIBIDA' });
  });

  it('rechaza otro estado', () => {
    expect(resolverDonacionSchema.safeParse({ estado: 'Pendiente' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/unit/modules/campanias.dto.test.ts`
Expected: FAIL, import no resuelto.

- [ ] **Step 3: Implementar `src/modules/campanias/campanias.dto.ts`**

```ts
/**
 * Entrada y salida de campañas y donaciones (spec 026). Las reglas genéricas salen de
 * `shared/validation`; acá sólo se compone lo propio de la campaña.
 */
import { z } from 'zod';
import { LIMITES } from '../../shared/validation/limits';
import {
  aliasOpcionalSchema,
  cbuOpcionalSchema,
  decimalSchema,
  fechaFiltroSchema,
  fechaNoPasadaSchema,
  idSchema,
  limitePaginaSchema,
  listaDeIdsSchema,
  textoSchema,
} from '../../shared/validation/schemas';
import {
  ESTADO_DONACION,
  ESTADOS_MANUALES,
  MOTIVOS_RECHAZO,
  type MotivoRechazo,
} from './campanias.estados';

const { campania, donacion } = LIMITES;

/** Alta (HU-12.1). Multipart: la imagen viaja aparte en `imagen`. */
export const crearCampaniaSchema = z
  .object({
    titulo: textoSchema({ ...campania.titulo, etiqueta: 'El título' }),
    descripcion: textoSchema({ max: campania.descripcion.max, etiqueta: 'La descripción' }),
    objetivo: decimalSchema({ ...campania.objetivo, etiqueta: 'El objetivo' }),
    fechaInicio: fechaNoPasadaSchema('La fecha de inicio'),
    fechaFin: fechaNoPasadaSchema('La fecha de fin'),
    alias: aliasOpcionalSchema(),
    cbu: cbuOpcionalSchema(),
  })
  .refine((datos) => datos.alias !== null || datos.cbu !== null, {
    message: 'Cargá el alias o el CBU/CVU para que puedan donarte',
    path: ['alias'],
  })
  .refine((datos) => datos.fechaFin.getTime() > datos.fechaInicio.getTime(), {
    message: 'La fecha de fin tiene que ser posterior a la de inicio',
    path: ['fechaFin'],
  });

export type CrearCampaniaDto = z.infer<typeof crearCampaniaSchema>;

/** Portal del adoptante: sólo paginación. */
export const paginaCampaniasSchema = z.object({
  cursor: idSchema('El cursor').optional(),
  limite: limitePaginaSchema(campania.pagina),
});

export type PaginaCampaniasDto = z.infer<typeof paginaCampaniasSchema>;

/**
 * «Mis Campañas» (HU-12.1). `fechaDesde`/`fechaHasta` filtran por la fecha de INICIO de la
 * campaña, inclusive; «hasta» sólo vale con «desde». `estados` son ids separados por coma.
 */
export const filtrosMisCampaniasSchema = z
  .object({
    cursor: idSchema('El cursor').optional(),
    limite: limitePaginaSchema(campania.pagina),
    fechaDesde: fechaFiltroSchema('La fecha "desde"'),
    fechaHasta: fechaFiltroSchema('La fecha "hasta"'),
    estados: listaDeIdsSchema('El estado'),
  })
  .refine((filtros) => !filtros.fechaHasta || filtros.fechaDesde, {
    message: 'Para filtrar por fecha, elegí la fecha "desde"',
  })
  .refine(
    (filtros) =>
      !filtros.fechaDesde || !filtros.fechaHasta || filtros.fechaDesde <= filtros.fechaHasta,
    { message: 'La fecha "desde" no puede ser posterior a "hasta"' },
  );

export type FiltrosMisCampaniasDto = z.infer<typeof filtrosMisCampaniasSchema>;

/** «Terminar donación» (HU-12.3): lo que el adoptante dice que transfirió. */
export const donarSchema = z.object({
  monto: decimalSchema({ ...donacion.monto, etiqueta: 'El monto' }),
});

export type DonarDto = z.infer<typeof donarSchema>;

/** Finalizar (HU-12.6) o cancelar (HU-12.5). */
export const cambiarEstadoCampaniaSchema = z.object({
  estado: z.enum(ESTADOS_MANUALES, {
    errorMap: () => ({ message: 'El estado tiene que ser "Finalizada" o "Cancelada"' }),
  }),
});

export type CambiarEstadoCampaniaDto = z.infer<typeof cambiarEstadoCampaniaSchema>;

/** Bandeja de revisión del refugio. Sin `estado`, todas. */
export const filtrosDonacionesSchema = z.object({
  cursor: idSchema('El cursor').optional(),
  limite: limitePaginaSchema(donacion.pagina),
  estado: z
    .enum([ESTADO_DONACION.PENDIENTE, ESTADO_DONACION.REALIZADA, ESTADO_DONACION.CANCELADA], {
      errorMap: () => ({ message: 'El estado no es válido' }),
    })
    .optional(),
});

export type FiltrosDonacionesDto = z.infer<typeof filtrosDonacionesSchema>;

/** Aplicar (suma al progreso) o rechazar con motivo (HU-12.3). */
export const resolverDonacionSchema = z.discriminatedUnion(
  'estado',
  [
    z.object({ estado: z.literal(ESTADO_DONACION.REALIZADA) }),
    z.object({
      estado: z.literal(ESTADO_DONACION.CANCELADA),
      motivo: z.enum(MOTIVOS_RECHAZO, {
        errorMap: () => ({ message: 'Elegí por qué rechazás la donación' }),
      }),
    }),
  ],
  { errorMap: () => ({ message: 'El estado tiene que ser "Realizada" o "Cancelada"' }) },
);

export type ResolverDonacionDto = z.infer<typeof resolverDonacionSchema>;

/** Una campaña, igual en el portal, en el detalle y en «Mis Campañas». */
export interface CampaniaDto {
  id: number;
  titulo: string;
  descripcion: string;
  /** `null` sólo en campañas sembradas antes de la spec 026. */
  imagenUrl: string | null;
  objetivo: number;
  /** Suma de las donaciones Realizada: lo único que mueve la barra (regla transversal 11). */
  recaudado: number;
  /** Hacia abajo y topeado en 100, para la barra. */
  porcentaje: number;
  /** Usuarios distintos con al menos una donación Realizada. */
  donantes: number;
  /** `AAAA-MM-DD`, sin hora. */
  fechaInicio: string;
  fechaFin: string;
  estado: { id: number; nombre: string };
  alias: string | null;
  cbu: string | null;
  refugio: { id: number; nombre: string; imagenUrl: string | null };
}

/** En «Mis Campañas», además, cuántas donaciones esperan revisión. */
export interface CampaniaRefugioDto extends CampaniaDto {
  pendientes: number;
}

export interface ListaCampaniasDto<T extends CampaniaDto> {
  campanias: T[];
  hayMas: boolean;
  proximoCursor: number | null;
}

export interface DonacionDto {
  id: number;
  monto: number;
  estado: { id: number; nombre: string };
  /** Sólo en una Cancelada. */
  motivoRechazo: MotivoRechazo | null;
  /** ISO 8601: cuándo la declaró el adoptante. */
  fechaAlta: string;
  donante: { id: number; nombre: string; apellido: string; imagenUrl: string | null };
}

export interface ListaDonacionesDto {
  donaciones: DonacionDto[];
  hayMas: boolean;
  proximoCursor: number | null;
}
```

- [ ] **Step 4: Implementar `src/modules/campanias/campanias.repository.ts`**

```ts
import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/prisma';
import { datosAlta, datosModificacion } from '../../shared/auditoria';
import { finDelDia, inicioDelDia } from '../../shared/validation/dates';
import {
  ESTADO_CAMPANIA,
  ESTADO_DONACION,
  ESTADOS_VIGENTES,
  type NombreEstadoDonacion,
} from './campanias.estados';

/** Lo que pinta una tarjeta, en una sola query. El progreso sale de `resumirDonaciones`. */
const SELECCION_CAMPANIA = {
  id: true,
  titulo: true,
  descripcion: true,
  imagenUrl: true,
  objetivo: true,
  fechaInicio: true,
  fechaFin: true,
  alias: true,
  cbu: true,
  refugioId: true,
  fechaAlta: true,
  estadoCampania: { select: { id: true, nombre: true } },
  refugio: { select: { id: true, nombre: true, imagenUrl: true } },
} satisfies Prisma.CampaniaSelect;

export type CampaniaConRelaciones = Prisma.CampaniaGetPayload<{
  select: typeof SELECCION_CAMPANIA;
}>;

const SELECCION_DONACION = {
  id: true,
  monto: true,
  motivoRechazo: true,
  fechaAlta: true,
  estadoDonacion: { select: { id: true, nombre: true } },
  usuario: { select: { id: true, nombre: true, apellido: true, imagenUrl: true } },
} satisfies Prisma.DonacionSelect;

export type DonacionConRelaciones = Prisma.DonacionGetPayload<{
  select: typeof SELECCION_DONACION;
}>;

export interface ResumenDonaciones {
  recaudado: number;
  donantes: number;
  pendientes: number;
}

/**
 * Recaudado, donantes y pendientes de varias campañas en tres queries agrupadas, sin N+1.
 * Sólo las Realizada suman (regla transversal 11). Toda campaña pedida tiene entrada, en 0 si
 * no tiene donaciones.
 */
export async function resumirDonaciones(
  campaniaIds: number[],
): Promise<Map<number, ResumenDonaciones>> {
  const resumen = new Map<number, ResumenDonaciones>(
    campaniaIds.map((id) => [id, { recaudado: 0, donantes: 0, pendientes: 0 }]),
  );
  if (campaniaIds.length === 0) return resumen;

  const base = { campaniaId: { in: campaniaIds }, fechaBaja: null };
  const realizadas = { ...base, estadoDonacion: { nombre: ESTADO_DONACION.REALIZADA } };

  const [montos, donantes, pendientes] = await Promise.all([
    prisma.donacion.groupBy({ by: ['campaniaId'], where: realizadas, _sum: { monto: true } }),
    prisma.donacion.groupBy({ by: ['campaniaId', 'usuarioId'], where: realizadas }),
    prisma.donacion.groupBy({
      by: ['campaniaId'],
      where: { ...base, estadoDonacion: { nombre: ESTADO_DONACION.PENDIENTE } },
      _count: { _all: true },
    }),
  ]);

  for (const fila of montos) {
    resumen.get(fila.campaniaId)!.recaudado = fila._sum.monto ? Number(fila._sum.monto) : 0;
  }
  for (const fila of donantes) {
    resumen.get(fila.campaniaId)!.donantes += 1;
  }
  for (const fila of pendientes) {
    resumen.get(fila.campaniaId)!.pendientes = fila._count._all;
  }

  return resumen;
}

/** El usuario con su refugio y lo necesario para saber si puede crear campañas. */
export function buscarUsuarioConRefugio(usuarioId: number) {
  return prisma.usuario.findFirst({
    where: { id: usuarioId, fechaBaja: null },
    select: {
      id: true,
      refugioId: true,
      refugio: {
        select: {
          id: true,
          verificado: true,
          fechaBaja: true,
          estado: { select: { nombre: true } },
        },
      },
    },
  });
}

export function buscarEstadosCampania() {
  return prisma.estadoCampania.findMany({
    where: { fechaBaja: null },
    select: { id: true, nombre: true },
  });
}

export function buscarEstadosDonacion() {
  return prisma.estadoDonacion.findMany({
    where: { fechaBaja: null },
    select: { id: true, nombre: true },
  });
}

/** Para la quota (§6.3): Inactiva + Activa del refugio. */
export function contarVigentes(refugioId: number) {
  return prisma.campania.count({
    where: {
      refugioId,
      fechaBaja: null,
      estadoCampania: { nombre: { in: [...ESTADOS_VIGENTES] } },
    },
  });
}

export function crear(
  datos: {
    titulo: string;
    descripcion: string;
    objetivo: number;
    fechaInicio: Date;
    fechaFin: Date;
    alias: string | null;
    cbu: string | null;
    imagenUrl: string;
    refugioId: number;
    estadoCampaniaId: number;
  },
  usuarioId: number,
) {
  return prisma.campania.create({
    data: { ...datos, ...datosAlta(usuarioId) },
    select: SELECCION_CAMPANIA,
  });
}

/** Una campaña no dada de baja. Cancelar NO la da de baja (§6.4): sigue apareciendo. */
export function buscarPorId(id: number) {
  return prisma.campania.findFirst({
    where: { id, fechaBaja: null },
    select: SELECCION_CAMPANIA,
  });
}

/** ¿Existe la campaña del cursor? Sin esto, Prisma devuelve una página vacía sin avisar. */
export function existeCampania(id: number) {
  return prisma.campania.findUnique({ where: { id }, select: { id: true } });
}

export interface FiltrosDelRefugio {
  fechaDesde?: Date;
  fechaHasta?: Date;
  estados: number[];
}

/**
 * «Mis Campañas», de la más reciente a la más vieja (por alta, con el id de desempate para que
 * el cursor no repita ni saltee). La fecha filtra por el INICIO de la campaña (HU-12.1).
 */
export function listarDelRefugio(
  refugioId: number,
  filtros: FiltrosDelRefugio,
  limite: number,
  cursor?: number,
) {
  const { fechaDesde, fechaHasta, estados } = filtros;

  return prisma.campania.findMany({
    where: {
      refugioId,
      fechaBaja: null,
      ...(fechaDesde
        ? {
            fechaInicio: {
              gte: inicioDelDia(fechaDesde),
              ...(fechaHasta ? { lte: finDelDia(fechaHasta) } : {}),
            },
          }
        : {}),
      ...(estados.length > 0 ? { estadoCampaniaId: { in: estados } } : {}),
    },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    select: SELECCION_CAMPANIA,
  });
}

/** Portal del adoptante (HU-12.2): sólo las Activa, de todos los refugios. */
export function listarActivas(limite: number, cursor?: number) {
  return prisma.campania.findMany({
    where: { fechaBaja: null, estadoCampania: { nombre: ESTADO_CAMPANIA.ACTIVA } },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    select: SELECCION_CAMPANIA,
  });
}

/**
 * Cambia el estado sólo si sigue en `desdeEstadoId`. Devuelve si cambió: `false` es la carrera
 * esperada con otro miembro o con el cron, no un error de base.
 */
export async function cambiarEstadoSi(
  id: number,
  desdeEstadoId: number,
  haciaEstadoId: number,
  usuarioId: number,
): Promise<boolean> {
  const { count } = await prisma.campania.updateMany({
    where: { id, estadoCampaniaId: desdeEstadoId, fechaBaja: null },
    data: { estadoCampaniaId: haciaEstadoId, ...datosModificacion(usuarioId) },
  });
  return count === 1;
}

/** Lo que evalúa el cron (HU-12.4): las que todavía pueden cambiar solas. */
export function listarVigentesParaCron() {
  return prisma.campania.findMany({
    where: { fechaBaja: null, estadoCampania: { nombre: { in: [...ESTADOS_VIGENTES] } } },
    select: {
      id: true,
      objetivo: true,
      fechaInicio: true,
      fechaFin: true,
      estadoCampania: { select: { nombre: true } },
    },
  });
}

export function crearDonacion(
  datos: { campaniaId: number; monto: number; estadoDonacionId: number },
  usuarioId: number,
) {
  return prisma.donacion.create({
    data: { ...datos, usuarioId, ...datosAlta(usuarioId) },
    select: SELECCION_DONACION,
  });
}

/** Lo justo para decidir si el refugio puede revisarla. */
export function buscarDonacion(id: number) {
  return prisma.donacion.findFirst({
    where: { id, fechaBaja: null },
    select: {
      id: true,
      campaniaId: true,
      estadoDonacion: { select: { nombre: true } },
      campania: { select: { refugioId: true } },
    },
  });
}

export function buscarDonacionCompleta(id: number) {
  return prisma.donacion.findFirst({ where: { id, fechaBaja: null }, select: SELECCION_DONACION });
}

export function existeDonacion(id: number) {
  return prisma.donacion.findUnique({ where: { id }, select: { id: true } });
}

/** Bandeja del refugio, de la más reciente a la más vieja. */
export function listarDonaciones(
  campaniaId: number,
  estado: NombreEstadoDonacion | undefined,
  limite: number,
  cursor?: number,
) {
  return prisma.donacion.findMany({
    where: {
      campaniaId,
      fechaBaja: null,
      ...(estado ? { estadoDonacion: { nombre: estado } } : {}),
    },
    orderBy: [{ fechaAlta: 'desc' }, { id: 'desc' }],
    take: limite + 1,
    ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    select: SELECCION_DONACION,
  });
}

/** Aplica o rechaza sólo si sigue Pendiente (carrera entre dos miembros, §8). */
export async function resolverDonacionSi(
  id: number,
  pendienteId: number,
  haciaEstadoId: number,
  motivoRechazo: string | null,
  usuarioId: number,
): Promise<boolean> {
  const { count } = await prisma.donacion.updateMany({
    where: { id, estadoDonacionId: pendienteId, fechaBaja: null },
    data: { estadoDonacionId: haciaEstadoId, motivoRechazo, ...datosModificacion(usuarioId) },
  });
  return count === 1;
}
```

- [ ] **Step 5: Correr los tests del DTO y el typecheck**

Run: `npx vitest run tests/unit/modules/campanias.dto.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS y sin errores de tipos. Si `prisma.donacion.groupBy` con `_count` pide `orderBy` en el tipo, sumar `orderBy: { campaniaId: 'asc' }` a ese groupBy.

- [ ] **Step 6: Commit**

```bash
git add src/modules/campanias tests/unit/modules/campanias.dto.test.ts
git commit -m "DTOs y repository de campañas y donaciones (spec 026)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Servicio

**Files:**
- Create: `src/modules/campanias/campanias.service.ts`
- Test: `tests/unit/modules/campanias.service.test.ts`

**Interfaces:**
- Consumes: repository y DTOs de Task 4; estados de Task 3; `guardarImagen`/`borrarImagen` (`src/shared/storage.ts`); `registrarAuditoria`; `USUARIO_SISTEMA_ID`.
- Produces:
  - `idsEstadosCampania(): Promise<Record<NombreEstadoCampania, number>>` (lo usa el cron)
  - `crearCampania(datos: CrearCampaniaDto, contexto: { usuarioId: number; archivo?: ArchivoImagen }): Promise<CampaniaRefugioDto>`
  - `listarCampaniasDelRefugio(filtros: FiltrosMisCampaniasDto, usuarioId: number): Promise<ListaCampaniasDto<CampaniaRefugioDto>>`
  - `cambiarEstadoCampania(campaniaId: number, hacia: EstadoManual, usuarioId: number): Promise<CampaniaRefugioDto>`
  - `listarPortal(pagina: PaginaCampaniasDto): Promise<ListaCampaniasDto<CampaniaDto>>`
  - `obtenerCampania(id: number): Promise<CampaniaDto>`
  - `donar(campaniaId: number, datos: DonarDto, usuarioId: number): Promise<DonacionDto>`
  - `listarDonaciones(campaniaId: number, filtros: FiltrosDonacionesDto, usuarioId: number): Promise<ListaDonacionesDto>`
  - `resolverDonacion(donacionId: number, datos: ResolverDonacionDto, usuarioId: number): Promise<DonacionDto>`
  - `type ArchivoImagen = Parameters<typeof guardarImagen>[0]`

- [ ] **Step 1: Test que falla — `tests/unit/modules/campanias.service.test.ts`**

```ts
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/middlewares/errorHandler';
import type { CrearCampaniaDto } from '../../../src/modules/campanias/campanias.dto';
import * as repo from '../../../src/modules/campanias/campanias.repository';
import * as service from '../../../src/modules/campanias/campanias.service';
import { USUARIO_SISTEMA_ID } from '../../../src/shared/auditoria';
import { registrarAuditoria } from '../../../src/shared/logAuditoria';
import { borrarImagen, guardarImagen } from '../../../src/shared/storage';

vi.mock('../../../src/modules/campanias/campanias.repository');
vi.mock('../../../src/shared/storage');
vi.mock('../../../src/shared/logAuditoria');

const USUARIO = 7;
const REFUGIO = 3;
const OTRO_REFUGIO = 4;
const URL_IMAGEN = '/api/v1/archivos/campanias/x.webp';
const ARCHIVO = { buffer: Buffer.from('img'), mimetype: 'image/webp' } as never;

const ESTADOS_CAMPANIA = [
  { id: 1, nombre: 'Inactiva' },
  { id: 2, nombre: 'Activa' },
  { id: 3, nombre: 'Finalizada' },
  { id: 4, nombre: 'Cancelada' },
];
const ESTADOS_DONACION = [
  { id: 11, nombre: 'Pendiente' },
  { id: 12, nombre: 'Realizada' },
  { id: 13, nombre: 'Cancelada' },
];

function enDias(n: number): Date {
  const fecha = new Date();
  fecha.setHours(0, 0, 0, 0);
  fecha.setDate(fecha.getDate() + n);
  return fecha;
}

function campania(
  id: number,
  opciones: { estado?: string; refugioId?: number; objetivo?: number; fechaInicio?: Date } = {},
): repo.CampaniaConRelaciones {
  const refugioId = opciones.refugioId ?? REFUGIO;
  return {
    id,
    titulo: 'Castraciones de primavera',
    descripcion: 'Queremos castrar 80 animales.',
    imagenUrl: URL_IMAGEN,
    objetivo: new Prisma.Decimal(opciones.objetivo ?? 100000),
    fechaInicio: opciones.fechaInicio ?? enDias(-10),
    fechaFin: enDias(30),
    alias: 'patitas.castra.mp',
    cbu: null,
    refugioId,
    fechaAlta: new Date('2026-09-01T12:00:00.000Z'),
    estadoCampania: ESTADOS_CAMPANIA.find((e) => e.nombre === (opciones.estado ?? 'Activa'))!,
    refugio: { id: refugioId, nombre: 'Patitas', imagenUrl: null },
  };
}

function donacion(id: number, estado = 'Pendiente'): repo.DonacionConRelaciones {
  return {
    id,
    monto: new Prisma.Decimal(5000),
    motivoRechazo: null,
    fechaAlta: new Date('2026-09-20T15:00:00.000Z'),
    estadoDonacion: ESTADOS_DONACION.find((e) => e.nombre === estado)!,
    usuario: { id: 20, nombre: 'Ana', apellido: 'Gómez', imagenUrl: null },
  };
}

function resumen(entradas: [number, Partial<repo.ResumenDonaciones>][]) {
  return new Map(
    entradas.map(([id, r]) => [id, { recaudado: 0, donantes: 0, pendientes: 0, ...r }]),
  );
}

function usuarioDeRefugio(
  opciones: { refugioId?: number | null; verificado?: boolean; estado?: string } = {},
) {
  const refugioId = opciones.refugioId === undefined ? REFUGIO : opciones.refugioId;
  return {
    id: USUARIO,
    refugioId,
    refugio:
      refugioId === null
        ? null
        : {
            id: refugioId,
            verificado: opciones.verificado ?? true,
            fechaBaja: null,
            estado: { nombre: opciones.estado ?? 'Activo' },
          },
  };
}

const DATOS: CrearCampaniaDto = {
  titulo: 'Castraciones de primavera',
  descripcion: 'Queremos castrar 80 animales.',
  objetivo: 100000,
  fechaInicio: enDias(1),
  fechaFin: enDias(60),
  alias: 'patitas.castra.mp',
  cbu: null,
};

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

  vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuarioDeRefugio() as never);
  vi.mocked(repo.buscarEstadosCampania).mockResolvedValue(ESTADOS_CAMPANIA);
  vi.mocked(repo.buscarEstadosDonacion).mockResolvedValue(ESTADOS_DONACION);
  vi.mocked(repo.contarVigentes).mockResolvedValue(0);
  vi.mocked(repo.crear).mockResolvedValue(campania(50, { estado: 'Inactiva', fechaInicio: enDias(1) }));
  vi.mocked(repo.cambiarEstadoSi).mockResolvedValue(true);
  vi.mocked(repo.resolverDonacionSi).mockResolvedValue(true);
  vi.mocked(repo.resumirDonaciones).mockImplementation(async (ids) => resumen(ids.map((id) => [id, {}])));
  vi.mocked(guardarImagen).mockResolvedValue(URL_IMAGEN);
});

describe('crearCampania', () => {
  it('la crea Inactiva con la imagen guardada y audita', async () => {
    const creada = await service.crearCampania(DATOS, { usuarioId: USUARIO, archivo: ARCHIVO });

    expect(guardarImagen).toHaveBeenCalledWith(ARCHIVO, 'campanias');
    expect(repo.crear).toHaveBeenCalledWith(
      expect.objectContaining({ refugioId: REFUGIO, estadoCampaniaId: 1, imagenUrl: URL_IMAGEN }),
      USUARIO,
    );
    expect(repo.cambiarEstadoSi).not.toHaveBeenCalled();
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'CREAR', entidad: 'Campania', entidadId: 50 }),
    );
    expect(creada).toMatchObject({ id: 50, estado: { nombre: 'Inactiva' }, recaudado: 0, pendientes: 0 });
  });

  it('si empieza hoy la activa en el momento, como SISTEMA', async () => {
    vi.mocked(repo.crear).mockResolvedValue(campania(50, { estado: 'Inactiva', fechaInicio: enDias(0) }));
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(50, { estado: 'Activa', fechaInicio: enDias(0) }));

    const creada = await service.crearCampania(
      { ...DATOS, fechaInicio: enDias(0) },
      { usuarioId: USUARIO, archivo: ARCHIVO },
    );

    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(50, 1, 2, USUARIO_SISTEMA_ID);
    expect(creada.estado.nombre).toBe('Activa');
  });

  it('sin imagen no crea nada', async () => {
    expect(await codigoDeError(service.crearCampania(DATOS, { usuarioId: USUARIO }))).toBe('IMAGEN_REQUERIDA');
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it('exige refugio verificado y activo', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuarioDeRefugio({ verificado: false }) as never);
    expect(await codigoDeError(service.crearCampania(DATOS, { usuarioId: USUARIO, archivo: ARCHIVO }))).toBe(
      'REFUGIO_NO_HABILITADO',
    );

    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuarioDeRefugio({ estado: 'Suspendido' }) as never);
    expect(await codigoDeError(service.crearCampania(DATOS, { usuarioId: USUARIO, archivo: ARCHIVO }))).toBe(
      'REFUGIO_NO_HABILITADO',
    );
  });

  it('con 5 vigentes corta antes de subir la imagen', async () => {
    vi.mocked(repo.contarVigentes).mockResolvedValue(5);

    expect(await codigoDeError(service.crearCampania(DATOS, { usuarioId: USUARIO, archivo: ARCHIVO }))).toBe(
      'LIMITE_CAMPANIAS',
    );
    expect(guardarImagen).not.toHaveBeenCalled();
  });

  it('si falla la base, borra la imagen subida', async () => {
    vi.mocked(repo.crear).mockRejectedValue(new Error('db caída'));

    await expect(service.crearCampania(DATOS, { usuarioId: USUARIO, archivo: ARCHIVO })).rejects.toThrow('db caída');
    expect(borrarImagen).toHaveBeenCalledWith(URL_IMAGEN);
  });
});

describe('cambiarEstadoCampania', () => {
  it('finaliza una Activa', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8));

    await service.cambiarEstadoCampania(8, 'Finalizada', USUARIO);

    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(8, 2, 3, USUARIO);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'CAMBIAR_ESTADO', entidadId: 8, detalle: 'Activa -> Finalizada' }),
    );
  });

  it('cancela una Inactiva', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { estado: 'Inactiva' }));

    await service.cambiarEstadoCampania(8, 'Cancelada', USUARIO);

    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(8, 1, 4, USUARIO);
  });

  it('no finaliza una Inactiva', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { estado: 'Inactiva' }));

    expect(await codigoDeError(service.cambiarEstadoCampania(8, 'Finalizada', USUARIO))).toBe(
      'TRANSICION_INVALIDA',
    );
  });

  it('una campaña de otro refugio es 404', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { refugioId: OTRO_REFUGIO }));

    expect(await codigoDeError(service.cambiarEstadoCampania(8, 'Cancelada', USUARIO))).toBe(
      'CAMPANIA_NO_ENCONTRADA',
    );
  });

  it('carrera: si otro la cambió recién, 409', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8));
    vi.mocked(repo.cambiarEstadoSi).mockResolvedValue(false);

    expect(await codigoDeError(service.cambiarEstadoCampania(8, 'Finalizada', USUARIO))).toBe(
      'TRANSICION_INVALIDA',
    );
  });
});

describe('listarCampaniasDelRefugio', () => {
  it('pagina y suma el progreso de cada campaña', async () => {
    vi.mocked(repo.listarDelRefugio).mockResolvedValue([campania(9), campania(8), campania(7)]);
    vi.mocked(repo.resumirDonaciones).mockResolvedValue(
      resumen([[9, { recaudado: 57000, donantes: 3, pendientes: 2 }], [8, {}]]),
    );

    const lista = await service.listarCampaniasDelRefugio(
      { limite: 2, estados: [] },
      USUARIO,
    );

    expect(repo.listarDelRefugio).toHaveBeenCalledWith(REFUGIO, { estados: [] }, 2, undefined);
    expect(lista.hayMas).toBe(true);
    expect(lista.proximoCursor).toBe(8);
    expect(lista.campanias[0]).toMatchObject({ id: 9, recaudado: 57000, porcentaje: 57, donantes: 3, pendientes: 2 });
  });

  it('un cursor inexistente corta con 400', async () => {
    vi.mocked(repo.existeCampania).mockResolvedValue(null);

    expect(
      await codigoDeError(service.listarCampaniasDelRefugio({ cursor: 999, limite: 20, estados: [] }, USUARIO)),
    ).toBe('CURSOR_INVALIDO');
  });
});

describe('donar', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuarioDeRefugio({ refugioId: null }) as never);
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8));
    vi.mocked(repo.crearDonacion).mockResolvedValue(donacion(30));
  });

  it('registra la donación Pendiente sin tocar el estado de la campaña', async () => {
    const creada = await service.donar(8, { monto: 5000 }, USUARIO);

    expect(repo.crearDonacion).toHaveBeenCalledWith({ campaniaId: 8, monto: 5000, estadoDonacionId: 11 }, USUARIO);
    expect(repo.cambiarEstadoSi).not.toHaveBeenCalled();
    expect(creada).toMatchObject({ id: 30, monto: 5000, estado: { nombre: 'Pendiente' } });
  });

  it('no se dona a una campaña que no está Activa', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { estado: 'Inactiva' }));

    expect(await codigoDeError(service.donar(8, { monto: 5000 }, USUARIO))).toBe('CAMPANIA_NO_ACTIVA');
  });

  it('un miembro no dona a su propio refugio', async () => {
    vi.mocked(repo.buscarUsuarioConRefugio).mockResolvedValue(usuarioDeRefugio() as never);

    expect(await codigoDeError(service.donar(8, { monto: 5000 }, USUARIO))).toBe('DONACION_PROPIA');
  });

  it('una campaña inexistente es 404', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(null);

    expect(await codigoDeError(service.donar(8, { monto: 5000 }, USUARIO))).toBe('CAMPANIA_NO_ENCONTRADA');
  });
});

describe('resolverDonacion', () => {
  beforeEach(() => {
    vi.mocked(repo.buscarDonacion).mockResolvedValue({
      id: 30,
      campaniaId: 8,
      estadoDonacion: { nombre: 'Pendiente' },
      campania: { refugioId: REFUGIO },
    });
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { objetivo: 100000 }));
    vi.mocked(repo.buscarDonacionCompleta).mockResolvedValue(donacion(30, 'Realizada'));
  });

  it('aplicar la pasa a Realizada', async () => {
    const resultado = await service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO);

    expect(repo.resolverDonacionSi).toHaveBeenCalledWith(30, 11, 12, null, USUARIO);
    expect(resultado.estado.nombre).toBe('Realizada');
    expect(repo.cambiarEstadoSi).not.toHaveBeenCalled();
  });

  it('rechazar guarda el motivo', async () => {
    await service.resolverDonacion(30, { estado: 'Cancelada', motivo: 'NO_RECIBIDA' }, USUARIO);

    expect(repo.resolverDonacionSi).toHaveBeenCalledWith(30, 11, 13, 'NO_RECIBIDA', USUARIO);
  });

  it('aplicar la que completa el objetivo finaliza la campaña como SISTEMA', async () => {
    vi.mocked(repo.resumirDonaciones).mockResolvedValue(resumen([[8, { recaudado: 100000 }]]));

    await service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO);

    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(8, 2, 3, USUARIO_SISTEMA_ID);
  });

  it('aplicar sobre una campaña ya Finalizada no la vuelve a tocar', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { estado: 'Finalizada' }));
    vi.mocked(repo.resumirDonaciones).mockResolvedValue(resumen([[8, { recaudado: 999999 }]]));

    await service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO);

    expect(repo.resolverDonacionSi).toHaveBeenCalled();
    expect(repo.cambiarEstadoSi).not.toHaveBeenCalled();
  });

  it('una ya revisada es 409', async () => {
    vi.mocked(repo.buscarDonacion).mockResolvedValue({
      id: 30,
      campaniaId: 8,
      estadoDonacion: { nombre: 'Realizada' },
      campania: { refugioId: REFUGIO },
    });

    expect(await codigoDeError(service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO))).toBe(
      'TRANSICION_INVALIDA',
    );
  });

  it('carrera: si otro miembro la resolvió recién, 409', async () => {
    vi.mocked(repo.resolverDonacionSi).mockResolvedValue(false);

    expect(await codigoDeError(service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO))).toBe(
      'TRANSICION_INVALIDA',
    );
  });

  it('una donación de otro refugio es 404', async () => {
    vi.mocked(repo.buscarDonacion).mockResolvedValue({
      id: 30,
      campaniaId: 8,
      estadoDonacion: { nombre: 'Pendiente' },
      campania: { refugioId: OTRO_REFUGIO },
    });

    expect(await codigoDeError(service.resolverDonacion(30, { estado: 'Realizada' }, USUARIO))).toBe(
      'DONACION_NO_ENCONTRADA',
    );
  });
});

describe('listarDonaciones', () => {
  it('las de una campaña de otro refugio son 404', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8, { refugioId: OTRO_REFUGIO }));

    expect(await codigoDeError(service.listarDonaciones(8, { limite: 30 }, USUARIO))).toBe(
      'CAMPANIA_NO_ENCONTRADA',
    );
  });

  it('filtra por estado y pagina', async () => {
    vi.mocked(repo.buscarPorId).mockResolvedValue(campania(8));
    vi.mocked(repo.listarDonaciones).mockResolvedValue([donacion(31), donacion(30)]);

    const lista = await service.listarDonaciones(8, { limite: 1, estado: 'Pendiente' }, USUARIO);

    expect(repo.listarDonaciones).toHaveBeenCalledWith(8, 'Pendiente', 1, undefined);
    expect(lista).toMatchObject({ hayMas: true, proximoCursor: 31 });
    expect(lista.donaciones).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/unit/modules/campanias.service.test.ts`
Expected: FAIL, import no resuelto.

- [ ] **Step 3: Implementar `src/modules/campanias/campanias.service.ts`**

```ts
/**
 * Campañas de donación (spec 026, HU-12.1 a HU-12.7).
 *
 * Dos lados del mostrador:
 * - El REFUGIO (perfil Refugio) crea sus campañas, las finaliza o cancela, y revisa las
 *   donaciones que le avisan: las aplica (suman al progreso) o las rechaza con motivo.
 * - El ADOPTANTE (perfil Personal) recorre las campañas Activa, transfiere por fuera del
 *   sistema y avisa cuánto donó. Esa donación nace Pendiente y NO suma hasta que el refugio la
 *   aplica (regla transversal 11).
 *
 * Las transiciones automáticas (HU-12.4) las comparte con el cron vía `campanias.estados.ts`.
 */
import { AppError } from '../../middlewares/errorHandler';
import { USUARIO_SISTEMA_ID } from '../../shared/auditoria';
import { registrarAuditoria } from '../../shared/logAuditoria';
import { borrarImagen, guardarImagen } from '../../shared/storage';
import { aFechaISO } from '../../shared/validation/dates';
import { LIMITES } from '../../shared/validation/limits';
import type {
  CampaniaDto,
  CampaniaRefugioDto,
  CrearCampaniaDto,
  DonacionDto,
  DonarDto,
  FiltrosDonacionesDto,
  FiltrosMisCampaniasDto,
  ListaCampaniasDto,
  ListaDonacionesDto,
  PaginaCampaniasDto,
  ResolverDonacionDto,
} from './campanias.dto';
import {
  calcularPorcentaje,
  ESTADO_CAMPANIA,
  ESTADO_DONACION,
  siguienteEstadoAutomatico,
  transicionManualPermitida,
  type EstadoManual,
  type MotivoRechazo,
  type NombreEstadoCampania,
  type NombreEstadoDonacion,
} from './campanias.estados';
import * as repo from './campanias.repository';

const SUBCARPETA_IMAGENES = 'campanias';

const SIN_DONACIONES: repo.ResumenDonaciones = { recaudado: 0, donantes: 0, pendientes: 0 };

export type ArchivoImagen = Parameters<typeof guardarImagen>[0];

const VERBO: Record<EstadoManual, string> = { Finalizada: 'finalizar', Cancelada: 'cancelar' };

// ─────────────── CATÁLOGOS ───────────────

type IdsPorNombre<N extends string> = Record<N, number>;

function idsPorNombre<N extends string>(
  filas: { id: number; nombre: string }[],
  nombres: readonly N[],
  catalogo: string,
): IdsPorNombre<N> {
  const ids = {} as IdsPorNombre<N>;

  for (const nombre of nombres) {
    const fila = filas.find((candidata) => candidata.nombre === nombre);
    // Un catálogo incompleto es un seed roto, no un error del usuario.
    if (!fila) throw new Error(`Falta el estado "${nombre}" en el catálogo ${catalogo}`);
    ids[nombre] = fila.id;
  }

  return ids;
}

/** Ids de los estados de campaña por nombre. Lo usa también el cron. */
export async function idsEstadosCampania(): Promise<IdsPorNombre<NombreEstadoCampania>> {
  return idsPorNombre(
    await repo.buscarEstadosCampania(),
    Object.values(ESTADO_CAMPANIA),
    'EstadoCampania',
  );
}

async function idsEstadosDonacion(): Promise<IdsPorNombre<NombreEstadoDonacion>> {
  return idsPorNombre(
    await repo.buscarEstadosDonacion(),
    Object.values(ESTADO_DONACION),
    'EstadoDonacion',
  );
}

// ─────────────── ARMADO DE RESPUESTAS ───────────────

function aDto(campania: repo.CampaniaConRelaciones, resumen: repo.ResumenDonaciones): CampaniaDto {
  const objetivo = Number(campania.objetivo);

  return {
    id: campania.id,
    titulo: campania.titulo,
    descripcion: campania.descripcion,
    imagenUrl: campania.imagenUrl,
    objetivo,
    recaudado: resumen.recaudado,
    porcentaje: calcularPorcentaje(resumen.recaudado, objetivo),
    donantes: resumen.donantes,
    // Sólo el día: con hora, en otra zona horaria podría mostrarse el día anterior.
    fechaInicio: aFechaISO(campania.fechaInicio),
    fechaFin: aFechaISO(campania.fechaFin),
    estado: { id: campania.estadoCampania.id, nombre: campania.estadoCampania.nombre },
    alias: campania.alias,
    cbu: campania.cbu,
    refugio: {
      id: campania.refugio.id,
      nombre: campania.refugio.nombre,
      imagenUrl: campania.refugio.imagenUrl,
    },
  };
}

function aDtoRefugio(
  campania: repo.CampaniaConRelaciones,
  resumen: repo.ResumenDonaciones,
): CampaniaRefugioDto {
  return { ...aDto(campania, resumen), pendientes: resumen.pendientes };
}

function aDtoDonacion(donacion: repo.DonacionConRelaciones): DonacionDto {
  return {
    id: donacion.id,
    monto: Number(donacion.monto),
    estado: { id: donacion.estadoDonacion.id, nombre: donacion.estadoDonacion.nombre },
    motivoRechazo: donacion.motivoRechazo as MotivoRechazo | null,
    fechaAlta: donacion.fechaAlta.toISOString(),
    donante: {
      id: donacion.usuario.id,
      nombre: donacion.usuario.nombre,
      apellido: donacion.usuario.apellido,
      imagenUrl: donacion.usuario.imagenUrl,
    },
  };
}

/** Se piden `limite + 1` filas: la que sobra sólo dice que hay más. */
function paginar<T extends { id: number }>(filas: T[], limite: number) {
  const hayMas = filas.length > limite;
  const pagina = hayMas ? filas.slice(0, limite) : filas;
  return { pagina, hayMas, proximoCursor: hayMas ? pagina[pagina.length - 1]!.id : null };
}

async function resumenDe(campaniaId: number): Promise<repo.ResumenDonaciones> {
  return (await repo.resumirDonaciones([campaniaId])).get(campaniaId) ?? SIN_DONACIONES;
}

// ─────────────── REGLAS COMPARTIDAS ───────────────

/**
 * Refugio del miembro que opera. Con `paraCrear` además exige que esté verificado y activo
 * (precondición de HU-12.1). Las campañas existentes siguen su ciclo aunque el refugio se
 * suspenda (spec 026 §8).
 */
async function refugioDe(usuarioId: number, paraCrear = false): Promise<number> {
  const usuario = await repo.buscarUsuarioConRefugio(usuarioId);

  if (!usuario?.refugio) {
    throw new AppError('SIN_REFUGIO', 'Tu usuario no está asociado a ningún refugio', 403);
  }

  const { refugio } = usuario;
  const habilitado =
    refugio.verificado && refugio.fechaBaja === null && refugio.estado.nombre === 'Activo';

  if (paraCrear && !habilitado) {
    throw new AppError(
      'REFUGIO_NO_HABILITADO',
      'Tu refugio tiene que estar verificado y activo para crear campañas',
      403,
    );
  }

  return refugio.id;
}

/** 404 también si es de otro refugio: no se revela que existe. */
async function campaniaDelRefugio(
  campaniaId: number,
  refugioId: number,
): Promise<repo.CampaniaConRelaciones> {
  const campania = await repo.buscarPorId(campaniaId);

  if (!campania || campania.refugioId !== refugioId) {
    throw new AppError('CAMPANIA_NO_ENCONTRADA', 'No encontramos esa campaña', 404);
  }

  return campania;
}

/**
 * Aplica ya la regla del cron (HU-12.4), para no esperar a la corrida del día siguiente: al
 * crear una campaña que empieza hoy (§6.5) y al aplicar la donación que completa el objetivo
 * (§6.7). Devuelve la campaña actualizada, o `null` si no cambió.
 */
async function aplicarReglaAutomatica(
  campania: repo.CampaniaConRelaciones,
  recaudado: number,
  estados: IdsPorNombre<NombreEstadoCampania>,
): Promise<repo.CampaniaConRelaciones | null> {
  const desde = campania.estadoCampania.nombre as NombreEstadoCampania;
  const hacia = siguienteEstadoAutomatico(
    {
      estado: desde,
      fechaInicio: campania.fechaInicio,
      fechaFin: campania.fechaFin,
      objetivo: Number(campania.objetivo),
      recaudado,
    },
    new Date(),
  );

  if (!hacia) return null;

  const cambio = await repo.cambiarEstadoSi(
    campania.id,
    estados[desde],
    estados[hacia],
    USUARIO_SISTEMA_ID,
  );
  // Si otro la movió en el medio, lo que haya hecho es lo que vale.
  if (!cambio) return null;

  await registrarAuditoria({
    usuarioId: USUARIO_SISTEMA_ID,
    accion: 'CAMBIAR_ESTADO',
    entidad: 'Campania',
    entidadId: campania.id,
    detalle: `${desde} -> ${hacia} (automático)`,
  });

  return repo.buscarPorId(campania.id);
}

// ─────────────── REFUGIO ───────────────

/** HU-12.1: nace Inactiva (y pasa a Activa en el acto si empieza hoy). */
export async function crearCampania(
  datos: CrearCampaniaDto,
  contexto: { usuarioId: number; archivo?: ArchivoImagen },
): Promise<CampaniaRefugioDto> {
  if (!contexto.archivo) {
    throw new AppError('IMAGEN_REQUERIDA', 'Agregá una imagen para la campaña', 400);
  }

  const refugioId = await refugioDe(contexto.usuarioId, true);
  const tope = LIMITES.campania.vigentesPorRefugio;

  // Antes de subir la imagen: no dejar archivos huérfanos por un alta que igual se rechaza.
  if ((await repo.contarVigentes(refugioId)) >= tope) {
    throw new AppError(
      'LIMITE_CAMPANIAS',
      `Alcanzaste el límite de ${tope} campañas activas. Finalizá o cancelá una para crear otra`,
      409,
    );
  }

  const estados = await idsEstadosCampania();
  const imagenUrl = await guardarImagen(contexto.archivo, SUBCARPETA_IMAGENES);

  let creada: repo.CampaniaConRelaciones;
  try {
    creada = await repo.crear(
      {
        titulo: datos.titulo,
        descripcion: datos.descripcion,
        objetivo: datos.objetivo,
        fechaInicio: datos.fechaInicio,
        fechaFin: datos.fechaFin,
        alias: datos.alias,
        cbu: datos.cbu,
        imagenUrl,
        refugioId,
        estadoCampaniaId: estados.Inactiva,
      },
      contexto.usuarioId,
    );
  } catch (err) {
    await borrarImagen(imagenUrl);
    throw err;
  }

  await registrarAuditoria({
    usuarioId: contexto.usuarioId,
    accion: 'CREAR',
    entidad: 'Campania',
    entidadId: creada.id,
    detalle: `objetivo=${datos.objetivo}`,
  });

  const campania = (await aplicarReglaAutomatica(creada, 0, estados)) ?? creada;
  return aDtoRefugio(campania, SIN_DONACIONES);
}

/** HU-12.1: «Mis Campañas», con filtros por fecha de inicio y estados. */
export async function listarCampaniasDelRefugio(
  filtros: FiltrosMisCampaniasDto,
  usuarioId: number,
): Promise<ListaCampaniasDto<CampaniaRefugioDto>> {
  const refugioId = await refugioDe(usuarioId);

  if (filtros.cursor !== undefined && !(await repo.existeCampania(filtros.cursor))) {
    throw new AppError('CURSOR_INVALIDO', 'No pudimos seguir cargando las campañas', 400);
  }

  const filas = await repo.listarDelRefugio(
    refugioId,
    { fechaDesde: filtros.fechaDesde, fechaHasta: filtros.fechaHasta, estados: filtros.estados },
    filtros.limite,
    filtros.cursor,
  );
  const { pagina, hayMas, proximoCursor } = paginar(filas, filtros.limite);
  const resumen = await repo.resumirDonaciones(pagina.map((campania) => campania.id));

  return {
    campanias: pagina.map((campania) =>
      aDtoRefugio(campania, resumen.get(campania.id) ?? SIN_DONACIONES),
    ),
    hayMas,
    proximoCursor,
  };
}

/** HU-12.5 (cancelar) y HU-12.6 (finalizar), con las reglas de HU-12.7. */
export async function cambiarEstadoCampania(
  campaniaId: number,
  hacia: EstadoManual,
  usuarioId: number,
): Promise<CampaniaRefugioDto> {
  const refugioId = await refugioDe(usuarioId);
  const campania = await campaniaDelRefugio(campaniaId, refugioId);
  const desde = campania.estadoCampania.nombre;

  if (!transicionManualPermitida(desde, hacia)) {
    throw new AppError(
      'TRANSICION_INVALIDA',
      `La campaña está «${desde}»: no se puede ${VERBO[hacia]}`,
      409,
    );
  }

  const estados = await idsEstadosCampania();
  const cambio = await repo.cambiarEstadoSi(
    campania.id,
    estados[desde as NombreEstadoCampania],
    estados[hacia],
    usuarioId,
  );

  if (!cambio) {
    throw new AppError(
      'TRANSICION_INVALIDA',
      'La campaña cambió de estado recién. Actualizá la lista e intentalo de nuevo',
      409,
    );
  }

  await registrarAuditoria({
    usuarioId,
    accion: 'CAMBIAR_ESTADO',
    entidad: 'Campania',
    entidadId: campania.id,
    detalle: `${desde} -> ${hacia}`,
  });

  const actualizada = (await repo.buscarPorId(campania.id)) ?? campania;
  return aDtoRefugio(actualizada, await resumenDe(campania.id));
}

/** HU-12.3: bandeja de revisión de una campaña del refugio. */
export async function listarDonaciones(
  campaniaId: number,
  filtros: FiltrosDonacionesDto,
  usuarioId: number,
): Promise<ListaDonacionesDto> {
  const refugioId = await refugioDe(usuarioId);
  await campaniaDelRefugio(campaniaId, refugioId);

  if (filtros.cursor !== undefined && !(await repo.existeDonacion(filtros.cursor))) {
    throw new AppError('CURSOR_INVALIDO', 'No pudimos seguir cargando las donaciones', 400);
  }

  const filas = await repo.listarDonaciones(
    campaniaId,
    filtros.estado,
    filtros.limite,
    filtros.cursor,
  );
  const { pagina, hayMas, proximoCursor } = paginar(filas, filtros.limite);

  return { donaciones: pagina.map(aDtoDonacion), hayMas, proximoCursor };
}

function yaRevisada(): AppError {
  return new AppError('TRANSICION_INVALIDA', 'Esta donación ya fue revisada', 409);
}

/** Si la campaña sigue Activa y la donación la completó, la cierra en el acto (§6.7). */
async function cerrarSiCompleta(campaniaId: number): Promise<void> {
  const campania = await repo.buscarPorId(campaniaId);
  if (!campania || campania.estadoCampania.nombre !== ESTADO_CAMPANIA.ACTIVA) return;

  const { recaudado } = await resumenDe(campaniaId);
  await aplicarReglaAutomatica(campania, recaudado, await idsEstadosCampania());
}

/**
 * HU-12.3: aplicar (Realizada, suma) o rechazar con motivo (Cancelada, no suma). Se puede
 * aunque la campaña ya haya cerrado: la transferencia pudo hacerse antes del cierre.
 */
export async function resolverDonacion(
  donacionId: number,
  datos: ResolverDonacionDto,
  usuarioId: number,
): Promise<DonacionDto> {
  const refugioId = await refugioDe(usuarioId);
  const donacion = await repo.buscarDonacion(donacionId);

  if (!donacion || donacion.campania.refugioId !== refugioId) {
    throw new AppError('DONACION_NO_ENCONTRADA', 'No encontramos esa donación', 404);
  }
  if (donacion.estadoDonacion.nombre !== ESTADO_DONACION.PENDIENTE) throw yaRevisada();

  const estados = await idsEstadosDonacion();
  const motivo = datos.estado === ESTADO_DONACION.CANCELADA ? datos.motivo : null;

  const resuelta = await repo.resolverDonacionSi(
    donacion.id,
    estados.Pendiente,
    estados[datos.estado],
    motivo,
    usuarioId,
  );
  if (!resuelta) throw yaRevisada();

  await registrarAuditoria({
    usuarioId,
    accion: datos.estado === ESTADO_DONACION.REALIZADA ? 'APLICAR' : 'RECHAZAR',
    entidad: 'Donacion',
    entidadId: donacion.id,
    ...(motivo ? { detalle: `motivo=${motivo}` } : {}),
  });

  if (datos.estado === ESTADO_DONACION.REALIZADA) await cerrarSiCompleta(donacion.campaniaId);

  const actualizada = await repo.buscarDonacionCompleta(donacion.id);
  return aDtoDonacion(actualizada!);
}

// ─────────────── ADOPTANTE ───────────────

/** HU-12.2: portal de campañas Activa de todos los refugios. */
export async function listarPortal(
  pagina: PaginaCampaniasDto,
): Promise<ListaCampaniasDto<CampaniaDto>> {
  if (pagina.cursor !== undefined && !(await repo.existeCampania(pagina.cursor))) {
    throw new AppError('CURSOR_INVALIDO', 'No pudimos seguir cargando las campañas', 400);
  }

  const filas = await repo.listarActivas(pagina.limite, pagina.cursor);
  const { pagina: campanias, hayMas, proximoCursor } = paginar(filas, pagina.limite);
  const resumen = await repo.resumirDonaciones(campanias.map((campania) => campania.id));

  return {
    campanias: campanias.map((campania) =>
      aDto(campania, resumen.get(campania.id) ?? SIN_DONACIONES),
    ),
    hayMas,
    proximoCursor,
  };
}

/** HU-12.2: detalle con alias y CBU para transferir. */
export async function obtenerCampania(id: number): Promise<CampaniaDto> {
  const campania = await repo.buscarPorId(id);

  if (!campania) {
    throw new AppError('CAMPANIA_NO_ENCONTRADA', 'No encontramos esa campaña', 404);
  }

  return aDto(campania, await resumenDe(id));
}

/** HU-12.3: «Terminar donación». Nace Pendiente y NO suma al progreso. */
export async function donar(
  campaniaId: number,
  datos: DonarDto,
  usuarioId: number,
): Promise<DonacionDto> {
  const usuario = await repo.buscarUsuarioConRefugio(usuarioId);
  if (!usuario) throw new AppError('NO_ENCONTRADO', 'El usuario no existe', 404);

  const campania = await repo.buscarPorId(campaniaId);
  if (!campania) {
    throw new AppError('CAMPANIA_NO_ENCONTRADA', 'No encontramos esa campaña', 404);
  }

  // Igual que no se adopta una mascota propia (spec 026 §6.6).
  if (usuario.refugioId !== null && usuario.refugioId === campania.refugioId) {
    throw new AppError('DONACION_PROPIA', 'No podés donar a una campaña de tu propio refugio', 403);
  }

  if (campania.estadoCampania.nombre !== ESTADO_CAMPANIA.ACTIVA) {
    throw new AppError('CAMPANIA_NO_ACTIVA', 'Esta campaña no está recibiendo donaciones', 409);
  }

  const estados = await idsEstadosDonacion();
  const donacion = await repo.crearDonacion(
    { campaniaId, monto: datos.monto, estadoDonacionId: estados.Pendiente },
    usuarioId,
  );

  await registrarAuditoria({
    usuarioId,
    accion: 'CREAR',
    entidad: 'Donacion',
    entidadId: donacion.id,
    detalle: `campania=${campaniaId} monto=${datos.monto}`,
  });

  return aDtoDonacion(donacion);
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run tests/unit/modules/campanias.service.test.ts`
Expected: PASS (todos los casos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/campanias/campanias.service.ts tests/unit/modules/campanias.service.test.ts
git commit -m "Servicio de campañas: alta, estados, portal, donar y revisar donaciones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Controller, rutas y catálogo `estados-campania`

**Files:**
- Create: `src/modules/campanias/campanias.controller.ts`
- Create: `src/modules/campanias/campanias.routes.ts`
- Modify: `src/routes/index.ts` (montar los dos routers)
- Modify: `src/modules/catalogos/catalogos.repository.ts`, `catalogos.service.ts`, `catalogos.controller.ts`, `catalogos.routes.ts` (endpoint `GET /estados-campania`)

**Interfaces:**
- Consumes: servicio de Task 5; schemas de Task 4.
- Produces: `campaniasRouter` (montado en `/campanias`), `campaniasRefugioRouter` (montado en `/refugio`), `GET /api/v1/estados-campania` → `{ id, nombre }[]`.

- [ ] **Step 1: Controller**

```ts
import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../middlewares/errorHandler';
import { idSchema } from '../../shared/validation/schemas';
import {
  cambiarEstadoCampaniaSchema,
  crearCampaniaSchema,
  donarSchema,
  filtrosDonacionesSchema,
  filtrosMisCampaniasSchema,
  paginaCampaniasSchema,
  resolverDonacionSchema,
} from './campanias.dto';
import * as service from './campanias.service';

/** Traduce el primer issue de Zod al formato de error de la API. */
function parsearOFallar<T extends z.ZodTypeAny>(schema: T, datos: unknown): z.infer<T> {
  const resultado = schema.safeParse(datos);

  if (!resultado.success) {
    const primero = resultado.error.issues[0];
    throw new AppError('VALIDACION', primero?.message ?? 'Datos inválidos', 400);
  }

  return resultado.data;
}

const idCampania = (req: Request): number => parsearOFallar(idSchema('La campaña'), req.params.id);

// ─────────────── ADOPTANTE ───────────────

/** HU-12.2: 200 con lista vacía si no hay campañas activas, nunca 404. */
export async function listarPortal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listarPortal(parsearOFallar(paginaCampaniasSchema, req.query)));
  } catch (err) {
    next(err);
  }
}

export async function obtener(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.obtenerCampania(idCampania(req)));
  } catch (err) {
    next(err);
  }
}

/** HU-12.3: «Terminar donación». */
export async function donar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const donacion = await service.donar(
      idCampania(req),
      parsearOFallar(donarSchema, req.body),
      req.usuario!.usuarioId,
    );
    res.status(201).json(donacion);
  } catch (err) {
    next(err);
  }
}

// ─────────────── REFUGIO ───────────────

export async function listarDelRefugio(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await service.listarCampaniasDelRefugio(
        parsearOFallar(filtrosMisCampaniasSchema, req.query),
        req.usuario!.usuarioId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

/**
 * HU-12.1. Llega como multipart: multer lo parsea y comprimirImagen procesa la imagen antes
 * de validar el resto acá.
 */
export async function crear(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const campania = await service.crearCampania(parsearOFallar(crearCampaniaSchema, req.body), {
      usuarioId: req.usuario!.usuarioId,
      archivo: req.file,
    });
    res.status(201).json(campania);
  } catch (err) {
    next(err);
  }
}

/** HU-12.5 / HU-12.6. */
export async function cambiarEstado(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { estado } = parsearOFallar(cambiarEstadoCampaniaSchema, req.body);
    res.json(await service.cambiarEstadoCampania(idCampania(req), estado, req.usuario!.usuarioId));
  } catch (err) {
    next(err);
  }
}

export async function listarDonaciones(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await service.listarDonaciones(
        idCampania(req),
        parsearOFallar(filtrosDonacionesSchema, req.query),
        req.usuario!.usuarioId,
      ),
    );
  } catch (err) {
    next(err);
  }
}

/** HU-12.3: aplicar o rechazar. */
export async function resolverDonacion(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await service.resolverDonacion(
        parsearOFallar(idSchema('La donación'), req.params.id),
        parsearOFallar(resolverDonacionSchema, req.body),
        req.usuario!.usuarioId,
      ),
    );
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 2: Rutas — `src/modules/campanias/campanias.routes.ts`**

```ts
import { Router } from 'express';
import { requiereAmbito } from '../../middlewares/ambito';
import { autenticar } from '../../middlewares/auth';
import { comprimirImagen } from '../../middlewares/comprimirImagen';
import { requiereRol } from '../../middlewares/roles';
import { uploadImagen } from '../../middlewares/uploadImagen';
import { ROL_API } from '../../shared/roles';
import * as controller from './campanias.controller';

/**
 * Lado del adoptante (spec 026). Portal y donar exigen el perfil Personal: desde el perfil
 * Refugio no se dona. El detalle lo ve cualquiera (lo abre también el refugio).
 */
export const campaniasRouter = Router();

campaniasRouter.use(autenticar);

// HU-12.2: portal de campañas Activa, paginado por cursor.
campaniasRouter.get('/', requiereAmbito('PERSONAL'), controller.listarPortal);

// HU-12.2: detalle con alias y CBU.
campaniasRouter.get('/:id', controller.obtener);

// HU-12.3: «Terminar donación».
campaniasRouter.post('/:id/donaciones', requiereAmbito('PERSONAL'), controller.donar);

/**
 * Lado del refugio. Se monta en `/refugio`, que comparten otros routers: por eso los
 * middlewares van por ruta y no con `use`.
 */
export const campaniasRefugioRouter = Router();

const soloRefugio = [autenticar, requiereRol(ROL_API.MIEMBRO_REFUGIO), requiereAmbito('REFUGIO')];

// HU-12.1: «Mis Campañas» y alta (imagen jpg/png/webp ≤5 MB en `imagen`).
campaniasRefugioRouter.get('/campanias', ...soloRefugio, controller.listarDelRefugio);
campaniasRefugioRouter.post(
  '/campanias',
  ...soloRefugio,
  uploadImagen('imagen'),
  comprimirImagen,
  controller.crear,
);

// HU-12.5 / HU-12.6: finalizar o cancelar.
campaniasRefugioRouter.patch('/campanias/:id/estado', ...soloRefugio, controller.cambiarEstado);

// HU-12.3: bandeja de revisión y aplicar/rechazar.
campaniasRefugioRouter.get(
  '/campanias/:id/donaciones',
  ...soloRefugio,
  controller.listarDonaciones,
);
campaniasRefugioRouter.patch('/donaciones/:id/estado', ...soloRefugio, controller.resolverDonacion);
```

- [ ] **Step 3: Montar en `src/routes/index.ts`**

Sumar el import `import { campaniasRefugioRouter, campaniasRouter } from '../modules/campanias/campanias.routes';` junto a los demás, y después de la línea de `animalesPerdidosRouter`:

```ts
apiRouter.use('/campanias', campaniasRouter); // spec 026 — HU-12.1 a HU-12.7
apiRouter.use('/refugio', campaniasRefugioRouter); // spec 026
```

- [ ] **Step 4: Catálogo `GET /estados-campania`**

`catalogos.repository.ts`, junto a `listarEstadosAnimalPerdido`:

```ts
export function listarEstadosCampania() {
  return prisma.estadoCampania.findMany({
    where: { fechaBaja: null },
    select: { id: true, nombre: true },
    orderBy: { id: 'asc' },
  });
}
```

`catalogos.service.ts`:

```ts
/** Filtro por estado de «Mis Campañas» (spec 026). */
export function listarEstadosCampania() {
  return repo.listarEstadosCampania();
}
```

`catalogos.controller.ts` (mismo molde que `listarEstadosAnimalPerdido`):

```ts
export async function listarEstadosCampania(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await service.listarEstadosCampania());
  } catch (err) {
    next(err);
  }
}
```

`catalogos.routes.ts`, después de `estados-animal-perdido`:

```ts
catalogosRouter.get('/estados-campania', autenticar, controller.listarEstadosCampania);
```

- [ ] **Step 5: Verificar compilación, lint y prueba manual**

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
npm test
npm run dev
```

Con el server arriba, loguearse con un miembro de refugio del seed (ver `prisma/seed/usuarios.ts`, operador de «patitas») y con un adoptante, y probar con curl o Thunder Client:
- `GET /api/v1/refugio/campanias` (token de refugio) → 200 con las campañas de patitas, «Castraciones de primavera» con `pendientes: 2`.
- `GET /api/v1/campanias` (token de adoptante, `X-Ambito: PERSONAL`) → sólo campañas `Activa`.
- `POST /api/v1/campanias/<id activa>/donaciones` `{ "monto": "1500,50" }` → 201 `Pendiente`.
- `PATCH /api/v1/refugio/donaciones/<id>/estado` `{ "estado": "Cancelada" }` → 400 «Elegí por qué rechazás la donación».
- `GET /api/v1/estados-campania` → los 4 estados.

- [ ] **Step 6: Commit**

```bash
git add src/modules/campanias src/routes/index.ts src/modules/catalogos
git commit -m "Rutas de campañas (portal, donar, gestión del refugio) y catálogo de estados

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Cron de transición de estados (HU-12.4)

**Files:**
- Create: `src/jobs/transicion-estados-campana.job.ts`
- Test: `tests/unit/jobs/transicion-estados-campana.job.test.ts`

**Interfaces:**
- Consumes: `repo.listarVigentesParaCron`, `repo.resumirDonaciones`, `repo.cambiarEstadoSi`, `repo.buscarEstadosCampania` (vía `service.idsEstadosCampania`), `siguienteEstadoAutomatico`.
- Produces: `transicionarEstadosCampanias(ahora?: Date): Promise<{ activadas: number; finalizadas: number }>`.

- [ ] **Step 1: Test que falla**

```ts
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transicionarEstadosCampanias } from '../../../src/jobs/transicion-estados-campana.job';
import * as repo from '../../../src/modules/campanias/campanias.repository';
import { USUARIO_SISTEMA_ID } from '../../../src/shared/auditoria';
import { registrarAuditoria } from '../../../src/shared/logAuditoria';

vi.mock('../../../src/modules/campanias/campanias.repository');
vi.mock('../../../src/shared/logAuditoria');
// El job importa `idsEstadosCampania` del servicio, que importa storage: sin mock, cargaría
// la configuración de R2/disco en el test.
vi.mock('../../../src/shared/storage');

const AHORA = new Date(2026, 8, 30, 3, 0, 0);
const ESTADOS = [
  { id: 1, nombre: 'Inactiva' },
  { id: 2, nombre: 'Activa' },
  { id: 3, nombre: 'Finalizada' },
  { id: 4, nombre: 'Cancelada' },
];

function dia(offset: number): Date {
  return new Date(2026, 8, 30 + offset);
}

function fila(id: number, estado: string, fechaInicio: Date, fechaFin: Date, objetivo = 100000) {
  return {
    id,
    objetivo: new Prisma.Decimal(objetivo),
    fechaInicio,
    fechaFin,
    estadoCampania: { nombre: estado },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repo.buscarEstadosCampania).mockResolvedValue(ESTADOS);
  vi.mocked(repo.cambiarEstadoSi).mockResolvedValue(true);
  vi.mocked(repo.resumirDonaciones).mockImplementation(
    async (ids) => new Map(ids.map((id) => [id, { recaudado: 0, donantes: 0, pendientes: 0 }])),
  );
});

it('tira si falta un estado en el catálogo', async () => {
  vi.mocked(repo.buscarEstadosCampania).mockResolvedValue(ESTADOS.slice(0, 3));
  vi.mocked(repo.listarVigentesParaCron).mockResolvedValue([]);

  await expect(transicionarEstadosCampanias(AHORA)).rejects.toThrow(
    'Falta el estado "Cancelada" en el catálogo EstadoCampania',
  );
});

describe('transiciones', () => {
  it('activa las que empiezan hoy y finaliza las vencidas, como SISTEMA', async () => {
    vi.mocked(repo.listarVigentesParaCron).mockResolvedValue([
      fila(1, 'Inactiva', dia(0), dia(30)),
      fila(2, 'Activa', dia(-30), dia(-1)),
      fila(3, 'Inactiva', dia(1), dia(30)),
    ]);

    const resultado = await transicionarEstadosCampanias(AHORA);

    expect(resultado).toEqual({ activadas: 1, finalizadas: 1 });
    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(1, 1, 2, USUARIO_SISTEMA_ID);
    expect(repo.cambiarEstadoSi).toHaveBeenCalledWith(2, 2, 3, USUARIO_SISTEMA_ID);
    expect(repo.cambiarEstadoSi).toHaveBeenCalledTimes(2);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ usuarioId: USUARIO_SISTEMA_ID, entidad: 'Campania', entidadId: 2 }),
    );
  });

  it('finaliza la que alcanzó el objetivo', async () => {
    vi.mocked(repo.listarVigentesParaCron).mockResolvedValue([fila(5, 'Activa', dia(-3), dia(30))]);
    vi.mocked(repo.resumirDonaciones).mockResolvedValue(
      new Map([[5, { recaudado: 100000, donantes: 4, pendientes: 0 }]]),
    );

    expect(await transicionarEstadosCampanias(AHORA)).toEqual({ activadas: 0, finalizadas: 1 });
  });

  it('carrera con el refugio: si ya cambió, la saltea sin error ni auditoría', async () => {
    vi.mocked(repo.listarVigentesParaCron).mockResolvedValue([fila(2, 'Activa', dia(-30), dia(-1))]);
    vi.mocked(repo.cambiarEstadoSi).mockResolvedValue(false);

    expect(await transicionarEstadosCampanias(AHORA)).toEqual({ activadas: 0, finalizadas: 0 });
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/unit/jobs/transicion-estados-campana.job.test.ts`
Expected: FAIL, import no resuelto.

- [ ] **Step 3: Implementar `src/jobs/transicion-estados-campana.job.ts`**

```ts
/**
 * HU-12.4: mueve las campañas entre estados por fecha y por monto (usuario SISTEMA):
 * Inactiva → Activa al llegar `fecha_inicio`; Activa → Finalizada al pasar `fecha_fin` o al
 * alcanzar el objetivo con donaciones Realizada.
 *
 * Función pura + entrypoint CLI, testeable sin levantar el servidor HTTP, igual que
 * `cancelar-solicitudes-vencidas.job.ts`. Se invoca desde un cron del sistema.
 *
 * Ejemplo de crontab (una vez por día a las 0:05, apenas cambia la fecha):
 *   5 0 * * * cd /ruta/al/repo && node dist/jobs/transicion-estados-campana.job.js
 */
import {
  ESTADO_CAMPANIA,
  siguienteEstadoAutomatico,
  type NombreEstadoCampania,
} from '../modules/campanias/campanias.estados';
import * as repo from '../modules/campanias/campanias.repository';
import { idsEstadosCampania } from '../modules/campanias/campanias.service';
import { USUARIO_SISTEMA_ID } from '../shared/auditoria';
import { registrarAuditoria } from '../shared/logAuditoria';

/** `ahora` es inyectable para testear los bordes del día sin depender del reloj real. */
export async function transicionarEstadosCampanias(
  ahora = new Date(),
): Promise<{ activadas: number; finalizadas: number }> {
  const estados = await idsEstadosCampania();
  const campanias = await repo.listarVigentesParaCron();
  const resumen = await repo.resumirDonaciones(campanias.map((campania) => campania.id));

  let activadas = 0;
  let finalizadas = 0;

  for (const campania of campanias) {
    const desde = campania.estadoCampania.nombre as NombreEstadoCampania;
    const recaudado = resumen.get(campania.id)?.recaudado ?? 0;
    const hacia = siguienteEstadoAutomatico(
      {
        estado: desde,
        fechaInicio: campania.fechaInicio,
        fechaFin: campania.fechaFin,
        objetivo: Number(campania.objetivo),
        recaudado,
      },
      ahora,
    );
    if (!hacia) continue;

    const cambio = await repo.cambiarEstadoSi(
      campania.id,
      estados[desde],
      estados[hacia],
      USUARIO_SISTEMA_ID,
    );
    // Si un miembro la finalizó o canceló un instante antes, lo suyo es lo que vale: es la
    // carrera esperada, no un error.
    if (!cambio) continue;

    if (hacia === ESTADO_CAMPANIA.ACTIVA) activadas++;
    else finalizadas++;

    await registrarAuditoria({
      usuarioId: USUARIO_SISTEMA_ID,
      accion: 'CAMBIAR_ESTADO',
      entidad: 'Campania',
      entidadId: campania.id,
      detalle: `${desde} -> ${hacia} (cron, recaudado=${recaudado})`,
    });
  }

  return { activadas, finalizadas };
}

if (require.main === module) {
  transicionarEstadosCampanias()
    .then(({ activadas, finalizadas }) => {
      console.log(
        `✅ transicion-estados-campana: ${activadas} activada(s), ${finalizadas} finalizada(s).`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Error en transicion-estados-campana:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Correr y verificar que pasa, y probarlo contra la base local**

```bash
npx vitest run tests/unit/jobs/transicion-estados-campana.job.test.ts
npx tsx src/jobs/transicion-estados-campana.job.ts
```

Expected: tests PASS; la corrida manual imprime `✅ transicion-estados-campana: …` sin error.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/transicion-estados-campana.job.ts tests/unit/jobs/transicion-estados-campana.job.test.ts
git commit -m "Cron de transición de estados de campaña (HU-12.4)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Dashboards cuentan sólo donaciones Realizada

**Files:**
- Modify: `src/modules/dashboard-admin/dashboard-admin.repository.ts:61-69`
- Modify: `src/modules/dashboard-refugio/dashboard-refugio.repository.ts` (`listarDonaciones`, `paginaDonacionesParaExport`)
- Modify: `src/modules/dashboard-refugio/dashboard-refugio.service.ts` (`HEADERS_EXPORT.donaciones`, `filasDonaciones`)
- Modify: `tests/unit/modules/dashboard-refugio/dashboard-refugio.service.test.ts` (fixture de export)
- Modify: `docs/specs/009-dashboards-reportes-admin.md`, `docs/specs/010-dashboard-refugio.md` (nota de decisión)

**Interfaces:**
- Consumes: `ESTADO_DONACION` de Task 3.
- Produces: el CSV de donaciones del refugio suma la columna `estado` (siempre `Realizada`).

- [ ] **Step 1: Test que falla — export con columna `estado`**

En `tests/unit/modules/dashboard-refugio/dashboard-refugio.service.test.ts`, en el test del export de donaciones (el que usa `paginaDonacionesParaExport.mockResolvedValueOnce([...])`, ~línea 288): sumar `estadoDonacion: { nombre: 'Realizada' }` a cada fila del fixture y actualizar lo esperado para que el header sea `id,donante,campania,monto,estado,fechaAlta` y cada fila traiga `Realizada` antes de la fecha.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run tests/unit/modules/dashboard-refugio`
Expected: FAIL en el test del export (falta la columna).

- [ ] **Step 3: Implementar**

`dashboard-admin.repository.ts` — importar `ESTADO_DONACION` de `../campanias/campanias.estados` y reemplazar `sumarMontoDonadoDeclarado`:

```ts
/**
 * Sólo donaciones Realizada: las que el refugio confirmó (spec 026, regla transversal 11). El
 * nombre y el campo `montoDonadoDeclarado` de la API se conservan para no romper web-admin.
 */
export async function sumarMontoDonadoDeclarado(): Promise<number> {
  const resultado = await prisma.donacion.aggregate({
    where: { fechaBaja: null, estadoDonacion: { nombre: ESTADO_DONACION.REALIZADA } },
    _sum: { monto: true },
  });

  return resultado._sum.monto ? Number(resultado._sum.monto) : 0;
}
```

`dashboard-refugio.repository.ts` — importar `ESTADO_DONACION` y en el `where` de `listarDonaciones` y de `paginaDonacionesParaExport` sumar:

```ts
      estadoDonacion: { nombre: ESTADO_DONACION.REALIZADA },
```

y en `paginaDonacionesParaExport` cambiar el include a:

```ts
    include: { campania: true, usuario: true, estadoDonacion: true },
```

`dashboard-refugio.service.ts`:

```ts
  donaciones: ['id', 'donante', 'campania', 'monto', 'estado', 'fechaAlta'],
```

y en `filasDonaciones`, el `yield`:

```ts
      yield [
        d.id,
        `${d.usuario.nombre} ${d.usuario.apellido}`,
        d.campania.titulo,
        d.monto.toString(),
        d.estadoDonacion.nombre,
        d.fechaAlta,
      ];
```

- [ ] **Step 4: Correr todo**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Notas en las specs 009 y 010**

- `009` §3: reemplazar el «Gap detectado» por «**Resuelto por la spec 026 (2026-09-30):** `Donacion` tiene estado. `montoDonadoDeclarado` suma sólo las «Realizada»; se conserva el nombre del campo para no romper web-admin.» y en §6 punto 3 cambiar «declarado» por «confirmado (Realizada)».
- `010` §9 (Notas): «2026-09-30 (spec 026): `donaciones` y `donacionesPorMes` cuentan sólo donaciones «Realizada»; el CSV de donaciones suma la columna `estado`.»

- [ ] **Step 6: Commit**

```bash
git add src/modules/dashboard-admin src/modules/dashboard-refugio tests/unit/modules/dashboard-refugio docs/specs/009-dashboards-reportes-admin.md docs/specs/010-dashboard-refugio.md
git commit -m "Dashboards: sólo suman donaciones confirmadas (spec 026)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Documentación del backend

**Files:**
- Create: `docs/api-campanias.md`
- Modify: `docs/specs/026-campanias.md` (§4 queda con la tabla y el link; estado IMPLEMENTADA sólo cuando el front también esté)
- Modify: `docs/REQUISITOS.md` §10 punto 3 (resuelta)
- Modify: `docs/DEUDA_TECNICA.md` (resolver el conflicto de merge + deuda nueva)
- Modify: `AGENTS.md` (listado de `jobs/` ya menciona `transicion-estados-campana.job.ts`: verificar que coincide el nombre)

- [ ] **Step 1: `docs/api-campanias.md`**

Con la misma estructura que `docs/api-mascotas-perdidas.md` (leerlo primero): una sección por endpoint de la tabla de la spec §4 con headers (`Authorization`, `X-Ambito`), query/body, respuesta 2xx con un ejemplo JSON real (copiar la forma de la spec §4), y la tabla de errores con `codigo`, HTTP y mensaje literal tal como los lanza el servicio (`IMAGEN_REQUERIDA`, `REFUGIO_NO_HABILITADO`, `LIMITE_CAMPANIAS`, `CAMPANIA_NO_ENCONTRADA`, `CAMPANIA_NO_ACTIVA`, `DONACION_PROPIA`, `TRANSICION_INVALIDA`, `DONACION_NO_ENCONTRADA`, `CURSOR_INVALIDO`, `VALIDACION`, `SIN_REFUGIO`, `AMBITO_NO_PERMITIDO`). Sección final «Pendientes»: edición de campañas, «Mis donaciones» del adoptante, spec 027 (Mercado Pago), GUI-36 web-admin.

- [ ] **Step 2: Spec 026 §4**

Borrar los subtítulos «Forma de una campaña», «Bodies» y «Errores» de la spec y dejar la tabla + «**Contrato completo:** [`docs/api-campanias.md`](../api-campanias.md)», como la spec 020.

- [ ] **Step 3: `REQUISITOS.md` §10 punto 3**

Reemplazar por: «3. **Resuelto (2026-09-30, spec 026):** HU-12.7 es la gestión de estados de **campaña** (Inactiva, Activa, Finalizada, Cancelada); la referencia a `Estado_Mascota` de la matriz era un error del documento fuente.» y en §9 (matriz), módulo 12: `Campaña`, `Estado_Campaña`, `Donacion`, `Estado_Donacion`.

- [ ] **Step 4: `DEUDA_TECNICA.md`**

1. Resolver el conflicto de merge commiteado en `dev` (líneas `<<<<<<< HEAD` … `>>>>>>> origin/dev` del índice): conservar las tres filas y renumerar la de «Inicio muestra Campañas…» como **23** (los números no se reciclan; la 21 y la 22 de `HEAD` ya existían). Buscar en el cuerpo del archivo la sección `## 21. Inicio muestra Campañas…` y renombrarla `## 23.`. Antes de tocar, `git log -p -S'<<<<<<<' -- docs/DEUDA_TECNICA.md` para confirmar de qué merge viene y no pisar contenido.
2. Agregar la deuda nueva al índice y al cuerpo:
   - **24 · Sin tope de donaciones pendientes por adoptante** — Baja — backend. Un adoptante puede declarar donaciones falsas sin límite; el refugio las rechaza a mano. Si molesta, un tope como el de solicitudes (regla 7).
   - **25 · La quota de campañas no es atómica** — Baja — backend. Dos altas simultáneas del mismo refugio pueden pasar el conteo y dejar 6 vigentes; mismo criterio que las demás quotas.

- [ ] **Step 5: Verificar formato y commit**

```bash
npm run format:check
git add docs AGENTS.md
git commit -m "Docs de campañas: contrato de API, ambigüedad de HU-12.7 resuelta y deuda

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Parte B — App mobile (`PetHood_Front/apps/mobile`)

> No hay runner de tests para componentes (deuda 5). Lo puro (`lib/`, `shared/validation/`) se testea con `node --test --experimental-strip-types`; el resto se verifica con `npx tsc --noEmit` y a mano en la app (`npx expo start`) contra el backend de la Parte A con el seed cargado.

### Task 10: Rama, validación espejo y helpers puros

**Files:**
- Modify: `shared/validation/limits.ts`, `shared/validation/numbers.ts`, `shared/validation/dates.ts`
- Create: `shared/validation/bancario.ts`
- Create: `lib/campanias.ts`, `lib/campanias.test.ts`

**Interfaces:**
- Produces: `LIMITES.campania`, `LIMITES.donacion` (espejo exacto de Task 1); `validarFechaNoPasada(valor, etiqueta): string | null`; `validarAlias(valor: string): string | null`; `validarCbu(valor: string): string | null`; en `lib/campanias.ts`: `formatearPesos(monto: number): string`, `textoDonantes(cantidad: number): string`, `textoPendientes(cantidad: number): string | null`, `type AccionCampania = 'finalizar' | 'cancelar'`, `accionesDisponibles(estado: string): AccionCampania[]`, `ETIQUETA_MOTIVO: Record<'NO_RECIBIDA' | 'MONTO_NO_COINCIDE', string>`.

- [ ] **Step 1: Rama**

```bash
cd PetHood_Front
git checkout dev && git pull && git checkout -b feature/mod12-campanias
```

- [ ] **Step 2: Test que falla — `lib/campanias.test.ts`**

```ts
/**
 * Tests de los textos y cuentas de campañas.
 *
 *     cd apps/mobile && node --test --experimental-strip-types lib/campanias.test.ts
 */
/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  accionesDisponibles,
  formatearPesos,
  textoDonantes,
  textoPendientes,
} from './campanias.ts';

describe('formatearPesos', () => {
  it('separa miles con punto y omite centavos en cero', () => {
    assert.equal(formatearPesos(1430000), '$1.430.000');
    assert.equal(formatearPesos(500), '$500');
  });

  it('muestra centavos con coma cuando los hay', () => {
    assert.equal(formatearPesos(5000.5), '$5.000,50');
  });
});

describe('textoDonantes', () => {
  it('singular y plural', () => {
    assert.equal(textoDonantes(1), '1 donante');
    assert.equal(textoDonantes(23), '23 donantes');
  });
});

describe('textoPendientes', () => {
  it('nada si no hay pendientes', () => {
    assert.equal(textoPendientes(0), null);
  });

  it('singular y plural en voseo', () => {
    assert.equal(textoPendientes(1), 'Tenés 1 donación para revisar');
    assert.equal(textoPendientes(3), 'Tenés 3 donaciones para revisar');
  });
});

describe('accionesDisponibles', () => {
  it('sigue la máquina de estados de la spec 026', () => {
    assert.deepEqual(accionesDisponibles('Activa'), ['finalizar', 'cancelar']);
    assert.deepEqual(accionesDisponibles('Inactiva'), ['cancelar']);
    assert.deepEqual(accionesDisponibles('Finalizada'), []);
    assert.deepEqual(accionesDisponibles('Cancelada'), []);
  });
});
```

Run: `cd apps/mobile && node --test --experimental-strip-types lib/campanias.test.ts`
Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar `lib/campanias.ts`**

```ts
/**
 * Textos y reglas de presentación de las campañas (spec 026 del backend). Puro, sin React:
 * se testea con `node --test`.
 */

/** «$1.430.000» como en el diseño; con centavos sólo si los hay («$5.000,50»). */
export function formatearPesos(monto: number): string {
  const [entero, centavos] = Math.abs(monto).toFixed(2).split('.');
  const conPuntos = entero!.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const signo = monto < 0 ? '-' : '';

  return centavos === '00' ? `${signo}$${conPuntos}` : `${signo}$${conPuntos},${centavos}`;
}

export function textoDonantes(cantidad: number): string {
  return `${cantidad} ${cantidad === 1 ? 'donante' : 'donantes'}`;
}

/** El aviso de la tarjeta del refugio. Sin pendientes no se muestra nada. */
export function textoPendientes(cantidad: number): string | null {
  if (cantidad === 0) return null;
  return `Tenés ${cantidad} ${cantidad === 1 ? 'donación' : 'donaciones'} para revisar`;
}

export type AccionCampania = 'finalizar' | 'cancelar';

/**
 * Qué puede hacer el refugio con la campaña según su estado. Espejo de la máquina de estados
 * del backend (spec 026 §6.4): el backend igual valida, esto sólo decide qué botones mostrar.
 */
export function accionesDisponibles(estado: string): AccionCampania[] {
  if (estado === 'Activa') return ['finalizar', 'cancelar'];
  if (estado === 'Inactiva') return ['cancelar'];
  return [];
}

/** Motivos de rechazo de una donación, como los ve el refugio. */
export const ETIQUETA_MOTIVO = {
  NO_RECIBIDA: 'No se recibió la transferencia',
  MONTO_NO_COINCIDE: 'El monto no coincide',
} as const;

export type MotivoRechazo = keyof typeof ETIQUETA_MOTIVO;
```

- [ ] **Step 4: Espejos de validación**

`shared/validation/limits.ts` — agregar al final del objeto (mismos números que el backend):

```ts
  /** Campaña de donación (spec 026, HU-12.1). Espejo del backend. */
  campania: {
    titulo: { min: 3, max: 50 },
    descripcion: { max: 300 },
    /** «Solo números», sin decimales. */
    objetivo: { min: 10000, max: 2500000, decimales: 0 },
    alias: { min: 6, max: 20 },
    cbu: { largo: 22 },
    vigentesPorRefugio: 5,
    pagina: { porDefecto: 20, maximo: 50 },
  },

  /** Donación declarada (spec 026, HU-12.3). Espejo del backend. */
  donacion: {
    monto: { min: 1, max: 2500000, decimales: 2 },
    pagina: { porDefecto: 30, maximo: 50 },
  },
```

`shared/validation/numbers.ts` — mismo arreglo que el backend: reemplazar `patronDecimal` por

```ts
function patronDecimal(enteros: number, decimales: number): RegExp {
  // Sin decimales no hay parte decimal: `\d{1,0}` ni siquiera es una regex válida.
  const parteDecimal = decimales > 0 ? `([.,]\\d{1,${decimales}})?` : '';
  return new RegExp(`^\\d{1,${enteros}}${parteDecimal}$`);
}
```

y en `validarDecimal` el bloque de formato por

```ts
  if (!patronDecimal(enteros, decimales).test(texto)) {
    if (decimales === 0) return `${etiqueta} debe ser un número entero, sin puntos ni comas`;
    const ejemplo = ' (ej. 12,5)';
    return `${etiqueta} debe ser un número con hasta ${decimales} decimal${decimales === 1 ? '' : 'es'}${ejemplo}`;
  }
```

y en `filtrarEntradaDecimal`, al principio:

```ts
  if (decimales === 0) return texto.replace(/\D/g, '');
```

`shared/validation/dates.ts` — al final:

```ts
/** Fecha de algo planificado (inicio de una campaña): obligatoria y de hoy en adelante. */
export function validarFechaNoPasada(
  valor: string | Date | null | undefined,
  etiqueta: string,
): string | null {
  const fecha = parsearFecha(valor);

  if (!fecha) return `${etiqueta} es obligatoria`;
  if (esPasada(fecha)) return `${etiqueta} no puede ser anterior a hoy`;

  return null;
}
```

Crear `shared/validation/bancario.ts`:

```ts
/**
 * Alias y CBU/CVU para transferir (spec 026). Espejo de
 * `pethood-backend/src/shared/validation/bancario.ts`. Devuelven el error o `null`; vacío es
 * válido porque cada uno es opcional por separado (la pantalla exige al menos uno).
 */
import { LIMITES } from './limits';

export function validarAlias(valor: string): string | null {
  const alias = valor.trim();
  const { min, max } = LIMITES.campania.alias;

  if (alias === '') return null;
  if (alias.length < min || alias.length > max) {
    return `El alias debe tener entre ${min} y ${max} caracteres`;
  }
  if (!/^[A-Za-z0-9.-]+$/.test(alias)) {
    return 'El alias sólo puede tener letras, números, puntos y guiones';
  }

  return null;
}

export function validarCbu(valor: string): string | null {
  const cbu = valor.replace(/\s+/g, '');
  const { largo } = LIMITES.campania.cbu;

  if (cbu === '') return null;
  if (cbu.length !== largo || !/^\d+$/.test(cbu)) return `El CBU o CVU debe tener ${largo} números`;

  return null;
}
```

- [ ] **Step 5: Correr tests y typecheck**

```bash
node --test --experimental-strip-types lib/campanias.test.ts lib/paginacion.test.ts
npx tsc --noEmit
```

Expected: PASS y sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/campanias.ts apps/mobile/lib/campanias.test.ts apps/mobile/shared/validation
git commit -m "Campañas mobile: validaciones espejo y helpers de presentación (spec 026)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Servicio de API, catálogo y aviso de alta

**Files:**
- Create: `services/campanias.ts`
- Modify: `services/catalogos.ts` (agregar `listarEstadosCampania`)
- Create: `lib/campaniaRecienCreada.ts`

**Interfaces:**
- Consumes: `get`, `post`, `patch`, `postFormData`, `adjuntarArchivo` de `services/api.ts`; `LIMITES`; `aFechaISO`.
- Produces: tipos `Campania`, `CampaniaRefugio`, `PaginaCampanias<T>`, `Donacion`, `PaginaDonaciones`, `FiltrosMisCampanias`, `SIN_FILTROS_CAMPANIAS`, `EstadoDonacionFiltro = 'Pendiente' | 'Realizada' | 'Cancelada'`, `DatosNuevaCampania`; funciones `listarCampanias(cursor)`, `obtenerCampania(id)`, `donar(campaniaId, monto)`, `listarMisCampanias(filtros, cursor)`, `crearCampania(datos)`, `cambiarEstadoCampania(id, estado)`, `listarDonaciones(campaniaId, estado, cursor)`, `resolverDonacion(id, resolucion)`; `listarEstadosCampania()`; `avisarCampaniaCreada`, `tomarCampaniaCreada`.

- [ ] **Step 1: `services/campanias.ts`**

```ts
/**
 * Campañas de donación (spec 026 del backend, HU-12.1 a HU-12.7). Contrato completo en
 * `pethood-backend/docs/api-campanias.md`.
 *
 * El perfil activo viaja solo en la cabecera `X-Ambito` (`api.ts`): el portal y donar son del
 * perfil personal, lo de `/refugio/...` del perfil de refugio.
 */
import type { MotivoRechazo } from '@/lib/campanias';
import { aFechaISO } from '@/shared/validation/dates';
import { LIMITES } from '@/shared/validation/limits';

import { adjuntarArchivo, get, patch, post, postFormData } from './api';

export interface Campania {
  id: number;
  titulo: string;
  descripcion: string;
  /** Ruta relativa o URL absoluta: siempre pasa por `urlAbsoluta`. */
  imagenUrl: string | null;
  objetivo: number;
  /** Sólo lo que el refugio confirmó. */
  recaudado: number;
  /** 0 a 100, para la barra. */
  porcentaje: number;
  donantes: number;
  /** `AAAA-MM-DD`. */
  fechaInicio: string;
  fechaFin: string;
  estado: { id: number; nombre: string };
  alias: string | null;
  cbu: string | null;
  refugio: { id: number; nombre: string; imagenUrl: string | null };
}

export interface CampaniaRefugio extends Campania {
  /** Donaciones esperando revisión. */
  pendientes: number;
}

export interface PaginaCampanias<T extends Campania> {
  campanias: T[];
  hayMas: boolean;
  proximoCursor: number | null;
}

export type EstadoDonacionFiltro = 'Pendiente' | 'Realizada' | 'Cancelada';

export interface Donacion {
  id: number;
  monto: number;
  estado: { id: number; nombre: string };
  motivoRechazo: MotivoRechazo | null;
  /** ISO 8601. */
  fechaAlta: string;
  donante: { id: number; nombre: string; apellido: string; imagenUrl: string | null };
}

export interface PaginaDonaciones {
  donaciones: Donacion[];
  hayMas: boolean;
  proximoCursor: number | null;
}

/** Filtros de «Mis Campañas». La fecha es sobre el INICIO de la campaña; «hasta» sólo con «desde». */
export interface FiltrosMisCampanias {
  estados: number[];
  fechaDesde?: Date;
  fechaHasta?: Date;
}

export const SIN_FILTROS_CAMPANIAS: FiltrosMisCampanias = { estados: [] };

function queryPagina(limite: number, cursor: number | null): URLSearchParams {
  const params = new URLSearchParams({ limite: String(limite) });
  if (cursor !== null) params.set('cursor', String(cursor));
  return params;
}

/** GUI-13. Portal de campañas activas. */
export function listarCampanias(cursor: number | null): Promise<PaginaCampanias<Campania>> {
  return get(`/campanias?${queryPagina(LIMITES.campania.pagina.porDefecto, cursor).toString()}`);
}

export function obtenerCampania(id: number): Promise<Campania> {
  return get(`/campanias/${id}`);
}

/**
 * «Terminar donación». `monto` va tal cual lo escribió el usuario (coma o punto): el backend
 * lo normaliza. La donación queda Pendiente hasta que el refugio la confirma.
 */
export function donar(campaniaId: number, monto: string): Promise<Donacion> {
  return post(`/campanias/${campaniaId}/donaciones`, { monto: monto.trim() });
}

/** GUI-36. «Mis Campañas» del refugio, con los mismos filtros en cada página. */
export function listarMisCampanias(
  filtros: FiltrosMisCampanias,
  cursor: number | null,
): Promise<PaginaCampanias<CampaniaRefugio>> {
  const params = queryPagina(LIMITES.campania.pagina.porDefecto, cursor);

  if (filtros.estados.length > 0) params.set('estados', filtros.estados.join(','));
  if (filtros.fechaDesde) params.set('fechaDesde', aFechaISO(filtros.fechaDesde));
  if (filtros.fechaDesde && filtros.fechaHasta) {
    params.set('fechaHasta', aFechaISO(filtros.fechaHasta));
  }

  return get(`/refugio/campanias?${params.toString()}`);
}

export interface DatosNuevaCampania {
  titulo: string;
  descripcion: string;
  /** Tal cual se escribió: sólo dígitos. */
  objetivo: string;
  fechaInicio: Date;
  fechaFin: Date;
  alias: string;
  cbu: string;
  imagen: { uri: string; nombre: string; tipo: string };
}

/** GUI-37. Alta (multipart, la imagen en `imagen`). */
export async function crearCampania(datos: DatosNuevaCampania): Promise<CampaniaRefugio> {
  const formData = new FormData();

  formData.append('titulo', datos.titulo);
  formData.append('descripcion', datos.descripcion);
  formData.append('objetivo', datos.objetivo);
  formData.append('fechaInicio', aFechaISO(datos.fechaInicio));
  formData.append('fechaFin', aFechaISO(datos.fechaFin));
  formData.append('alias', datos.alias);
  formData.append('cbu', datos.cbu);
  await adjuntarArchivo(formData, 'imagen', datos.imagen);

  return postFormData('/refugio/campanias', formData);
}

/** HU-12.6 (finalizar) y HU-12.5 (cancelar). */
export function cambiarEstadoCampania(
  id: number,
  estado: 'Finalizada' | 'Cancelada',
): Promise<CampaniaRefugio> {
  return patch(`/refugio/campanias/${id}/estado`, { estado });
}

/** Bandeja de revisión. `estado` en `null` trae todas. */
export function listarDonaciones(
  campaniaId: number,
  estado: EstadoDonacionFiltro | null,
  cursor: number | null,
): Promise<PaginaDonaciones> {
  const params = queryPagina(LIMITES.donacion.pagina.porDefecto, cursor);
  if (estado) params.set('estado', estado);

  return get(`/refugio/campanias/${campaniaId}/donaciones?${params.toString()}`);
}

export type ResolucionDonacion =
  { estado: 'Realizada' } | { estado: 'Cancelada'; motivo: MotivoRechazo };

/** HU-12.3: aplicar (suma al progreso) o rechazar con motivo. */
export function resolverDonacion(id: number, resolucion: ResolucionDonacion): Promise<Donacion> {
  return patch(`/refugio/donaciones/${id}/estado`, resolucion);
}
```

Verificar la firma real de `adjuntarArchivo` en `services/api.ts:85` (en `animalesPerdidos.ts` se usa `adjuntarArchivo(formData, 'fotos', foto)` con `{ uri, nombre, tipo }`); si difiere, adaptar la llamada.

- [ ] **Step 2: Catálogo**

En `services/catalogos.ts`, junto a `listarEstadosPublicacion`:

```ts
/** Filtro por estado de «Mis Campañas» (spec 026). */
export function listarEstadosCampania(): Promise<OpcionCatalogo[]> {
  return get('/estados-campania');
}
```

- [ ] **Step 3: `lib/campaniaRecienCreada.ts`**

```ts
/**
 * Aviso de una sola vez entre el alta de una campaña (GUI-37) y «Mis Campañas» (GUI-36), que
 * la abrió. Mismo patrón que `avisoRecienCreado.ts`: el alta vuelve con `router.back()` y el
 * listado la toma al recuperar el foco para ponerla arriba sin recargar.
 */
import type { CampaniaRefugio } from '../services/campanias';

let pendiente: CampaniaRefugio | null = null;

export function avisarCampaniaCreada(campania: CampaniaRefugio): void {
  pendiente = campania;
}

export function tomarCampaniaCreada(): CampaniaRefugio | null {
  const campania = pendiente;
  pendiente = null;
  return campania;
}
```

- [ ] **Step 4: Typecheck y commit**

```bash
npx tsc --noEmit
git add apps/mobile/services/campanias.ts apps/mobile/services/catalogos.ts apps/mobile/lib/campaniaRecienCreada.ts
git commit -m "Campañas mobile: cliente de la API (spec 026)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Componentes — barra, badge y tarjetas

**Files:**
- Create: `constants/EstadosCampania.ts`
- Create: `components/ui/EstadoCampaniaBadge.tsx`
- Create: `components/campanias/BarraProgreso.tsx`
- Create: `components/campanias/TarjetaCampania.tsx` (adoptante, pantalla 13)
- Create: `components/campanias/TarjetaCampaniaRefugio.tsx` (refugio, pantalla 21)

**Interfaces:**
- Consumes: `Campania`, `CampaniaRefugio` (Task 11); `formatearPesos`, `textoDonantes`, `textoPendientes`, `accionesDisponibles`, `AccionCampania` (Task 10); `urlAbsoluta`; `PALETA`; `EstiloEstado` de `constants/EstadosMascota`.
- Produces: `<EstadoCampaniaBadge estado />`, `<BarraProgreso porcentaje clara? />`, `<TarjetaCampania campania onDonar />`, `<TarjetaCampaniaRefugio campania onAccion(accion) onRevisar />`.

- [ ] **Step 1: `constants/EstadosCampania.ts`**

```ts
/**
 * Color de cada estado de campaña (mismo patrón que EstadosPublicacion.ts). Las claves son los
 * nombres del catálogo `Estado_Campaña` del backend; uno nuevo sin entrada cae al neutro.
 */
import type { EstiloEstado } from './EstadosMascota';

const ESTILOS: Record<string, EstiloEstado> = {
  Inactiva: { fondo: 'bg-sky-50 border-sky-200', texto: 'text-sky-700', etiqueta: 'Programada' },
  Activa: { fondo: 'bg-emerald-50 border-emerald-200', texto: 'text-emerald-700', etiqueta: 'Activa' },
  Finalizada: { fondo: 'bg-gray-100 border-gray-300', texto: 'text-gray-500', etiqueta: 'Finalizada' },
  Cancelada: { fondo: 'bg-red-50 border-red-200', texto: 'text-red-700', etiqueta: 'Cancelada' },
};

export function estiloDeEstadoCampania(nombre: string): EstiloEstado {
  return (
    ESTILOS[nombre] ?? { fondo: 'bg-gray-100 border-gray-200', texto: 'text-gray-600', etiqueta: nombre }
  );
}
```

> «Inactiva» se muestra como «Programada»: para el refugio, una campaña que todavía no empezó no está «inactiva». El nombre del catálogo no cambia. Si el equipo prefiere el literal, cambiar sólo `etiqueta`.

- [ ] **Step 2: `components/ui/EstadoCampaniaBadge.tsx`**

```tsx
/** Pastilla de estado de campaña, con el color de cada estado. */
import { Text, View } from 'react-native';

import { estiloDeEstadoCampania } from '../../constants/EstadosCampania';

export function EstadoCampaniaBadge({ estado }: { estado: string }) {
  const { fondo, texto, etiqueta } = estiloDeEstadoCampania(estado);

  return (
    <View className={`self-start rounded-full border px-2.5 py-1 ${fondo}`}>
      <Text className={`text-xs font-medium ${texto}`}>{etiqueta}</Text>
    </View>
  );
}
```

- [ ] **Step 3: `components/campanias/BarraProgreso.tsx`**

```tsx
/** Barra de progreso de una campaña. `porcentaje` ya viene topeado en 100 desde el backend. */
import { View } from 'react-native';

import { PALETA } from '@/constants/theme';

interface BarraProgresoProps {
  porcentaje: number;
  /** Sobre fondo naranja (tarjetas de Inicio): pista más oscura y relleno claro. */
  clara?: boolean;
}

export function BarraProgreso({ porcentaje, clara = false }: BarraProgresoProps) {
  const ancho = Math.max(0, Math.min(100, porcentaje));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: ancho }}
      className="h-2.5 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: clara ? PALETA.accent[700] : PALETA.neutral[200] }}
    >
      <View
        className="h-full rounded-full"
        style={{ width: `${ancho}%`, backgroundColor: clara ? PALETA.accent[100] : PALETA.accent[600] }}
      />
    </View>
  );
}
```

(Si `PALETA.neutral[200]` no existe en `constants/theme.js`, usar el tono neutro claro que use `TarjetaAviso` para su fondo: `bg-organic-neutral-200` → su valor en `PALETA`.)

- [ ] **Step 4: `components/campanias/TarjetaCampania.tsx`**

```tsx
/**
 * Tarjeta del portal de campañas del adoptante (GUI-13, pantalla 13 del diseño): imagen,
 * refugio, título, descripción, «Recaudado · Meta», barra con porcentaje y «Donar ahora».
 */
import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, Text, View } from 'react-native';

import { BarraProgreso } from '@/components/campanias/BarraProgreso';
import { PALETA } from '@/constants/theme';
import { formatearPesos } from '@/lib/campanias';
import { urlAbsoluta } from '@/services/api';
import type { Campania } from '@/services/campanias';

interface TarjetaCampaniaProps {
  campania: Campania;
  onDonar: () => void;
}

export function TarjetaCampania({ campania, onDonar }: TarjetaCampaniaProps) {
  const imagen = urlAbsoluta(campania.imagenUrl);

  return (
    <View className="overflow-hidden rounded-[24px] bg-organic-surface">
      <View className="w-full bg-organic-neutral-200" style={{ aspectRatio: 16 / 9 }}>
        {imagen ? (
          <Image source={{ uri: imagen }} className="h-full w-full" resizeMode="cover" />
        ) : (
          <View className="h-full w-full items-center justify-center">
            <Ionicons name="gift-outline" size={36} color={PALETA.neutral[400]} />
          </View>
        )}
      </View>

      <View className="gap-2 px-4 pb-4 pt-3">
        <Text className="font-cuerpo-bold text-[12px] uppercase tracking-[1px] text-organic-accent-600">
          {campania.refugio.nombre}
        </Text>
        <Text className="font-titulo text-[20px] leading-[24px] text-organic-neutral-900">
          {campania.titulo}
        </Text>
        <Text numberOfLines={3} className="font-cuerpo text-[14px] leading-[19px] text-organic-neutral-600">
          {campania.descripcion}
        </Text>

        <View className="mt-1 flex-row justify-between">
          <Text className="font-cuerpo-bold text-[14px] text-organic-neutral-900">
            Recaudado: {formatearPesos(campania.recaudado)}
          </Text>
          <Text className="font-cuerpo text-[14px] text-organic-neutral-600">
            Meta: {formatearPesos(campania.objetivo)}
          </Text>
        </View>
        <BarraProgreso porcentaje={campania.porcentaje} />
        <Text className="font-cuerpo text-[13px] text-organic-neutral-600">
          {campania.porcentaje}% completado
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Donar a ${campania.titulo}`}
          onPress={onDonar}
          className="mt-2 items-center rounded-full bg-organic-accent-600 py-3 active:opacity-90"
        >
          <Text className="font-cuerpo-bold text-[16px] text-white">Donar ahora</Text>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 5: `components/campanias/TarjetaCampaniaRefugio.tsx`**

```tsx
/**
 * Tarjeta de «Mis Campañas» (GUI-36, pantalla 21 del diseño): estado, título, montos, barra,
 * «N% · M donantes», aviso de donaciones por revisar y las acciones que permite su estado.
 * «Editar» se ve deshabilitado: la edición queda para una spec posterior.
 */
import { Pressable, Text, View } from 'react-native';

import { BarraProgreso } from '@/components/campanias/BarraProgreso';
import { EstadoCampaniaBadge } from '@/components/ui/EstadoCampaniaBadge';
import {
  accionesDisponibles,
  formatearPesos,
  textoDonantes,
  textoPendientes,
  type AccionCampania,
} from '@/lib/campanias';
import type { CampaniaRefugio } from '@/services/campanias';

const ETIQUETA_ACCION: Record<AccionCampania, string> = {
  finalizar: 'Finalizar',
  cancelar: 'Cancelar',
};

interface TarjetaCampaniaRefugioProps {
  campania: CampaniaRefugio;
  onAccion: (accion: AccionCampania) => void;
  onRevisar: () => void;
}

function BotonTarjeta({
  etiqueta,
  onPress,
  peligro = false,
  deshabilitado = false,
}: {
  etiqueta: string;
  onPress?: () => void;
  peligro?: boolean;
  deshabilitado?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: deshabilitado }}
      disabled={deshabilitado}
      onPress={onPress}
      className={`rounded-full border px-3.5 py-1.5 active:opacity-70 ${
        deshabilitado ? 'border-organic-neutral-300 opacity-50' : peligro ? 'border-red-300' : 'border-organic-accent-600'
      }`}
    >
      <Text
        className={`font-cuerpo-bold text-[13px] ${
          deshabilitado ? 'text-organic-neutral-500' : peligro ? 'text-red-700' : 'text-organic-accent-600'
        }`}
      >
        {etiqueta}
      </Text>
    </Pressable>
  );
}

export function TarjetaCampaniaRefugio({ campania, onAccion, onRevisar }: TarjetaCampaniaRefugioProps) {
  const pendientes = textoPendientes(campania.pendientes);

  return (
    <View className="gap-2 rounded-[22px] bg-organic-surface p-4">
      <EstadoCampaniaBadge estado={campania.estado.nombre} />
      <Text className="font-cuerpo-bold text-[17px] text-organic-neutral-900">{campania.titulo}</Text>

      <View className="flex-row justify-between">
        <Text className="font-cuerpo-bold text-[14px] text-organic-neutral-900">
          {formatearPesos(campania.recaudado)}
        </Text>
        <Text className="font-cuerpo text-[14px] text-organic-neutral-600">
          Meta: {formatearPesos(campania.objetivo)}
        </Text>
      </View>
      <BarraProgreso porcentaje={campania.porcentaje} />
      <Text className="font-cuerpo text-[13px] text-organic-neutral-600">
        {campania.porcentaje}% · {textoDonantes(campania.donantes)}
      </Text>

      {pendientes ? (
        <Pressable accessibilityRole="button" onPress={onRevisar} className="active:opacity-70">
          <Text className="font-cuerpo-bold text-[13px] text-organic-accent-600">{pendientes}</Text>
        </Pressable>
      ) : null}

      <View className="mt-1 flex-row flex-wrap gap-2">
        {accionesDisponibles(campania.estado.nombre).map((accion) => (
          <BotonTarjeta
            key={accion}
            etiqueta={ETIQUETA_ACCION[accion]}
            peligro={accion === 'cancelar'}
            onPress={() => onAccion(accion)}
          />
        ))}
        <BotonTarjeta etiqueta="Donaciones" onPress={onRevisar} />
        <BotonTarjeta etiqueta="Editar" deshabilitado />
      </View>
    </View>
  );
}
```

- [ ] **Step 6: Typecheck y commit**

```bash
npx tsc --noEmit
git add apps/mobile/constants/EstadosCampania.ts apps/mobile/components/ui/EstadoCampaniaBadge.tsx apps/mobile/components/campanias
git commit -m "Campañas mobile: tarjetas, barra de progreso y badge de estado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: GUI-13 portal del adoptante y pantalla «Donar»

**Files:**
- Create: `app/campanias/index.tsx`
- Create: `app/campanias/[id]/donar.tsx`
- Modify: `app/_layout.tsx` (registrar las dos rutas)

**Interfaces:**
- Consumes: `listarCampanias`, `obtenerCampania`, `donar`; `usePaginacionCursor`; `TarjetaCampania`; `EstadoCargando/EstadoError/EstadoVacio`; `BotonCircular`; `CustomButton`; `TextField`; `useToast`; `validarDecimal`, `filtrarEntradaDecimal`; `formatearPesos`.

- [ ] **Step 1: `app/campanias/index.tsx`**

Copiar la estructura de `app/perdidos/index.tsx` (cabecera con `BotonCircular` + título, `usePaginacionCursor`, `PieLista`, `RefreshControl`, `volver`), con estas diferencias:
- Título «Campañas Solidarias» y, debajo del título, `Ayudá a los refugios` en `font-cuerpo text-[13px] text-organic-neutral-600`.
- `cargarPagina` usa `listarCampanias(cursor)` y mapea `pagina.campanias`.
- `SIN_CONEXION = 'No pudimos cargar las campañas. Revisá tu conexión e intentalo de nuevo.'`
- `FlatList` de una columna (sin `numColumns`, sin relleno), `contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 16 }}`, `renderItem={({ item }) => <TarjetaCampania campania={item} onDonar={() => router.push(`/campanias/${item.id}/donar`)} />}`.
- `ListaVacia`: `<EstadoVacio icono="gift-outline" titulo="No hay campañas activas por ahora" descripcion="Cuando un refugio lance una campaña, la vas a ver acá." />`.
- Sin `BotonFlotante` ni modal de detalle, y sin `useFocusEffect`.

Código completo de las partes que cambian:

```tsx
export default function CampaniasAdoptanteScreen() {
  const router = useRouter();

  const cargarPagina = useCallback(async (cursor: number | null) => {
    const pagina = await listarCampanias(cursor);
    return { items: pagina.campanias, hayMas: pagina.hayMas, proximoCursor: pagina.proximoCursor };
  }, []);

  const lista = usePaginacionCursor({
    cargarPagina,
    claveDe: (campania: Campania) => campania.id,
    mensajeSinConexion: SIN_CONEXION,
  });

  const volver = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)');
  }, [router]);

  return (
    <View className="flex-1 bg-organic-bg">
      <SafeAreaView className="flex-1" edges={['top']}>
        <View className="flex-row items-center gap-3 border-b border-organic-neutral-300 bg-organic-surface px-[22px] pb-4 pt-2">
          <BotonCircular icono="arrow-back" etiqueta="Volver" onPress={volver} grande />
          <View>
            <Text className="font-titulo text-[28px] leading-[32px] text-organic-accent-600">
              Campañas Solidarias
            </Text>
            <Text className="font-cuerpo text-[13px] text-organic-neutral-600">
              Ayudá a los refugios
            </Text>
          </View>
        </View>

        {lista.cargando ? (
          <EstadoCargando />
        ) : lista.error ? (
          <EstadoError mensaje={lista.error} onAccion={lista.recargar} />
        ) : (
          <FlatList
            data={lista.items}
            keyExtractor={(campania) => String(campania.id)}
            renderItem={({ item }) => (
              <TarjetaCampania
                campania={item}
                onDonar={() => router.push(`/campanias/${item.id}/donar`)}
              />
            )}
            ListEmptyComponent={ListaVacia}
            ListFooterComponent={
              <PieLista
                cargandoMas={lista.cargandoMas}
                errorMas={lista.errorMas}
                onReintentar={lista.reintentarMas}
              />
            }
            onEndReached={lista.cargarMas}
            onEndReachedThreshold={0.5}
            contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 16 }}
            refreshControl={
              <RefreshControl
                refreshing={lista.refrescando}
                onRefresh={lista.refrescar}
                tintColor={PALETA.accent[600]}
              />
            }
          />
        )}
      </SafeAreaView>
    </View>
  );
}
```

`PieLista` es el mismo componente local de `app/perdidos/index.tsx`: copiarlo tal cual. (Si al terminar la Parte B hay tres copias, anotarlo en la deuda para extraerlo a `components/feedback/`; no extraerlo ahora.)

- [ ] **Step 2: `app/campanias/[id]/donar.tsx`**

```tsx
/**
 * Donar a una campaña (spec 026, HU-12.2 y HU-12.3). No está en el prototipo.
 *
 * Muestra alias y/o CBU para transferir desde el homebanking o la billetera, y un campo con el
 * monto transferido. «Terminar donación» avisa al refugio: la donación queda Pendiente y suma
 * a la campaña recién cuando el refugio confirma que recibió la plata (regla transversal 11).
 */
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { CustomButton } from '@/components/CustomButton';
import { EstadoCargando, EstadoError } from '@/components/feedback/EstadosPantalla';
import { useToast } from '@/components/feedback/Toast';
import { BotonCircular } from '@/components/ui/BotonCircular';
import { FormularioConTeclado } from '@/components/ui/FormularioConTeclado';
import { Nota } from '@/components/ui/Nota';
import { TextField } from '@/components/ui/TextField';
import { PALETA } from '@/constants/theme';
import { formatearPesos } from '@/lib/campanias';
import { ApiError } from '@/services/api';
import { donar, obtenerCampania, type Campania } from '@/services/campanias';
import { LIMITES } from '@/shared/validation/limits';
import { filtrarEntradaDecimal, validarDecimal } from '@/shared/validation/numbers';

const { monto: LIMITE_MONTO } = LIMITES.donacion;

function DatoParaCopiar({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  const toast = useToast();

  const copiar = async (): Promise<void> => {
    await Clipboard.setStringAsync(valor);
    toast.mostrarExito(`Copiaste el ${etiqueta.toLowerCase()}.`);
  };

  return (
    <View className="flex-row items-center justify-between gap-3 rounded-[16px] bg-organic-bg px-4 py-3">
      <View className="min-w-0 flex-1">
        <Text className="font-cuerpo-bold text-[11px] uppercase tracking-[1px] text-organic-neutral-600">
          {etiqueta}
        </Text>
        <Text selectable className="font-cuerpo-bold text-[16px] text-organic-neutral-900">
          {valor}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Copiar ${etiqueta}`}
        onPress={() => void copiar()}
        hitSlop={8}
        className="active:opacity-60"
      >
        <Ionicons name="copy-outline" size={22} color={PALETA.accent[600]} />
      </Pressable>
    </View>
  );
}

export default function DonarCampaniaScreen() {
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const campaniaId = Number(id);

  const [campania, setCampania] = useState<Campania | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [monto, setMonto] = useState('');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setError(null);
    obtenerCampania(campaniaId)
      .then(setCampania)
      .catch((err: unknown) =>
        setError(
          err instanceof ApiError
            ? err.message
            : 'No pudimos cargar la campaña. Revisá tu conexión e intentalo de nuevo.',
        ),
      );
  }, [campaniaId, intento]);

  const errorMonto = validarDecimal(monto, { ...LIMITE_MONTO, etiqueta: 'El monto' });

  const terminar = async (): Promise<void> => {
    setTocado(true);
    if (errorMonto) return;

    setEnviando(true);
    try {
      await donar(campaniaId, monto);
      toast.mostrarExito('¡Gracias! El refugio va a confirmar tu donación.');
      router.back();
    } catch (err) {
      toast.mostrarError(
        err instanceof ApiError ? err.message : 'No pudimos registrar tu donación. Intentalo de nuevo.',
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <View className="flex-1 bg-organic-bg">
      <SafeAreaView className="flex-1" edges={['top']}>
        <View className="flex-row items-center gap-3 border-b border-organic-neutral-300 bg-organic-surface px-[22px] pb-4 pt-2">
          <BotonCircular icono="arrow-back" etiqueta="Volver" onPress={() => router.back()} grande />
          <Text className="font-titulo text-[28px] leading-[32px] text-organic-accent-600">Donar</Text>
        </View>

        {error ? (
          <EstadoError mensaje={error} onAccion={() => setIntento((n) => n + 1)} />
        ) : !campania ? (
          <EstadoCargando />
        ) : (
          <FormularioConTeclado className="flex-1" contentContainerClassName="gap-4 px-4 pb-10 pt-4">
            <View className="gap-1">
              <Text className="font-cuerpo-bold text-[12px] uppercase tracking-[1px] text-organic-accent-600">
                {campania.refugio.nombre}
              </Text>
              <Text className="font-titulo text-[22px] leading-[26px] text-organic-neutral-900">
                {campania.titulo}
              </Text>
              <Text className="font-cuerpo text-[14px] text-organic-neutral-600">
                Recaudado {formatearPesos(campania.recaudado)} de {formatearPesos(campania.objetivo)}
              </Text>
            </View>

            <View className="gap-2 rounded-[22px] bg-organic-surface p-4">
              <Text className="font-cuerpo-bold text-[15px] text-organic-neutral-900">
                1. Transferí desde tu banco o billetera
              </Text>
              {campania.alias ? <DatoParaCopiar etiqueta="Alias" valor={campania.alias} /> : null}
              {campania.cbu ? <DatoParaCopiar etiqueta="CBU / CVU" valor={campania.cbu} /> : null}
            </View>

            <View className="gap-2 rounded-[22px] bg-organic-surface p-4">
              <Text className="font-cuerpo-bold text-[15px] text-organic-neutral-900">
                2. Contanos cuánto transferiste
              </Text>
              <TextField
                label="Monto que transferiste ($)"
                obligatorio
                placeholder="Ej. 5000"
                keyboardType="decimal-pad"
                value={monto}
                onChangeText={(texto) => setMonto(filtrarEntradaDecimal(texto, LIMITE_MONTO.decimales))}
                onBlur={() => setTocado(true)}
                error={tocado && errorMonto ? errorMonto : undefined}
                grande
              />
            </View>

            <Nota texto="Tu donación se suma a la campaña cuando el refugio confirme que recibió la transferencia." />

            <CustomButton
              title="Terminar donación"
              variant="acento"
              loading={enviando}
              disabled={!!errorMonto}
              onPress={() => void terminar()}
              onPressDeshabilitado={() => setTocado(true)}
            />
          </FormularioConTeclado>
        )}
      </SafeAreaView>
    </View>
  );
}
```

`expo-clipboard` no está en `package.json`: instalarlo con `npx expo install expo-clipboard` (lo pide el botón copiar). Si el equipo prefiere no sumar dependencias, sacar `DatoParaCopiar` y dejar el valor con `selectable` (se copia con pulsación larga).

- [ ] **Step 3: Registrar rutas en `app/_layout.tsx`**

Después de `perdidos/nuevo`:

```tsx
        <Stack.Screen name="campanias/index" />
        <Stack.Screen name="campanias/[id]/donar" options={{ presentation: 'card' }} />
```

- [ ] **Step 4: Verificar**

```bash
npx tsc --noEmit
npx expo start
```

A mano, logueado como adoptante del seed: entrar a `/campanias` (por ahora escribiendo la ruta o desde Task 16), ver «Castraciones de primavera» y «Alimento para el invierno» con barra; «Donar ahora» → ver alias/CBU, copiar, cargar «1500,50» → toast y vuelta; la barra NO cambia. Monto vacío o «0» → botón deshabilitado con error al tocarlo.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/campanias apps/mobile/app/_layout.tsx apps/mobile/package.json apps/mobile/package-lock.json
git commit -m "GUI-13 Campañas del adoptante y pantalla para donar (HU-12.2, HU-12.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: GUI-36 «Mis Campañas» y GUI-37 «Nueva Campaña»

**Files:**
- Create: `app/campanias/refugio/index.tsx`
- Create: `app/campanias/refugio/nueva.tsx`
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `listarMisCampanias`, `cambiarEstadoCampania`, `crearCampania`, `SIN_FILTROS_CAMPANIAS`, `FiltrosMisCampanias`; `listarEstadosCampania`; `TarjetaCampaniaRefugio`; `FiltroEstados`; `DateField`; `ConfirmDialog`; `BotonFlotante`; `PhotoPicker`; `TextField`, `TextAreaField`; `validarTexto`, `validarDecimal`, `validarFechaNoPasada`, `validarAlias`, `validarCbu`; `avisarCampaniaCreada`/`tomarCampaniaCreada`; `estiloDeEstadoCampania`.

- [ ] **Step 1: `app/campanias/refugio/index.tsx`**

```tsx
/**
 * GUI-36 Campañas Refugio — «Mis Campañas» (spec 026, HU-12.1, HU-12.5, HU-12.6).
 *
 * Listado de las campañas del refugio, de la más reciente a la más vieja, con filtros por
 * estado (selección múltiple) y por fecha de inicio (desde obligatoria, hasta opcional).
 * Finalizar y cancelar piden confirmación (regla transversal 6). Se entra desde la vista de
 * refugio: el backend corta si el perfil activo no es el de refugio.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TarjetaCampaniaRefugio } from '@/components/campanias/TarjetaCampaniaRefugio';
import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/feedback/EstadosPantalla';
import { useToast } from '@/components/feedback/Toast';
import { BotonCircular } from '@/components/ui/BotonCircular';
import { BotonFlotante } from '@/components/ui/BotonFlotante';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DateField } from '@/components/ui/DateField';
import { FiltroEstados, type OpcionEstado } from '@/components/ui/FiltroEstados';
import { estiloDeEstadoCampania } from '@/constants/EstadosCampania';
import { PALETA } from '@/constants/theme';
import { usePaginacionCursor } from '@/hooks/usePaginacionCursor';
import type { AccionCampania } from '@/lib/campanias';
import { tomarCampaniaCreada } from '@/lib/campaniaRecienCreada';
import { ApiError } from '@/services/api';
import {
  cambiarEstadoCampania,
  listarMisCampanias,
  SIN_FILTROS_CAMPANIAS,
  type CampaniaRefugio,
  type FiltrosMisCampanias,
} from '@/services/campanias';
import { listarEstadosCampania } from '@/services/catalogos';

const SIN_CONEXION = 'No pudimos cargar tus campañas. Revisá tu conexión e intentalo de nuevo.';

const CONFIRMACION: Record<AccionCampania, { titulo: string; mensaje: string; boton: string; estado: 'Finalizada' | 'Cancelada' }> = {
  finalizar: {
    titulo: '¿Finalizar la campaña?',
    mensaje: 'Deja de recibir donaciones. Vas a poder seguir revisando las que ya te avisaron.',
    boton: 'Finalizar',
    estado: 'Finalizada',
  },
  cancelar: {
    titulo: '¿Cancelar la campaña?',
    mensaje: 'La campaña se da de baja y deja de recibir donaciones. No se puede deshacer.',
    boton: 'Cancelar campaña',
    estado: 'Cancelada',
  },
};

/** Literal de HU-12.1. */
function ListaVacia() {
  return (
    <EstadoVacio
      icono="cash-outline"
      titulo="No tiene campañas creadas"
      descripcion="Tocá el botón + para crear la primera."
    />
  );
}

export default function MisCampaniasScreen() {
  const router = useRouter();
  const toast = useToast();

  const [estados, setEstados] = useState<OpcionEstado[]>([]);
  const [filtros, setFiltros] = useState<FiltrosMisCampanias>(SIN_FILTROS_CAMPANIAS);
  const [confirmando, setConfirmando] = useState<{ campania: CampaniaRefugio; accion: AccionCampania } | null>(null);
  const [procesando, setProcesando] = useState(false);

  useEffect(() => {
    listarEstadosCampania()
      .then((catalogo) =>
        setEstados(catalogo.map((e) => ({ id: e.id, etiqueta: estiloDeEstadoCampania(e.nombre).etiqueta }))),
      )
      // Sin catálogo el listado igual funciona; sólo falta el filtro por estado.
      .catch(() => setEstados([]));
  }, []);

  const cargarPagina = useCallback(
    async (cursor: number | null) => {
      const pagina = await listarMisCampanias(filtros, cursor);
      return { items: pagina.campanias, hayMas: pagina.hayMas, proximoCursor: pagina.proximoCursor };
    },
    [filtros],
  );

  const lista = usePaginacionCursor({
    cargarPagina,
    claveDe: (campania: CampaniaRefugio) => campania.id,
    mensajeSinConexion: SIN_CONEXION,
  });

  const { agregarAlPrincipio, recargar } = lista;
  useFocusEffect(
    useCallback(() => {
      const creada = tomarCampaniaCreada();
      if (creada) agregarAlPrincipio(creada);
    }, [agregarAlPrincipio]),
  );

  const confirmar = async (): Promise<void> => {
    if (!confirmando) return;
    const { campania, accion } = confirmando;

    setProcesando(true);
    try {
      await cambiarEstadoCampania(campania.id, CONFIRMACION[accion].estado);
      toast.mostrarExito(accion === 'finalizar' ? 'Finalizaste la campaña.' : 'Cancelaste la campaña.');
      setConfirmando(null);
      recargar();
    } catch (err) {
      toast.mostrarError(err instanceof ApiError ? err.message : 'No pudimos actualizar la campaña. Intentalo de nuevo.');
    } finally {
      setProcesando(false);
    }
  };

  const volver = (): void => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  return (
    <View className="flex-1 bg-organic-bg">
      <SafeAreaView className="flex-1" edges={['top']}>
        <View className="flex-row items-center gap-3 border-b border-organic-neutral-300 bg-organic-surface px-[22px] pb-4 pt-2">
          <BotonCircular icono="arrow-back" etiqueta="Volver" onPress={volver} grande />
          <Text className="font-titulo text-[28px] leading-[32px] text-organic-accent-600">Mis Campañas</Text>
        </View>

        <View className="gap-2 pt-3">
          <FiltroEstados
            opciones={estados}
            seleccionados={filtros.estados}
            onChange={(seleccionados) => setFiltros((f) => ({ ...f, estados: seleccionados }))}
          />
          <View className="flex-row items-end gap-2 px-[22px] pb-2">
            <View className="flex-1">
              <DateField
                label="Inicio desde"
                placeholder="Elegí"
                valor={filtros.fechaDesde ?? null}
                onChange={(fecha) => setFiltros((f) => ({ ...f, fechaDesde: fecha }))}
                fechaMaxima={new Date(2100, 0, 1)}
                mostrarEdad={false}
              />
            </View>
            <View className="flex-1">
              <DateField
                label="Hasta (opcional)"
                placeholder="Elegí"
                valor={filtros.fechaHasta ?? null}
                onChange={(fecha) => setFiltros((f) => ({ ...f, fechaHasta: fecha }))}
                fechaMinima={filtros.fechaDesde}
                fechaMaxima={new Date(2100, 0, 1)}
                mostrarEdad={false}
              />
            </View>
            {filtros.fechaDesde ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setFiltros((f) => ({ estados: f.estados }))}
                hitSlop={8}
                className="pb-3 active:opacity-60"
              >
                <Text className="font-cuerpo-bold text-[13px] text-organic-accent-600">Limpiar</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {lista.cargando ? (
          <EstadoCargando />
        ) : lista.error ? (
          <EstadoError mensaje={lista.error} onAccion={lista.recargar} />
        ) : (
          <FlatList
            data={lista.items}
            keyExtractor={(campania) => String(campania.id)}
            renderItem={({ item }) => (
              <TarjetaCampaniaRefugio
                campania={item}
                onAccion={(accion) => setConfirmando({ campania: item, accion })}
                onRevisar={() => router.push(`/campanias/refugio/${item.id}/donaciones`)}
              />
            )}
            ListEmptyComponent={ListaVacia}
            ListFooterComponent={
              lista.cargandoMas ? (
                <View className="items-center py-5">
                  <ActivityIndicator color={PALETA.accent[600]} />
                </View>
              ) : null
            }
            onEndReached={lista.cargarMas}
            onEndReachedThreshold={0.5}
            contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 14, paddingBottom: 112 }}
            refreshControl={
              <RefreshControl refreshing={lista.refrescando} onRefresh={lista.refrescar} tintColor={PALETA.accent[600]} />
            }
          />
        )}

        <BotonFlotante
          accessibilityLabel="Crear una campaña"
          onPress={() => router.push('/campanias/refugio/nueva')}
        />
      </SafeAreaView>

      <ConfirmDialog
        visible={confirmando !== null}
        tono="peligro"
        titulo={confirmando ? CONFIRMACION[confirmando.accion].titulo : ''}
        mensaje={confirmando ? CONFIRMACION[confirmando.accion].mensaje : ''}
        textoConfirmar={confirmando ? CONFIRMACION[confirmando.accion].boton : undefined}
        textoCancelar="Volver"
        cargando={procesando}
        onConfirmar={() => void confirmar()}
        onCerrar={() => setConfirmando(null)}
      />
    </View>
  );
}
```

Revisar al implementar: que `BotonFlotante` acepte `accessibilityLabel` y `onPress` (así se usa en `app/perdidos/index.tsx`), y las props exactas de `ConfirmDialog` (`textoCancelar`, `cargando`, `onCerrar` según `components/ui/ConfirmDialog.tsx:27-50`). Si `DateField` sin `onBlur`/`obligatorio` no compila, pasarle `obligatorio={false}`.

- [ ] **Step 2: `app/campanias/refugio/nueva.tsx`**

```tsx
/**
 * GUI-37 Crear Campaña — HU-12.1 (spec 026). Pantalla 27 del diseño («Nueva Campaña»).
 *
 * Campos: imagen, título, descripción (≤300), meta (sólo números, $10.000 a $2.500.000),
 * fecha de inicio (desde hoy), fecha límite (posterior al inicio), alias y CBU/CVU (al menos
 * uno). Botones literales de la HU: «Cancelar» (rojo, vuelve al listado) y «Confirmar» (verde,
 * crea la campaña). Validación sólo para UX: la real es del backend y sus mensajes se muestran
 * tal cual (incluido el límite de 5 campañas).
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useToast } from '@/components/feedback/Toast';
import { BotonCircular } from '@/components/ui/BotonCircular';
import { DateField } from '@/components/ui/DateField';
import { FormCard, FormCardRow } from '@/components/ui/FormCard';
import { FormularioConTeclado } from '@/components/ui/FormularioConTeclado';
import { PhotoPicker, type FotoElegida } from '@/components/ui/PhotoPicker';
import { TextAreaField } from '@/components/ui/TextAreaField';
import { TextField } from '@/components/ui/TextField';
import { avisarCampaniaCreada } from '@/lib/campaniaRecienCreada';
import { ApiError } from '@/services/api';
import { crearCampania } from '@/services/campanias';
import { validarAlias, validarCbu } from '@/shared/validation/bancario';
import { validarFechaNoPasada } from '@/shared/validation/dates';
import { LIMITES } from '@/shared/validation/limits';
import { filtrarEntradaDecimal, validarDecimal } from '@/shared/validation/numbers';
import { validarTexto } from '@/shared/validation/text';

const { campania: LIM } = LIMITES;
const FECHA_MAXIMA = new Date(2100, 0, 1);

interface Errores {
  imagen?: string;
  titulo?: string;
  descripcion?: string;
  objetivo?: string;
  fechaInicio?: string;
  fechaFin?: string;
  alias?: string;
  cbu?: string;
}

function hoy(): Date {
  const fecha = new Date();
  fecha.setHours(0, 0, 0, 0);
  return fecha;
}

export default function NuevaCampaniaScreen() {
  const router = useRouter();
  const toast = useToast();

  const [imagen, setImagen] = useState<FotoElegida | null>(null);
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [fechaInicio, setFechaInicio] = useState<Date | null>(null);
  const [fechaFin, setFechaFin] = useState<Date | null>(null);
  const [alias, setAlias] = useState('');
  const [cbu, setCbu] = useState('');
  const [mostrarErrores, setMostrarErrores] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const errores = useMemo<Errores>(() => {
    const e: Errores = {};

    if (!imagen) e.imagen = 'Agregá una imagen para la campaña';
    const eTitulo = validarTexto(titulo, { ...LIM.titulo, etiqueta: 'El título' });
    if (eTitulo) e.titulo = eTitulo;
    const eDescripcion = validarTexto(descripcion, { max: LIM.descripcion.max, etiqueta: 'La descripción' });
    if (eDescripcion) e.descripcion = eDescripcion;
    const eObjetivo = validarDecimal(objetivo, { ...LIM.objetivo, etiqueta: 'La meta' });
    if (eObjetivo) e.objetivo = eObjetivo;
    const eInicio = validarFechaNoPasada(fechaInicio, 'La fecha de inicio');
    if (eInicio) e.fechaInicio = eInicio;
    if (!fechaFin) e.fechaFin = 'La fecha límite es obligatoria';
    else if (fechaInicio && fechaFin.getTime() <= fechaInicio.getTime()) {
      e.fechaFin = 'La fecha límite tiene que ser posterior a la de inicio';
    }
    const eAlias = validarAlias(alias);
    if (eAlias) e.alias = eAlias;
    const eCbu = validarCbu(cbu);
    if (eCbu) e.cbu = eCbu;
    if (!alias.trim() && !cbu.trim()) e.alias = 'Cargá el alias o el CBU/CVU para que puedan donarte';

    return e;
  }, [imagen, titulo, descripcion, objetivo, fechaInicio, fechaFin, alias, cbu]);

  const valido = Object.keys(errores).length === 0;
  const errorDe = (campo: keyof Errores): string | undefined => (mostrarErrores ? errores[campo] : undefined);

  const confirmar = async (): Promise<void> => {
    setMostrarErrores(true);
    if (!valido || !imagen || !fechaInicio || !fechaFin) {
      toast.mostrarAdvertencia('Revisá los campos marcados antes de confirmar.');
      return;
    }

    setGuardando(true);
    try {
      const creada = await crearCampania({
        titulo: titulo.trim(),
        descripcion: descripcion.trim(),
        objetivo,
        fechaInicio,
        fechaFin,
        alias: alias.trim(),
        cbu: cbu.replace(/\s+/g, ''),
        imagen,
      });
      toast.mostrarExito('Creaste la campaña.');
      avisarCampaniaCreada(creada);
      router.back();
    } catch (err) {
      // Se queda con todo cargado para reintentar (incluido el límite de 5 campañas).
      toast.mostrarError(err instanceof ApiError ? err.message : 'No pudimos crear la campaña. Intentalo de nuevo.');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <View className="flex-1 bg-organic-bg">
      <SafeAreaView className="flex-1" edges={['top']}>
        <View className="flex-row items-center gap-3 border-b border-organic-neutral-300 bg-organic-surface px-[22px] pb-4 pt-2">
          <BotonCircular icono="arrow-back" etiqueta="Cancelar y volver" onPress={() => router.back()} grande />
          <Text className="font-titulo text-[28px] leading-[32px] text-organic-accent-600">Nueva Campaña</Text>
        </View>

        <FormularioConTeclado className="flex-1" contentContainerClassName="gap-4 px-4 pb-10 pt-4">
          <PhotoPicker foto={imagen} onChange={setImagen} error={errorDe('imagen')} grande />

          <FormCard>
            <FormCardRow>
              <TextField
                label="Título"
                obligatorio
                placeholder="Nombre de la campaña"
                value={titulo}
                onChangeText={setTitulo}
                maxLength={LIM.titulo.max}
                error={errorDe('titulo')}
                grande
              />
            </FormCardRow>
            <FormCardRow>
              <TextAreaField
                label="Descripción"
                obligatorio
                placeholder="¿Para qué se usarán los fondos?"
                value={descripcion}
                onChangeText={setDescripcion}
                maximo={LIM.descripcion.max}
                error={errorDe('descripcion')}
                grande
              />
            </FormCardRow>
            <FormCardRow>
              <TextField
                label="Meta de recaudación ($)"
                obligatorio
                placeholder="Entre 10000 y 2500000"
                keyboardType="number-pad"
                value={objetivo}
                onChangeText={(texto) => setObjetivo(filtrarEntradaDecimal(texto, 0))}
                error={errorDe('objetivo')}
                grande
              />
            </FormCardRow>
            <FormCardRow>
              <DateField
                label="Fecha de inicio"
                obligatorio
                placeholder="Elegí la fecha"
                valor={fechaInicio}
                onChange={setFechaInicio}
                fechaMinima={hoy()}
                fechaMaxima={FECHA_MAXIMA}
                mostrarEdad={false}
                error={errorDe('fechaInicio')}
                grande
              />
            </FormCardRow>
            <FormCardRow>
              <DateField
                label="Fecha límite"
                obligatorio
                placeholder="Elegí la fecha"
                valor={fechaFin}
                onChange={setFechaFin}
                fechaMinima={fechaInicio ?? hoy()}
                fechaMaxima={FECHA_MAXIMA}
                mostrarEdad={false}
                error={errorDe('fechaFin')}
                grande
              />
            </FormCardRow>
            <FormCardRow>
              <TextField
                label="Alias"
                placeholder="Ej. refugio.patitas.mp"
                autoCapitalize="none"
                value={alias}
                onChangeText={setAlias}
                maxLength={LIM.alias.max}
                error={errorDe('alias')}
                ayuda="Cargá el alias, el CBU/CVU o los dos."
                grande
              />
            </FormCardRow>
            <FormCardRow ultima>
              <TextField
                label="CBU / CVU"
                placeholder="22 números"
                keyboardType="number-pad"
                value={cbu}
                onChangeText={(texto) => setCbu(texto.replace(/[^\d\s]/g, ''))}
                error={errorDe('cbu')}
                grande
              />
            </FormCardRow>
          </FormCard>

          <View className="flex-row gap-3">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              className="flex-1 items-center rounded-full bg-red-600 py-3.5 active:opacity-90"
            >
              <Text className="font-cuerpo-bold text-[16px] text-white">Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: guardando, busy: guardando }}
              disabled={guardando}
              onPress={() => void confirmar()}
              className={`flex-1 items-center rounded-full bg-emerald-600 py-3.5 active:opacity-90 ${guardando ? 'opacity-60' : ''}`}
            >
              <Text className="font-cuerpo-bold text-[16px] text-white">
                {guardando ? 'Creando…' : 'Confirmar'}
              </Text>
            </Pressable>
          </View>
        </FormularioConTeclado>
      </SafeAreaView>
    </View>
  );
}
```

Si `FormCardRow` no acepta `ultima` o `TextField` no acepta `ayuda`, ver sus props en `components/ui/FormCard.tsx` y `TextField.tsx` (en `app/perdidos/nuevo.tsx` se usa `FormCardRow ultima`; `ayuda` está en `TextFieldProps`).

- [ ] **Step 3: Rutas en `app/_layout.tsx`**

```tsx
        <Stack.Screen name="campanias/refugio/index" />
        <Stack.Screen name="campanias/refugio/nueva" options={{ presentation: 'card' }} />
```

- [ ] **Step 4: Verificar**

`npx tsc --noEmit`, y a mano logueado como miembro de «patitas» en vista refugio: `/campanias/refugio` muestra las tres campañas del seed con sus estados; filtrar «Activa» deja una; filtrar desde una fecha futura deja la lista vacía con «No tiene campañas creadas»; crear una campaña que empieza hoy → vuelve y aparece arriba como «Activa»; crear con inicio mañana → «Programada». Finalizar la activa → modal → pasa a «Finalizada» y ya no ofrece acciones.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/campanias/refugio apps/mobile/app/_layout.tsx
git commit -m "GUI-36 Mis Campañas y GUI-37 Nueva Campaña (HU-12.1, HU-12.5, HU-12.6)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Revisar donaciones (refugio)

**Files:**
- Create: `app/campanias/refugio/[id]/donaciones.tsx`
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `listarDonaciones`, `resolverDonacion`, `EstadoDonacionFiltro`, `Donacion`; `usePaginacionCursor`; `ConfirmDialog` (con `children`); `Chip`; `Segmentado`; `formatearPesos`, `ETIQUETA_MOTIVO`, `MotivoRechazo`; `tiempoRelativo` de `shared/validation/dates`.

- [ ] **Step 1: Pantalla**

```tsx
/**
 * Revisar donaciones de una campaña (spec 026, HU-12.3). No está en el prototipo.
 *
 * Abre en «Pendientes»: lo que el refugio tiene que hacer. «Aplicar» suma el monto a la
 * campaña (después de verificar el ingreso en su cuenta) y «Rechazar» pide el motivo. Las dos
 * con confirmación (regla transversal 6).
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EstadoCargando, EstadoError, EstadoVacio } from '@/components/feedback/EstadosPantalla';
import { useToast } from '@/components/feedback/Toast';
import { BotonCircular } from '@/components/ui/BotonCircular';
import { Chip } from '@/components/ui/Chip';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Segmentado, type OpcionSegmento } from '@/components/ui/Segmentado';
import { PALETA } from '@/constants/theme';
import { usePaginacionCursor } from '@/hooks/usePaginacionCursor';
import { ETIQUETA_MOTIVO, formatearPesos, type MotivoRechazo } from '@/lib/campanias';
import { ApiError } from '@/services/api';
import {
  listarDonaciones,
  resolverDonacion,
  type Donacion,
  type EstadoDonacionFiltro,
} from '@/services/campanias';
import { tiempoRelativo } from '@/shared/validation/dates';

type Vista = EstadoDonacionFiltro | 'Todas';

const VISTAS: OpcionSegmento<Vista>[] = [
  { valor: 'Pendiente', etiqueta: 'Pendientes' },
  { valor: 'Realizada', etiqueta: 'Aplicadas' },
  { valor: 'Cancelada', etiqueta: 'Rechazadas' },
  { valor: 'Todas', etiqueta: 'Todas' },
];

const VACIO: Record<Vista, string> = {
  Pendiente: 'No tenés donaciones para revisar',
  Realizada: 'Todavía no aplicaste donaciones',
  Cancelada: 'No rechazaste ninguna donación',
  Todas: 'Todavía nadie avisó que donó',
};

type Revision = { donacion: Donacion; accion: 'aplicar' | 'rechazar' };

function FilaDonacion({ donacion, onRevisar }: { donacion: Donacion; onRevisar: (accion: Revision['accion']) => void }) {
  const pendiente = donacion.estado.nombre === 'Pendiente';

  return (
    <View className="gap-2 rounded-[20px] bg-organic-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="font-cuerpo-bold text-[16px] text-organic-neutral-900">
          {donacion.donante.nombre} {donacion.donante.apellido}
        </Text>
        <Text className="font-cuerpo-bold text-[16px] text-organic-accent-600">{formatearPesos(donacion.monto)}</Text>
      </View>
      <Text className="font-cuerpo text-[13px] text-organic-neutral-600">
        {tiempoRelativo(new Date(donacion.fechaAlta))}
        {donacion.motivoRechazo ? ` · ${ETIQUETA_MOTIVO[donacion.motivoRechazo]}` : ''}
      </Text>
      {pendiente ? (
        <View className="mt-1 flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => onRevisar('rechazar')}
            className="flex-1 items-center rounded-full border border-red-300 py-2 active:opacity-70"
          >
            <Text className="font-cuerpo-bold text-[14px] text-red-700">Rechazar</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onRevisar('aplicar')}
            className="flex-1 items-center rounded-full bg-emerald-600 py-2 active:opacity-90"
          >
            <Text className="font-cuerpo-bold text-[14px] text-white">Aplicar</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function RevisarDonacionesScreen() {
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const campaniaId = Number(id);

  const [vista, setVista] = useState<Vista>('Pendiente');
  const [revision, setRevision] = useState<Revision | null>(null);
  const [motivo, setMotivo] = useState<MotivoRechazo | null>(null);
  const [procesando, setProcesando] = useState(false);

  const cargarPagina = useCallback(
    async (cursor: number | null) => {
      const pagina = await listarDonaciones(campaniaId, vista === 'Todas' ? null : vista, cursor);
      return { items: pagina.donaciones, hayMas: pagina.hayMas, proximoCursor: pagina.proximoCursor };
    },
    [campaniaId, vista],
  );

  const lista = usePaginacionCursor({
    cargarPagina,
    claveDe: (donacion: Donacion) => donacion.id,
    mensajeSinConexion: 'No pudimos cargar las donaciones. Revisá tu conexión e intentalo de nuevo.',
  });

  const cerrar = (): void => {
    setRevision(null);
    setMotivo(null);
  };

  const confirmar = async (): Promise<void> => {
    if (!revision) return;
    if (revision.accion === 'rechazar' && !motivo) {
      toast.mostrarAdvertencia('Elegí por qué rechazás la donación.');
      return;
    }

    setProcesando(true);
    try {
      await resolverDonacion(
        revision.donacion.id,
        revision.accion === 'aplicar' ? { estado: 'Realizada' } : { estado: 'Cancelada', motivo: motivo! },
      );
      toast.mostrarExito(revision.accion === 'aplicar' ? 'Aplicaste la donación.' : 'Rechazaste la donación.');
      cerrar();
      lista.recargar();
    } catch (err) {
      toast.mostrarError(err instanceof ApiError ? err.message : 'No pudimos actualizar la donación. Intentalo de nuevo.');
    } finally {
      setProcesando(false);
    }
  };

  const aplicar = revision?.accion === 'aplicar';

  return (
    <View className="flex-1 bg-organic-bg">
      <SafeAreaView className="flex-1" edges={['top']}>
        <View className="flex-row items-center gap-3 border-b border-organic-neutral-300 bg-organic-surface px-[22px] pb-4 pt-2">
          <BotonCircular icono="arrow-back" etiqueta="Volver" onPress={() => router.back()} grande />
          <Text className="font-titulo text-[28px] leading-[32px] text-organic-accent-600">Donaciones</Text>
        </View>

        <View className="px-4 pt-3">
          <Segmentado opciones={VISTAS} valor={vista} onChange={setVista} variante="organica" />
        </View>

        {lista.cargando ? (
          <EstadoCargando />
        ) : lista.error ? (
          <EstadoError mensaje={lista.error} onAccion={lista.recargar} />
        ) : (
          <FlatList
            data={lista.items}
            keyExtractor={(donacion) => String(donacion.id)}
            renderItem={({ item }) => (
              <FilaDonacion donacion={item} onRevisar={(accion) => setRevision({ donacion: item, accion })} />
            )}
            ListEmptyComponent={<EstadoVacio icono="cash-outline" titulo={VACIO[vista]} />}
            onEndReached={lista.cargarMas}
            onEndReachedThreshold={0.5}
            contentContainerStyle={{ flexGrow: 1, padding: 16, gap: 12 }}
            refreshControl={
              <RefreshControl refreshing={lista.refrescando} onRefresh={lista.refrescar} tintColor={PALETA.accent[600]} />
            }
          />
        )}
      </SafeAreaView>

      <ConfirmDialog
        visible={revision !== null}
        tono={aplicar ? 'exito' : 'peligro'}
        titulo={aplicar ? '¿Aplicar la donación?' : '¿Rechazar la donación?'}
        mensaje={
          revision
            ? aplicar
              ? `Verificá que recibiste ${formatearPesos(revision.donacion.monto)} en tu cuenta. El monto se suma a la campaña.`
              : 'La donación no se va a sumar a la campaña.'
            : ''
        }
        textoConfirmar={aplicar ? 'Aplicar' : 'Rechazar'}
        textoCancelar="Volver"
        cargando={procesando}
        onConfirmar={() => void confirmar()}
        onCerrar={cerrar}
      >
        {revision && !aplicar ? (
          <View className="gap-2">
            {(Object.keys(ETIQUETA_MOTIVO) as MotivoRechazo[]).map((clave) => (
              <Chip
                key={clave}
                etiqueta={ETIQUETA_MOTIVO[clave]}
                variante="seleccion"
                rol="radio"
                activa={motivo === clave}
                onPress={() => setMotivo(clave)}
              />
            ))}
          </View>
        ) : null}
      </ConfirmDialog>
    </View>
  );
}
```

Revisar al implementar: la firma de `Segmentado` (en `app/perdidos/nuevo.tsx` se usa con `opciones`, `valor`, `onChange`, `variante="organica"`; confirmar que acepta 4 opciones sin cortar el texto, si no, usar `FiltroEstados`-style chips horizontales) y que `EstadoVacio` acepte `descripcion` opcional.

- [ ] **Step 2: Ruta en `app/_layout.tsx`**

```tsx
        <Stack.Screen name="campanias/refugio/[id]/donaciones" options={{ presentation: 'card' }} />
```

- [ ] **Step 3: Verificar**

`npx tsc --noEmit`, y a mano: en «Castraciones de primavera» → «Donaciones» abre con las 2 pendientes del seed (+ la que cargaste en Task 13 si fue a esa campaña). Rechazar sin elegir motivo → aviso; con motivo → pasa a «Rechazadas». Aplicar la otra → vuelve a «Mis Campañas» y el recaudado subió ese monto.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/campanias/refugio apps/mobile/app/_layout.tsx
git commit -m "Revisar donaciones de una campaña: aplicar o rechazar con motivo (HU-12.3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Accesos desde Inicio y Perfil

**Files:**
- Create: `components/home/CampaniasInicio.tsx`
- Delete: `components/home/SeccionesProximamente.tsx`
- Modify: `app/(tabs)/index.tsx`, `components/home/TarjetasRefugio.tsx`, `app/(tabs)/perfil.tsx`
- Modify: `components/home/PiezasInicio.tsx` (quitar `PastillaProximamente` si queda sin uso)
- Modify: `PetHood_Back/docs/DEUDA_TECNICA.md` (cerrar el ítem 23, ex 21, en la parte de Campañas)

**Interfaces:**
- Produces: `CampaniasAdoptante({ onPress })`, `CampaniasRefugio({ altoMinimo, onPress })`.

- [ ] **Step 1: `components/home/CampaniasInicio.tsx`**

Mover el contenido de `SeccionesProximamente.tsx` y convertir cada bloque en `Pressable` (mismo patrón que `PerdidasInicio.tsx`), sin la pastilla «Muy pronto»:

```tsx
/**
 * Accesos de Inicio a las campañas (spec 026): el bloque naranja del adoptante lleva al portal
 * (GUI-13) y la tarjeta chica del refugio a «Mis Campañas» (GUI-36). Conservan el diseño que
 * tenían mientras el módulo no existía; sólo dejaron de decir «Muy pronto».
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';

import { PALETA } from '@/constants/theme';

export function CampaniasAdoptante({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Campañas de los refugios. Ver campañas"
      onPress={onPress}
      className="rounded-[30px] p-[18px] active:opacity-90"
      style={{ backgroundColor: PALETA.accent[600] }}
    >
      <Text className="font-cuerpo-bold text-[11px] tracking-[1.4px]" style={{ color: PALETA.accent[200] }}>
        CAMPAÑAS · TU AYUDA CUENTA
      </Text>

      <View className="mt-3.5 flex-row items-center gap-3.5">
        <View
          className="h-[84px] w-[84px] items-center justify-center rounded-[20px]"
          style={{ backgroundColor: PALETA.accent[700], borderWidth: 3, borderColor: PALETA.accent[400] }}
        >
          <Ionicons name="gift-outline" size={34} color={PALETA.accent[200]} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="font-titulo text-[18px] leading-[21px]" style={{ color: PALETA.accent[100] }}>
            Ayudá a los refugios
          </Text>
          <Text className="mt-1 font-cuerpo text-[12px] leading-[16px]" style={{ color: PALETA.accent[200] }}>
            Doná a sus campañas y mirá cuánto les falta para llegar a la meta.
          </Text>
        </View>
      </View>

      <View className="mt-3.5 flex-row items-center justify-between">
        <Text className="font-cuerpo-bold text-[13px]" style={{ color: PALETA.accent[100] }}>
          Ver campañas
        </Text>
        <Ionicons name="arrow-forward" size={16} color={PALETA.accent[100]} />
      </View>
    </Pressable>
  );
}

export function CampaniasRefugio({ altoMinimo, onPress }: { altoMinimo: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Mis campañas. Ver campañas"
      onPress={onPress}
      className="flex-1 justify-between gap-3 rounded-[26px] p-3.5 active:opacity-90"
      style={{ minHeight: altoMinimo, backgroundColor: PALETA.accent[600] }}
    >
      <View
        className="h-[62px] w-[62px] items-center justify-center rounded-full"
        style={{ borderWidth: 7, borderColor: PALETA.accent[700] }}
      >
        <Ionicons name="cash-outline" size={22} color={PALETA.accent[100]} />
      </View>
      <View>
        <Text className="font-titulo text-[15.5px] leading-[18px]" style={{ color: PALETA.accent[100] }}>
          Mis campañas
        </Text>
        <Text className="mt-[3px] font-cuerpo text-[12px] leading-[16px]" style={{ color: PALETA.accent[200] }}>
          Pedí donaciones y revisá las que te avisan.
        </Text>
        <Text className="mt-2 font-cuerpo-bold text-[12px]" style={{ color: PALETA.accent[100] }}>
          Ver campañas →
        </Text>
      </View>
    </Pressable>
  );
}
```

- [ ] **Step 2: Conectar**

- `app/(tabs)/index.tsx`: cambiar el import a `import { CampaniasAdoptante } from '@/components/home/CampaniasInicio';` y el uso a `<CampaniasAdoptante onPress={() => router.push('/campanias')} />`. Actualizar el comentario de cabecera (líneas 10-11) que dice que Campañas no tiene módulo.
- `components/home/TarjetasRefugio.tsx`: importar desde `./CampaniasInicio`, agregar `const router = useRouter();` (import de `expo-router`) y `<CampaniasRefugio altoMinimo={ALTO_MINIMO} onPress={() => router.push('/campanias/refugio')} />`. Actualizar el comentario de cabecera.
- `app/(tabs)/perfil.tsx`: `{ icono: 'heart-circle-outline', label: 'Campañas', ruta: '/campanias' as Href }` y `{ icono: 'heart-circle-outline', label: 'Campañas del refugio', ruta: '/campanias/refugio' as Href }`.
- Borrar `components/home/SeccionesProximamente.tsx`.
- `grep -rn "PastillaProximamente" apps/mobile --include=*.tsx`: si sólo queda su definición en `PiezasInicio.tsx`, borrarla (y su comentario).

- [ ] **Step 3: Deuda**

En `PetHood_Back/docs/DEUDA_TECNICA.md`, ítem 23 (ex 21, «Inicio muestra Campañas y Mascotas perdidas como "Muy pronto"…»): quitar la parte de Campañas. Si lo único que queda es «arma los contadores del refugio con cuatro pedidos», renombrar el ítem a eso; si ya no queda nada pendiente, tachar la fila como cerrada (`~~23~~ … ✅ cerrada`) y borrar su sección, según las reglas de la cabecera del archivo. Commitear ese cambio en la rama del backend.

- [ ] **Step 4: Verificar y commit**

```bash
npx tsc --noEmit
node --test --experimental-strip-types lib/*.test.ts
```

A mano: Inicio adoptante → bloque naranja → portal; Inicio refugio → «Mis campañas» → listado; Perfil → «Campañas» / «Campañas del refugio» según la vista.

```bash
git add -A apps/mobile
git commit -m "Inicio y Perfil llevan a Campañas (ya no dicen «Muy pronto»)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Cierre

- [ ] **Step 1: Verificación completa del backend**

```bash
cd PetHood_Back
npm test && npm run lint && npm run format:check && npm run build
```

Expected: todo en verde.

- [ ] **Step 2: Recorrido de punta a punta en la app** (criterios de aceptación de la spec §7, uno por uno, tildando cada uno en la spec).

- [ ] **Step 3: Spec 026 → IMPLEMENTADA** (estado en la cabecera y en `docs/specs/README.md`), commit en el backend.

- [ ] **Step 4:** Invocar `superpowers:finishing-a-development-branch` para decidir PRs (uno por repo, contra `dev`).
