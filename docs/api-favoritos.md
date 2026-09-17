# Contrato de API — Favoritos

Endpoints de **HU-7.2 (Guardar mascota en favoritos)** y **HU-6.6 (Visualizar mascotas agregadas a favoritos)**, listos para consumir desde `pethood-frontend`. Los tres están implementados y testeados.

> Este documento describe **solo lo que el backend expone**. Los textos de UI y las reglas de la pantalla salen de `REQUISITOS.md`.

La pantalla que los consume es **GUI-12 (Favoritos)**. El alta la dispara el swipe a la derecha de **HU-6.5 (feed)**, que todavía no está implementado — ver "Pendiente para otros módulos".

---

## Convenciones comunes

**Base URL:** `{EXPO_PUBLIC_API_URL}/api/v1` — en mobile la variable ya existe en `apps/mobile/.env`.

**Autenticación:** los tres endpoints la exigen.

```
Authorization: Bearer <token>
```

**Formato de error** — siempre el mismo, en cualquier código de estado:

```json
{ "error": { "codigo": "MASCOTA_PROPIA", "mensaje": "No podés guardar en favoritos una mascota tuya" } }
```

El campo `mensaje` viene en español con voseo rioplatense y **se puede mostrar tal cual en el toast**, sin reescribirlo en el cliente.

**Imágenes:** `imagenUrl` es una ruta relativa (`/api/v1/archivos/mascotas/xxx.png`). Hay que anteponerle el host del backend para renderizarla.

**Errores de autenticación comunes a los tres endpoints:**

| HTTP | `codigo` | `mensaje` | Cuándo |
|---|---|---|---|
| 401 | `NO_AUTENTICADO` | Falta el token de autenticación | No se mandó el header |
| 401 | `NO_AUTENTICADO` | Token inválido o expirado | Token vencido o corrupto |

---

## `POST /api/v1/favoritos` — Guardar (HU-7.2)

### Headers

```
Authorization: Bearer <token>
Content-Type: application/json
```

### Body

| Campo | Tipo | Reglas |
|---|---|---|
| `mascotaId` | entero > 0 | Obligatorio |

```json
{ "mascotaId": 42 }
```

### Reglas que aplica el backend

1. La mascota tiene que existir y no estar dada de baja.
2. **No podés guardar una mascota tuya.** Propiedad = quien creó el registro, igual que en HU-6.2/6.3.
3. La mascota tiene que tener una **publicación activa** — solo se guardan mascotas ofrecidas en adopción.

### Respuesta — 201 o 200

```json
{ "id": 12, "mascotaId": 42, "fechaAgregado": "2026-08-20T15:04:05.000Z" }
```

| HTTP | Cuándo |
|---|---|
| `201 Created` | Se guardó recién |
| `200 OK` | Ya estaba guardada |

**El endpoint es idempotente:** mandarlo dos veces con la misma mascota **no es un error**. Los dos códigos traen el mismo body y significan lo mismo para la UI ("está guardada"). El `201` vs `200` sirve solo si querés distinguir para métricas o analytics — para pintar el corazón lleno, tratalos igual.

Esto es a propósito: el swipe hace updates optimistas y reintenta ante un error de red. Un `409` obligaría al cliente a manejar como error algo que ya es el resultado que quería.

### Errores

| HTTP | `codigo` | `mensaje` |
|---|---|---|
| 400 | `VALIDACION` | El id de la mascota es obligatorio |
| 400 | `VALIDACION` | El id de la mascota no es válido |
| 403 | `MASCOTA_PROPIA` | No podés guardar en favoritos una mascota tuya |
| 404 | `NO_ENCONTRADO` | La mascota no existe |
| 409 | `SIN_PUBLICACION` | Esa mascota no está publicada en adopción |

---

## `DELETE /api/v1/favoritos/:mascotaId` — Quitar

Ojo: el parámetro es el **id de la mascota**, no el id del favorito. El swipe y la grilla conocen la mascota; obligarlos a un GET previo solo para averiguar el id del favorito sería un round-trip de más.

### Headers

```
Authorization: Bearer <token>
```

### Respuesta — 204 No Content

Sin body.

**También es idempotente:** quitar algo que no está guardado devuelve `204`, no `404`. El estado final que pide el cliente ya se cumple.

Un favorito de otro usuario es indistinguible de uno inexistente: también da `204`, sin dar de baja nada. No se puede borrar ni sondear la existencia del favorito ajeno.

