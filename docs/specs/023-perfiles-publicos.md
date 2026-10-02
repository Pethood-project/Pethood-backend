# Spec 023 — Perfiles públicos (persona y refugio)

**Estado:** IMPLEMENTADA
**Sprint:** 13 · **Responsable:** equipo PetHood · **Última actualización:** 2026-10-01

## 1. Objetivo

Que un usuario pueda ver el perfil público de otra persona y de un refugio antes de adoptar o chatear, y que la app tenga un lugar natural para el botón **Reportar** de personas y refugios (spec 008, tipos `USUARIO` y `REFUGIO`). Cubre GUI-26 «Perfil Público Refugio (con reseñas visibles)», que la spec 017 dejó fuera. Nace del pedido de mobile en `docs/ideas/USER.md`.

## 2. Alcance

- **Incluye:** `GET /usuarios/:id/perfil`; `GET /refugios/:id`; filtros `refugioId` y `usuarioId` en el feed de publicaciones; `publicadoPor.id` (y `imagenUrl`) en la ficha de publicación.
- **NO incluye:** teléfono ni email de personas o refugios (el contacto es por chat); mapa interactivo; editar el perfil (spec 001 y 017); que un refugio vea perfiles desde su propio ámbito (el feed sigue siendo del perfil personal).

## 3. Entidades involucradas

Sin cambios de modelo: se leen `Usuario`, `Refugio`, `Publicacion` y `Resena`.

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/v1/usuarios/:id/perfil` | cualquier sesión | Perfil público de una persona |
| GET | `/api/v1/refugios/:id` | cualquier sesión | Perfil público de un refugio |
| GET | `/api/v1/publicaciones?refugioId=&usuarioId=` | perfil personal | Filtros nuevos del feed |

**`GET /usuarios/:id/perfil`:**

```json
{
  "id": 3, "nombre": "Ana", "apellido": "Pérez", "imagenUrl": null, "verificado": true,
  "provincia": "Mendoza", "localidad": "Godoy Cruz", "fechaAlta": "2026-03-02T…",
  "esPropio": false
}
```

**`GET /refugios/:id`:**

```json
{
  "id": 1, "nombre": "Patitas", "descripcion": "…", "imagenUrl": null, "verificado": true,
  "provincia": "Mendoza", "localidad": "Godoy Cruz", "calleAltura": "San Martín 123",
  "mapaUrl": "https://maps…", "fechaAlta": "2026-01-10T…",
  "resumen": { "publicacionesActivas": 8, "resenas": { "promedio": 4.5, "cantidad": 12 } },
  "esMiembro": false
}
```

**Feed:** `refugioId` trae las publicaciones activas de las mascotas de ese refugio; `usuarioId` las que esa persona publicó **a título personal** (las de su refugio no cuentan). Paginan como el resto del feed (`limite` + `desplazamiento`, `total`).

**Ficha de publicación:** `publicadoPor` pasa de `{ nombre, apellido }` a `{ id, nombre, apellido, imagenUrl }`.

**Errores:** `NO_ENCONTRADO` (404), `VALIDACION` (400, id inválido).

## 5. Pantallas (frontend)

Fuera de esta spec de backend. Mobile: `perfiles/usuario/[id]` y `perfiles/refugio/[id]` (GUI-26), reutilizando `ResumenReputacion` y el feed filtrado. El botón Reportar se oculta con `esPropio` o `esMiembro`.

## 6. Reglas de negocio y validaciones

1. **Privacidad de la persona:** solo nombre, foto, verificado y zona general (localidad y provincia). Nunca email, teléfono, DNI, calle ni coordenadas. Backend.
2. **Una persona no se asocia a su refugio:** el perfil no lista refugios. La ficha de publicación ya oculta al personal de un refugio (`publicadoPor` es `null` en una publicación de refugio) y el perfil público no puede ser un camino para saltarse eso.
3. Una persona dada de baja, suspendida o inactiva, y el usuario SISTEMA, responden `404`. Backend.
4. Un refugio dado de baja o que no esté `Activo` (pendiente de verificación, suspendido, inactivo) responde `404`. Backend.
5. El refugio muestra los mismos datos que ya expone la ficha de publicación más la descripción. Teléfono y email quedan fuera. Backend.
6. `esPropio` y `esMiembro` los calcula el backend, para que el cliente no compare ids. Backend.
7. Solo se listan publicaciones **activas**, con las mismas reglas del feed. Backend.

## 7. Criterios de aceptación

- [ ] Cualquier sesión ve el perfil de otra persona con nombre, foto, verificado y zona, y sin datos de contacto.
- [ ] Una persona suspendida, dada de baja o el usuario SISTEMA dan 404.
- [ ] Cualquier sesión ve un refugio activo con descripción, ubicación, publicaciones activas y reputación.
- [ ] Un refugio suspendido, pendiente o dado de baja da 404.
- [ ] `esPropio` es `true` en el perfil propio y `esMiembro` en el propio refugio.
- [ ] `GET /publicaciones?refugioId=` y `?usuarioId=` devuelven solo lo de ese publicador.
- [ ] `publicadoPor` trae `id` e `imagenUrl` en una publicación personal, y sigue siendo `null` en una de refugio.

## 8. Casos borde y errores

- Un `id` no numérico responde 400.
- `usuarioId` de una persona que solo publica a través de su refugio: lista vacía.
- Las mascotas que el usuario ya guardó en favoritos no aparecen en el feed filtrado (el feed las excluye siempre). Ver §9.

## 9. Notas y decisiones

- Las preguntas abiertas de `USER.md` se resolvieron con sus propias recomendaciones, y son revertibles: datos públicos mínimos (§6.1), sin teléfono ni email del refugio (§6.5), cuenta suspendida o dada de baja = 404 (§6.3, §6.4). Decisión por defecto, 2026-10-01.
- **Se omitió `refugios` del perfil de la persona** (el pedido lo dejaba opcional) por la razón de §6.2.
- **El feed pagina por offset, no por cursor:** `USER.md` decía «por cursor como el resto del feed», pero el feed de adopción es anterior al estándar de la spec 020 (`limite` + `desplazamiento`). Se mantiene el offset para no mezclar dos esquemas en el mismo endpoint.
- **Limitación conocida:** el feed excluye las mascotas guardadas en favoritos del usuario, así que en el perfil de un refugio no se ven las que ya guardó, mientras `resumen.publicacionesActivas` las cuenta. Si molesta, la salida es un endpoint propio de publicaciones por publicador que no excluya favoritos (la opción 2 de `USER.md`).
