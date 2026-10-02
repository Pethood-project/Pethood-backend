# Pedido de mobile al backend — perfiles públicos (persona y refugio)

**Estado:** implementada en [`docs/specs/023-perfiles-publicos.md`](../specs/023-perfiles-publicos.md). Dos diferencias con este pedido: el perfil de la persona **no** lista `refugios` (no exponer a su personal) y el feed pagina por offset, no por cursor. Se conserva como registro del pedido original.

## 1. Para qué

Hoy no hay forma de ver el perfil de otra persona ni de un refugio desde la app. Una pantalla de perfil público permitiría:

- Ver quién es la contraparte antes de adoptar o chatear: foto, zona, reputación y, en un refugio, descripción y mascotas en adopción.
- Dar un lugar natural al botón **Reportar** de personas y refugios (spec 008, tipos `USUARIO` y `REFUGIO`). Hoy solo se puede desde el chat.
- Cubrir GUI-26 «Perfil Público Refugio (con reseñas visibles)» del ROADMAP, que la spec 017 dejó fuera de alcance (§2).

## 2. Lo que ya existe y lo que falta

| Dato | Estado |
|---|---|
| Reseñas de una persona o refugio | **Existe:** `GET /resenas/usuario/:id` y `GET /resenas/refugio/:id` |
| Nombre, foto, tipo e id del contacto | **Existe** solo dentro del chat (`ContactoChat`) |
| Datos del refugio (provincia, localidad, calle, mapa) | **Existe** solo dentro de la ficha de publicación |
| Perfil del refugio propio | **Existe:** `GET /refugio/perfil`, solo para miembros con ámbito refugio |
| Perfil de otra persona | **Falta** |
| Perfil de un refugio visto por un adoptante | **Falta** |
| Publicaciones activas de un refugio o persona | **Falta** el filtro por publicador |
| `id` de la persona que publica | **Falta** en `publicadoPor` de la ficha |

## 3. Endpoints pedidos

Los dos son de **solo lectura, para cualquier sesión** (`autenticar`), sin `requiereRol`. Mismas convenciones de siempre: `/api/v1`, errores `{ error: { codigo, mensaje } }`, rutas de archivo relativas.

### `GET /usuarios/:id/perfil`

```json
{
  "id": 3,
  "nombre": "Ana",
  "apellido": "Pérez",
  "imagenUrl": null,
  "verificado": true,
  "provincia": "Mendoza",
  "localidad": "Godoy Cruz",
  "fechaAlta": "2026-03-02T…",
  "refugios": [{ "id": 1, "nombre": "Patitas" }],
  "esPropio": false
}
```

- **Privacidad:** no devuelve email, teléfono, DNI, calle ni coordenadas. Solo zona general (localidad y provincia).
- `refugios` es opcional: solo si se quiere mostrar que la persona pertenece a un refugio. Si genera dudas de privacidad, se omite.
- `esPropio` permite ocultar el botón Reportar sin que el cliente compare ids.
- Una persona dada de baja o suspendida devuelve `404 NO_ENCONTRADO`, igual que el resto de los objetos reportables, o `activo: false` si se prefiere seguir mostrando su historial. Decisión del equipo.

### `GET /refugios/:id`

```json
{
  "id": 1,
  "nombre": "Patitas",
  "descripcion": "…",
  "imagenUrl": null,
  "verificado": true,
  "provincia": "Mendoza",
  "localidad": "Godoy Cruz",
  "calleAltura": "San Martín 123",
  "mapaUrl": "https://maps…",
  "fechaAlta": "2026-01-10T…",
  "resumen": { "publicacionesActivas": 8, "resenas": { "promedio": 4.5, "cantidad": 12 } },
  "esMiembro": false
}
```

- Mismos datos que ya se ven en la ficha de publicación más la descripción. Teléfono y email quedan **fuera** salvo que el equipo decida lo contrario (hoy el contacto es por chat).
- Un refugio no verificado o suspendido no se muestra: `404 NO_ENCONTRADO`.
- `esMiembro` oculta Reportar a los miembros del propio refugio (spec 008, regla 3).

## 4. Publicaciones del perfil

Dos opciones, de menor a mayor costo:

1. **Reusar el feed** (`GET /publicaciones`) con filtros nuevos `refugioId` y `usuarioId`, paginados por cursor como el resto del feed (spec 020).
2. Endpoint propio `GET /refugios/:id/publicaciones` y `GET /usuarios/:id/publicaciones`.

Recomiendo la 1: no duplica la tarjeta ni la paginación y mobile ya consume el feed. Solo publicaciones **activas** y solo las visibles para el perfil que consulta (respetando `X-Ambito`).

## 5. Cambio menor en la ficha de publicación

`publicadoPor` hoy es `{ nombre, apellido }`. Agregar `id` para poder navegar al perfil de la persona que publica:

```json
"publicadoPor": { "id": 3, "nombre": "Ana", "apellido": "Pérez", "imagenUrl": null }
```

`refugio.id` ya viene, así que ese caso no necesita cambios.

## 6. Qué haría mobile con esto

Una pantalla `app/perfiles/usuario/[id].tsx` y otra `app/perfiles/refugio/[id].tsx` (GUI-26), con:

- Cabecera: foto, nombre, insignia de verificado, zona.
- Reputación: reutiliza `ResumenReputacion` (ya existe).
- Refugio: descripción, botón «Ver en Google Maps» y lista de mascotas en adopción.
- Botón **Reportar** (`BotonReportar`, tipos `USUARIO` y `REFUGIO`), oculto con `esPropio` o `esMiembro`.
- Entradas: tocar «Publicado por» en la ficha, y el avatar en la cabecera del chat.

## 7. Preguntas abiertas

1. ¿Qué datos de una persona son públicos? La propuesta es el mínimo de §3.
2. ¿El perfil de un refugio muestra teléfono y email o todo va por chat?
3. ¿Una cuenta suspendida o dada de baja es `404` o se muestra marcada?
4. ¿Esto es una spec nueva o una ampliación de la 017? Tocaría también `docs/MODELO_DATOS.md` solo si se agrega algún campo (por ahora no hace falta).