### Errores

| HTTP | `codigo` | `mensaje` |
|---|---|---|
| 400 | `VALIDACION` | El id de la mascota no es válido |

---

## `GET /api/v1/favoritos` — Listar (HU-6.6)

Sin query params. Devuelve la lista completa: **no pagina** (ver "Decisiones").

### Headers

```
Authorization: Bearer <token>
```

### Respuesta 200

```json
{
  "total": 2,
  "favoritos": [
    {
      "id": 42,
      "nombre": "Fido",
      "fechaNacimiento": "2022-03-15",
      "imagenUrl": "/api/v1/archivos/mascotas/x.jpg",
      "especie": { "id": 1, "nombre": "Perro" },
      "raza": { "id": 2, "nombre": "Labrador" },
      "estado": { "id": 1, "nombre": "Disponible" },
      "publicacionId": 88,
      "solicitudAbiertaId": null,
      "fechaAgregado": "2026-08-19T15:00:00.000Z"
    },
    {
      "id": 43,
      "nombre": "Luna",
      "fechaNacimiento": "2021-11-02",
      "imagenUrl": "/api/v1/archivos/mascotas/y.jpg",
      "especie": { "id": 1, "nombre": "Perro" },
      "raza": { "id": 7, "nombre": "Mestizo" },
      "estado": { "id": 5, "nombre": "En_Transito" },
      "publicacionId": 91,
      "solicitudAbiertaId": 1042,
      "fechaAgregado": "2026-08-01T09:00:00.000Z"
    }
  ]
}
```

| Campo | Qué es |
|---|---|
| `total` | Contador del header ("2 animales guardados") |
| `id` | **Id de la MASCOTA**, no del favorito. Es el que va en el `DELETE` y en la navegación a la ficha |
| `fechaNacimiento` | `AAAA-MM-DD` o `null`. **La edad se calcula en el cliente** con `edadEnTexto`, igual que en el resto del proyecto |
| `estado` | Estado **actual** de la mascota, para el badge |
| `publicacionId` | Publicación activa de la mascota, o `null` si ya no está publicada. Es lo que habilita el botón "Solicitar" de la tarjeta (HU-7.1) |
| `solicitudAbiertaId` | Solicitud viva **de este usuario** sobre esa publicación, o `null`. Con valor, la tarjeta muestra "Enviada" en lugar del botón |
| `fechaAgregado` | ISO 8601. Define el orden |

### Garantías del listado

- **Orden:** por `fechaAgregado` descendente (más reciente primero). Es el orden por defecto que pide HU-6.6.
- **Excluye mascotas dadas de baja** (`mascota.fechaBaja IS NULL`).
- **Incluye mascotas en cualquier estado**, no solo `Disponible`. Una mascota que cambia de estado **sigue en la lista** con el badge actualizado.
- `total` **siempre coincide con `favoritos.length`**: sale de la misma lista ya filtrada, así el contador no puede discrepar de la grilla.

### Errores

Solo los de autenticación. Un usuario sin favoritos recibe `200` con `{ "total": 0, "favoritos": [] }` — no es un error.

---

## Notas para la pantalla de favoritos (GUI-12)

1. **El contador del header sale de `total`.** Al quitar un favorito podés restarle 1 localmente para el feedback inmediato, pero refrescá con la respuesta del `GET` para no acumular desfasajes.
2. **Update optimista seguro.** Como el `POST` y el `DELETE` son idempotentes, podés pintar el cambio antes de que responda el servidor y reintentar sin miedo a duplicar ni a romper.
3. **El badge usa `estado.nombre`.** Ya existe `EstadoMascotaBadge` en el front — los nombres vienen con guión bajo (`En_Transito`), igual que en el resto de la API.
4. **Confirmación antes de quitar** si el gesto no es reversible en la propia pantalla (regla transversal 6 de `CLAUDE.md`). Si el usuario lo hace con un tap sobre el corazón y puede volver a tocarlo, no hace falta modal.
5. **Estados de la pantalla:** cargando / vacío / error. El vacío es `total: 0`, no un error.

---

## Decisiones tomadas y por qué

