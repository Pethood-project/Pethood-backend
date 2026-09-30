# Spec 022 — Sistema de Reputación (Módulo 10)

**Estado:** IMPLEMENTADA
**Sprint:** 13 · **Responsable:** equipo PetHood · **Última actualización:** 2026-09-27

## 1. Objetivo

Permitir que las dos partes de una transacción concretada (adopción o tránsito) se valúen mutuamente con 1-5 estrellas y un comentario, y que esa reputación sea visible en los perfiles, en la ficha de una publicación y al revisar una solicitud. Da cobertura a HU-10.1 a HU-10.6.

## 2. Alcance

- **Incluye:** alta de reseña validando la transacción finalizada; historial, promedio y desglose por usuario y por refugio; transacción elegible para reseñar; baja lógica exclusiva del administrador.
- **NO incluye:** edición del contenido de una reseña (nunca se edita, HU-10.6); reporte de reseñas (moderación, Módulo 3, spec 008); notificaciones al recibir una reseña (Módulo 4).

## 3. Entidades involucradas

`Resena` (MODELO_DATOS.md). **Campo nuevo:** `solicitud_id` — la transacción concretada que habilita la reseña. El receptor es `refugio_reportado_id` o `usuario_reportado_id`; el flujo se deriva del `tipoSolicitud` de la solicitud. Índice parcial `resena_solicitud_autor_activo_uq` (una reseña activa por autor y solicitud). Ver migración `20260927120000_resena_solicitud`.

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/v1/resenas/elegibles` | cualquier sesión | Transacciones concretadas que el perfil activo todavía no reseñó |
| GET | `/api/v1/resenas/usuario/:usuarioId` | cualquier sesión | Promedio, cantidad, desglose y comentarios de una persona |
| GET | `/api/v1/resenas/refugio/:refugioId` | cualquier sesión | Idem para un refugio |
| POST | `/api/v1/resenas` | cualquier sesión | Crea la reseña |
| DELETE | `/api/v1/resenas/:id` | ADMIN | Baja lógica (HU-10.6) |

**Body del POST:**

```json
{ "solicitudId": 42, "puntuacion": 5, "comentario": "Muy atentos en todo el proceso." }
```

**Respuesta de historial:**

```json
{
  "promedio": 4.5,
  "cantidad": 2,
  "distribucion": [{ "puntuacion": 5, "cantidad": 1 }, { "puntuacion": 4, "cantidad": 1 }, { "puntuacion": 3, "cantidad": 0 }, { "puntuacion": 2, "cantidad": 0 }, { "puntuacion": 1, "cantidad": 0 }],
  "resenas": [{ "id": 7, "puntuacion": 5, "comentario": "…", "fecha": "2026-09-27T…", "autor": { "id": 3, "nombre": "Ana", "apellido": "Pérez", "imagenUrl": null }, "receptor": "REFUGIO", "flujo": "ADOPTANTE_A_REFUGIO" }]
}
```

**Errores posibles del POST:** `TRANSACCION_NO_FINALIZADA` (409), `NO_PARTICIPA` (403), `RESENA_DUPLICADA` (409), `RESENA_PROPIA` (403), `NO_ENCONTRADO` (404).

## 5. Pantallas (frontend mobile)

- **Pantalla `/resenas`** (accesible desde Mi Perfil, ambos perfiles): sección "Pendientes de reseñar" con las transacciones elegibles y CTA **Reseñar**, y la reputación recibida del perfil activo (desglose + comentarios).
- **`ResenaModal`**: estrellas interactivas (obligatorias) + comentario opcional (≤500). El texto cambia según el flujo.
- **`ResumenReputacion`** (reutilizable): se incrusta en Mi Perfil, en la ficha de la publicación (reseñas del refugio) y en el detalle de una solicitud (reseñas del solicitante).
- Estados cargando / vacío / error en la pantalla y en el bloque de reputación.

## 6. Reglas de negocio y validaciones

1. Solo se reseña una solicitud cuyo estado VIGENTE sea `Aprobada` (transacción concretada). Backend.
2. El autor tiene que ser parte de la transacción: el solicitante o quien publicó la mascota (usuario personal o miembro del refugio dueño). Backend.
3. El receptor es siempre la contraparte; nunca lo elige el cliente. Backend.
4. Puntuación obligatoria de 1 a 5; comentario opcional ≤500 (`LIMITES.resena`). Backend (Zod) y frontend (input).
5. Una sola reseña activa por autor y solicitud. Backend (validación + índice parcial).
6. Nunca se edita el contenido; la baja es lógica y exclusiva del administrador. Backend.

## 7. Criterios de aceptación

- [ ] Un usuario con una adopción aprobada puede reseñar a la contraparte con estrellas y comentario.
- [ ] No se puede reseñar una solicitud pendiente, rechazada o ajena.
- [ ] No se puede reseñar dos veces la misma transacción.
- [ ] El promedio y el desglose se actualizan en los tres lugares donde se muestran.
- [ ] El administrador puede dar de baja una reseña y deja de contarse.
- [ ] Los flujos adoptante↔refugio, refugio→adoptante y refugio→tránsito muestran textos acordes.

## 8. Casos borde y errores

- Reseñas históricas sembradas sin `solicitudId`: se listan normalmente con `flujo: null`.
- Un usuario sin transacciones concretadas ve el estado vacío.
- Si falla la carga de reputación embebida, la pantalla continúa (bloque secundario).

## 9. Notas y decisiones

- El vínculo con la transacción se agregó como campo nullable en base (compatibilidad con el seed) pero obligatorio en el DTO. Decisión de equipo, 2026-09-27.
- La baja la hace solo el admin porque HU-10.6 la enmarca en moderación; el autor no puede borrar su propia reseña.
