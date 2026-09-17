# Contrato de API — Editar y eliminar mascota

Endpoints de **HU-6.2 (Editar mascota)** y **HU-6.3 (Eliminar mascota)**, listos para consumir desde `pethood-frontend`. Ambos ya están implementados, testeados y verificados contra el servidor real.

> Este documento describe **solo lo que el backend expone**. Las reglas de habilitación de botones y textos de UI salen de `REQUISITOS.md` sección 7.

---

## Convenciones comunes

**Base URL:** `{EXPO_PUBLIC_API_URL}/api/v1` — en mobile la variable ya existe en `apps/mobile/.env`.

**Autenticación:** los dos endpoints la exigen.

```
Authorization: Bearer <token>
```

**Formato de error** — siempre el mismo, en cualquier código de estado:

```json
{ "error": { "codigo": "NO_AUTORIZADO", "mensaje": "Esa mascota no es tuya" } }
```

El campo `mensaje` viene en español con voseo rioplatense y **se puede mostrar tal cual en el toast**, sin reescribirlo en el cliente.

**Imágenes:** `imagenUrl` es una ruta relativa (`/api/v1/archivos/mascotas/xxx.png`). Hay que anteponerle el host del backend para renderizarla.

**Errores de autenticación comunes a ambos endpoints:**

| HTTP | `codigo` | `mensaje` | Cuándo |
|---|---|---|---|
| 401 | `NO_AUTENTICADO` | Falta el token de autenticación | No se mandó el header |
| 401 | `NO_AUTENTICADO` | Token inválido o expirado | Token vencido o corrupto |

---

## `PATCH /api/v1/mascotas/:id` — Editar (HU-6.2)

Edición **parcial**: se manda solo lo que cambió. Todo campo ausente se deja como está.

### Headers