| Decisión | Motivo |
|---|---|
| **Baja lógica, no física** | Regla 1 de `CLAUDE.md`. Además el modelo `Favorito` ya venía con `usuarioBaja`/`fechaBaja` desde el schema inicial: usar DELETE físico contradiría el esquema vigente. |
| **`POST` y `DELETE` idempotentes** | El swipe de HU-6.5 hace updates optimistas y reintenta. El cliente declara un estado final, no pide una transición; devolver 409/404 lo obligaría a tratar como error el resultado que quería. |
| **Índice único PARCIAL en base** | `UNIQUE (usuario_id, mascota_id) WHERE fecha_baja IS NULL`. Garantiza un solo favorito activo por par. Parcial y no único plano porque con baja lógica un único total impediría volver a guardar algo que quitaste. Va en la base y no en el servicio porque dos POST concurrentes pasarían los dos por cualquier chequeo de lectura previo. |
| **Cada ciclo deja su propia fila** | Al volver a guardar no se reactiva la fila vieja: se inserta una nueva. Así queda el historial completo de guardado/quitado. |
| **El `DELETE` va por `mascotaId`** | Es el id que tienen el swipe y la grilla. Por `favoritoId` obligaría a un GET previo. |
| **No pagina** | Ningún listado del proyecto pagina (`GET /mascotas/mias` tampoco) y los favoritos están acotados por naturaleza. `total` viaja igual como campo aparte para que agregar paginación no cambie la forma del contrato. |
| **La edad no viene calculada** | El backend devuelve `fechaNacimiento` y el cliente la formatea, igual que en HU-6.1/6.2/6.4. Evita duplicar la lógica de formato y que el texto quede stale en caché. |
| **Publicación activa se exige al guardar, no al listar** | Solo se guardan mascotas ofrecidas en adopción, pero si después la publicación se da de baja el favorito **sigue visible** con el badge actualizado: HU-6.6 dice que una mascota que cambia de estado sigue en la lista. |
| **No se escribe en `logAuditoria`** | Un favorito se toca en cada swipe y el log es un archivo append-only para operaciones críticas. Las columnas de auditoría de la tabla ya registran quién y cuándo. |
| **Una mascota sin estado vigente se omite** | Es un dato inconsistente, no un caso de negocio. Se saca de la grilla en vez de romper la pantalla entera, y el `total` la descuenta. |
| **El contador del perfil usa el mismo filtro** | `GET /usuarios/me` devuelve `favoritos`, y ahora cuenta con `mascota: { fechaBaja: null }` igual que este listado. Antes solo miraba `favorito.fechaBaja`, así que al eliminarse una mascota guardada el perfil decía "5" y GUI-12 mostraba 4. |

### Resuelto de lo que dejó pendiente HU-6.3

El contrato de HU-6.3 anotó que al dar de baja una mascota quedan registros de `Favorito` apuntándole. **Queda resuelto:** el listado filtra por `mascota.fechaBaja IS NULL`.

Se filtra al consultar y **no** se cascadea la baja a los favoritos. Cascadear obligaría a escribir en los favoritos de *todos* los usuarios dentro de la transacción de baja de la mascota, sin cota: un adoptante no debería poder disparar cientos de escrituras al eliminar su mascota.

### Pendiente para otros módulos

**HU-6.5 (feed de swipe)** — cuando se implemente, la query del feed tiene que **excluir las mascotas que el usuario ya tiene guardadas**:

```sql
AND NOT EXISTS (
  SELECT 1 FROM favorito f
  WHERE f.mascota_id = mascota.mascota_id
    AND f.usuario_id = :usuarioId
    AND f.favorito_fecha_baja IS NULL
)
```

Se resuelve en la query del feed y **no** con un endpoint que devuelva los ids: el feed se consulta constantemente, un endpoint aparte sumaría un round-trip por refresco, quedaría stale apenas el usuario guarda algo y crecería sin cota. El índice `favorito_usuario_id_mascota_id_idx` ya cubre ese `NOT EXISTS`.

**Decisión de producto ya tomada:** el filtro es solo por `fecha_baja IS NULL`, o sea que **una mascota que el usuario quitó de favoritos VUELVE a aparecer en la pila de swipe**. Un favorito es un "guardar para después", no un "descartar": no existe pantalla de descartados donde recuperar un swipe accidental, y modelar el descarte pediría otra entidad que no está en `MODELO_DATOS.md`.

**Contador de favoritos en otras pantallas** — si alguna vista necesita solo el número, hoy tiene que traer el `GET` completo. Cuando aparezca ese caso conviene un `HEAD` o un campo en el perfil, no un endpoint nuevo.
