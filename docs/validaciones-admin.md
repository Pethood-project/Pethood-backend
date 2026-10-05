# Validaciones de los datos que envía el panel admin

Reglas de cada campo que viaja desde `web-admin`. El **backend es la fuente de verdad**: el cliente valida solo para UX y tiene que aplicar las mismas reglas y mostrar el mismo mensaje. Si un número cambia, cambia en `src/shared/validation/limits.ts` y acá.

Convenciones (aplican a todo):
- Todo texto se **recorta** (`trim`) antes de validar: `"  Rex "` → `"Rex"`. Un texto de solo espacios cuenta como vacío.
- Un texto opcional vacío se guarda como `null`.
- Los ids son enteros positivos.
- Error de validación → `400 { error: { codigo: "VALIDACION", mensaje } }`. Se devuelve **el primer** error, no la lista.
- Las longitudes se cuentan en caracteres, después del `trim`.

## Tipos comunes

| Tipo | Regla | Mensaje |
| --- | --- | --- |
| Email | Con `@` y dominio con punto (`a@b.com`). Se guarda en **minúsculas**. Sin espacios. | `El correo no es válido. Asegurate de incluir el "@" y un dominio correcto.` |
| Teléfono | Dígitos con `+` inicial opcional; se ignoran espacios, guiones y paréntesis. Entre **8 y 15 dígitos**. Se guarda normalizado (`+54 261 555-1234` → `+542615551234`). | vacío: `El teléfono es obligatorio. Completalo para poder continuar.` · inválido: `Ingresá un teléfono válido.` |
| Id | Entero > 0. | `<Etiqueta> es obligatorio/a` si falta, `<Etiqueta> no es válido/a` si no es entero positivo |
| Texto con rango | Entre `min` y `max` caracteres. Si `min ≤ 1`, el mensaje de longitud es solo el máximo. | `<Etiqueta> debe tener entre <min> y <max> caracteres` · `<Etiqueta> no puede superar los <max> caracteres` |
| Texto obligatorio con `min = 1` y vacío | — | `<Etiqueta> es obligatorio/a` |

Regex de email para el cliente (más estricta que nada, más laxa que el backend en casos raros; si pasa acá y el backend la rechaza, mostrá el mensaje del backend):

```ts
/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/
```

Regex de teléfono para el cliente: después de quitar todo lo que no sea dígito, `/^\d{8,15}$/`, y si empieza con `+` solo permitir ese `+` al inicio.

## Alta de refugio — `POST /admin/refugios`

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| `nombre` | sí | Texto 2–100 |
| `direccion` | sí | Texto 2–150 |
| `telefono` | no | Teléfono (ver arriba) |
| `email` | no | Email (ver arriba) |
| `descripcion` | no | Texto ≤ 1000 |

## Acciones con motivo — `suspender`, `baja` de usuarios/refugios/publicaciones/mascotas, `estado` de publicaciones

| Campo | Obligatorio | Regla |
| --- | --- | --- |
| `motivo` | sí | Texto 1–500. Vacío: `El motivo es obligatorio`. Largo: `El motivo no puede superar los 500 caracteres` |

`PATCH /admin/publicaciones/:id/estado` suma `accion`: uno de `PAUSAR`, `REACTIVAR`, `FINALIZAR`.

## Roles — `PATCH /admin/usuarios/:id/roles`

| Campo | Regla |
| --- | --- |
| `agregar`, `quitar` | Listas con valores `ADOPTANTE`, `MIEMBRO_REFUGIO`, `ADMIN` (exactos, en mayúsculas; los de `ROL_API`). Default `[]`. |
| `refugioId` | Id. **Obligatorio si `agregar` incluye el rol de refugio.** |

Reglas cruzadas (mensajes exactos):
- Al menos un rol en `agregar` o `quitar`: `Indicá al menos un rol para agregar o quitar.`
- Un rol no puede estar en las dos listas: `Un rol no puede agregarse y quitarse a la vez.`
- Agregar el rol de refugio sin `refugioId`: `Para agregar el rol de refugio indicá a qué refugio pertenece.`

## Catálogos — `POST` / `PUT /admin/catalogos/:catalogo`

| Campo | Catálogos | Regla |
| --- | --- | --- |
| `nombre` | especies, razas | Texto obligatorio 2–50 |
| `descripcion` | especies, estados-\*, tipos-solicitud | Opcional, ≤ 200 |
| `especieId` | razas (solo alta) | Id de una especie **activa** |
| `secuenciaDias` | tipos-solicitud | Entero 1–365. Mensaje: `La secuencia debe estar entre 1 y 365` |

Nombre duplicado (sin distinguir mayúsculas; en razas, dentro de la misma especie): `409 CATALOGO_DUPLICADO` o `CATALOGO_DUPLICADO_DE_BAJA`. Ver `api-admin-catalogos.md`.

## Soporte — FAQs y categorías

| Campo | Regla |
| --- | --- |
| Categoría `nombre` | Texto obligatorio 2–50 |
| Categoría `descripcion` | Opcional, ≤ 200 |
| FAQ `pregunta` | Texto obligatorio 5–200 |
| FAQ `respuesta` | Texto obligatorio 5–2000 |
| FAQ `orden` | Entero 1–999 (`El orden debe estar entre 1 y 999`) |
| FAQ `faqCategoriaId` | Id de categoría |
| `PATCH` (categoría o FAQ) | Los mismos campos, todos opcionales, pero **al menos uno**: `Indicá al menos un campo para modificar.` |

## Query strings de los listados

| Parámetro | Regla |
| --- | --- |
| `page` | Entero ≥ 1 (default 1). `La página no es válida` |
| `limit` | Entero 1–50 (default 20) |
| `estados` | Ids separados por coma (`1,3`). Un elemento inválido rechaza **toda** la lista; se descartan repetidos |
| `refugioId`, `usuarioId`, `solicitanteId`, `especieId` | Entero > 0 |
| `incluirBajas`, `verificado`, `resuelta` | Solo `true` o `false` |
| `q` | Texto; vacío o solo espacios se ignora |
| `desde`, `hasta` | Fecha ISO (`2026-09-30`). Se filtra por fecha de alta; `hasta` incluye todo ese día. `La fecha no es válida` |

## Qué no valida el cliente

El backend además rechaza por reglas de negocio (no por formato), y la UI tiene que mostrar el mensaje que llega en `error.mensaje`: transiciones de estado inválidas, bajas de valores en uso, mascota con adopción en curso, cuenta admin que no se puede suspender, etc.