```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

Es `multipart` incluso si no se manda foto, porque el endpoint comparte el pipeline de subida con el alta.

### Body — todos los campos son opcionales

| Campo | Tipo | Reglas |
|---|---|---|
| `nombre` | texto | 2 a 25 caracteres (se le hace trim) |
| `fechaNacimiento` | `AAAA-MM-DD` | No futura, no anterior a 1900 |
| `genero` | enum | `MACHO` \| `HEMBRA` |
| `peso` | decimal | 0.1 a 999.9, un decimal. Acepta coma o punto (`12,5`) |
| `tamanio` | enum | `PEQUENO` \| `MEDIANO` \| `GRANDE` |
| `especieId` | entero > 0 | Solo junto con `razaId` |
| `razaId` | entero > 0 | Solo junto con `especieId`; la raza debe pertenecer a esa especie |
| `castrado` | `'true'` \| `'false'` | **Si no se manda, no se modifica** |
| `descripcion` | texto | Máx. 2000. Mandar `''` **borra** la descripción |
| `foto` | archivo | jpg / png / webp, ≤5 MB. Reemplaza la actual |

### Reglas que aplica el backend

- **Hay que mandar al menos un campo o una foto.** Un `PATCH` vacío devuelve 400.
- **`especieId` y `razaId` viajan juntos o no viajan.** Mandar uno solo devuelve 400: la raza únicamente se puede validar contra su especie.
- **El estado de la mascota NO se edita acá.** La pantalla de edición no debe ofrecerlo — ver *Decisiones* al final.
- **Distinción importante:** campo ausente = "no lo toques"; `descripcion: ''` = "limpialo". No son lo mismo.

### Respuesta 200 — la mascota ya actualizada

```json
{
  "id": 2,
  "nombre": "Renombrada",
  "fechaNacimiento": "2022-03-15",
  "genero": "HEMBRA",
  "peso": 9.3,
  "tamanio": "PEQUENO",
  "castrado": true,
  "descripcion": null,
  "imagenUrl": "/api/v1/archivos/mascotas/8f9e7267-....png",
  "especie": { "id": 1, "nombre": "Perro" },
  "raza": { "id": 4, "nombre": "Bulldog" },
  "estado": { "id": 3, "nombre": "Adoptado" },
  "refugioId": null,
  "usuarioId": 2,
  "habilitaPublicacion": false
}
```

Es exactamente la misma forma que devuelven `POST /mascotas` y `GET /mascotas/mias`, así que se puede reusar el mismo tipo y el mismo mapper.

### Errores

| HTTP | `codigo` | `mensaje` |
|---|---|---|
| 400 | `VALIDACION` | El id de la mascota no es válido |
| 400 | `VALIDACION` | No enviaste ningún cambio |
| 400 | `VALIDACION` | Para cambiar la raza tenés que indicar también la especie |
| 400 | `VALIDACION` | El nombre debe tener entre 2 y 25 caracteres |
| 400 | `VALIDACION` | La fecha de nacimiento no puede ser futura |
| 400 | `VALIDACION` | El sexo no es válido |
| 400 | `VALIDACION` | El tamaño no es válido |
| 400 | `VALIDACION` | El peso debe ser un número con hasta 1 decimal (ej. 12,5) |
| 400 | `VALIDACION` | El peso debe estar entre 0.1 y 999.9 |
| 400 | `VALIDACION` | La descripción no puede superar los 2000 caracteres |
| 400 | `VALIDACION` | La raza no corresponde a la especie elegida |
| 403 | `NO_AUTORIZADO` | Esa mascota no es tuya |
| 404 | `NO_ENCONTRADO` | La mascota no existe |
| 404 | `NO_ENCONTRADO` | La raza no existe |

> El body se valida **antes** de buscar la mascota. Un `PATCH` con datos inválidos sobre un id inexistente devuelve 400, no 404.

---

## `DELETE /api/v1/mascotas/:id` — Eliminar (HU-6.3)

Baja **lógica**. La fila nunca se borra físicamente: se le completan `usuario_baja` y `fecha_baja`, y deja de aparecer en los listados.

### Headers

```
Authorization: Bearer <token>
```

Sin body.

### Respuesta 200

```json
{ "id": 4, "publicacionesDadasDeBaja": 1 }
```

`publicacionesDadasDeBaja` sirve para ajustar el mensaje de confirmación: si es mayor a 0, conviene avisar que también se retiró la publicación en adopción.

### Errores

| HTTP | `codigo` | `mensaje` |
|---|---|---|
| 400 | `VALIDACION` | El id de la mascota no es válido |
| 403 | `NO_AUTORIZADO` | Esa mascota no es tuya |
| 404 | `NO_ENCONTRADO` | La mascota no existe |
| 409 | `SOLICITUDES_ABIERTAS` | Esa mascota tiene solicitudes de adopción sin responder. Resolvelas antes de eliminarla |

El **409 es el caso interesante para la UI**: no es un error del usuario, es un bloqueo con salida. Conviene ofrecerle ir a la pantalla de solicitudes en vez de mostrar solo un toast rojo.

Eliminar dos veces la misma mascota devuelve 404 la segunda vez: una vez dada de baja, deja de existir para la API.

---

## Notas para la pantalla de edición

1. **Precargá el formulario** con `GET /mascotas/mias` (ya existe) y mandá en el `PATCH` únicamente los campos que el usuario tocó. Mandar el formulario entero también funciona, pero pierde la ventaja de la edición parcial.
2. **Ojo con `castrado`.** Es el único campo donde "no mandarlo" y "mandarlo en `false`" dan resultados distintos. Si el switch está en pantalla y el usuario puede cambiarlo, mandalo siempre.
3. **No pongas el selector de estado** en esta pantalla: el backend lo ignora.
4. **Validá en el cliente solo para UX.** Los límites de arriba están duplicados en `apps/mobile/shared/validation/limits.ts` — si cambia uno, cambian los dos en el mismo PR.
5. **Confirmación obligatoria antes del `DELETE`** (regla transversal 6 de CLAUDE.md: modal de confirmación en acciones críticas).

---

## Decisiones tomadas y por qué

| Decisión | Motivo |
|---|---|
| **PATCH y no PUT** | La foto es opcional en la edición. Con `PUT`, "no mandé foto" significaría "borrá la foto", que no es lo que hace la pantalla. |
| **Baja lógica, no física** | `REQUISITOS.md` §6 dice literalmente "HU-6.3 Eliminar mascota (baja lógica)" y la regla 1 de `CLAUDE.md` prohíbe el DELETE físico. |
| **La baja arrastra la publicación activa** | El texto de HU-6.3 pide retirar "su información **y publicación**". Se hace en una sola transacción. |
| **El estado no se edita** | HU-6.2 habla del *perfil*. No hay reglas de transición documentadas y inventarlas contradice `CLAUDE.md`. Queda como HU aparte. |
| **409 si hay solicitudes abiertas** | Cancelarle el trámite a otro usuario en silencio es peor que pedirle al dueño que lo resuelva. El módulo de notificaciones todavía no existe. |
| **Propiedad = quien creó el registro** | Igual que en `publicaciones.service.ts`. Un compañero del mismo refugio **no** puede editar la mascota que cargó otro. Si el equipo quiere permitirlo, es un cambio de una línea. |

### Pendiente para otros módulos

Al dar de baja una mascota, quedan apuntándole registros de `Favorito` y `AnimalPerdido`. Esos módulos todavía no existen; cuando se implementen **tienen que filtrar por `mascota.fechaBaja IS NULL`** o van a mostrar mascotas eliminadas. `HistoriaClinica` se deja intacta a propósito: es inmutable por regla de negocio.
