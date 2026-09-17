# Spec 005 — Historia Clínica

**Estado:** APROBADA
**Sprint:** 5 · **Responsable:** equipo backend · **Última actualización:** 2026-08-24

## 1. Objetivo

Permitir a adoptantes y participantes de refugio registrar, consultar y corregir los antecedentes
médicos de una mascota (controles, vacunas, tratamientos, comprobantes) para mantener una historia
clínica completa y transferible.

## 2. Alcance

- **Incluye:** HU-8.1 (registrar), HU-8.2 (acceder), HU-8.3 (modificar) y HU-8.4 (dar de baja)
  del Módulo 8 de `docs/REQUISITOS.md`.
- **NO incluye:** el módulo de Seguimiento post-adopción (comparte número de spec en el índice de
  `docs/specs/README.md` pero es alcance separado).

## 3. Entidades involucradas

`Historia_Clinica` (`docs/MODELO_DATOS.md` línea 116-120), ya modelada en
`prisma/schema.prisma` (`model HistoriaClinica`). Sin cambios de modelo — esta spec es
puramente de API sobre el modelo existente.

**Regla crítica heredada del modelo:** inmutabilidad. No hay UPDATE sobre un registro
persistido — "modificar" (HU-8.3) es baja lógica del registro erróneo + alta de uno nuevo con los
datos corregidos. Confirmado también en `docs/REQUISITOS.md` línea 158 y 257.

## 4. API (contrato backend)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/api/v1/mascotas/:mascotaId/historias-clinicas` | Adoptante dueño o Refugio dueño de la mascota | Crea un registro (multipart, documento opcional) |
| GET | `/api/v1/mascotas/:mascotaId/historias-clinicas` | Adoptante dueño o Refugio dueño de la mascota | Lista el historial de esa mascota |
| GET | `/api/v1/historias-clinicas/:id` | Adoptante dueño o Refugio dueño de la mascota | Detalle de un registro puntual |
| PATCH | `/api/v1/historias-clinicas/:id` | Ver "Permisos" | Corrige un registro: baja el viejo + crea uno nuevo con los datos fusionados (multipart, todos los campos opcionales salvo los ya vigentes) |
| DELETE | `/api/v1/historias-clinicas/:id` | Ver "Permisos" | Baja lógica simple (HU-8.4) — sin alta de reemplazo, a diferencia del PATCH |

Body de `POST` / `PATCH` (multipart/form-data):

```
fechaVisita: "2026-03-10"       // obligatorio en POST, opcional en PATCH (mantiene el valor vigente si no viene)
fechaProxima: "2026-09-10"      // opcional; si viene, debe ser estrictamente posterior a hoy
requiereRevision: "true"        // opcional, default false
vacunacion: "true"              // solo en POST; no es editable en PATCH
titulo: "Control anual"         // obligatorio en POST, opcional en PATCH
descripcion: "..."              // obligatorio en POST, opcional en PATCH
documento: <file>               // opcional, imagen (jpg/png/webp) o pdf, ≤5MB
```

Errores posibles: `VALIDACION` (400), `NO_ENCONTRADO` (404, mascota o registro inexistente),
`NO_AUTORIZADO` (403, sin asociación con la mascota o sin permiso de edición),
`ARCHIVO_INVALIDO` / `ARCHIVO_DEMASIADO_GRANDE` (400, documento fuera de norma).

## 5. Pantallas (frontend)

Fuera del alcance de este repo — ver `PetHood_Front/pantallas` para las referencias visuales.
Los nombres de HU en el código (`HU-8.1`, `HU-8.2`, `HU-8.3`) son la referencia cruzada.

## 6. Reglas de negocio y validaciones

1. **Acceso** (lectura y alta): el usuario autenticado tiene que estar asociado a la mascota —
   ser su dueño (`mascota.usuarioId`) o pertenecer al refugio dueño (`mascota.refugioId` igual al
   `refugioId` del usuario autenticado con rol Refugio). Igual que el resto del backend, esto se
   resuelve siempre en el servidor.
2. **Fecha visita**: obligatoria, no puede ser futura (reusa `validarFechaPasada`).
3. **Fecha próxima**: opcional; si viene, tiene que ser estrictamente posterior a hoy (nueva
   `validarFechaFutura` en `shared/validation/dates.ts`).
4. **Título / Descripción**: obligatorios en el alta, con límite de caracteres
   (`LIMITES.historiaClinica`). Sin spec de diseño que fije el número exacto todavía — se usan
   valores conservadores documentados en el propio `limits.ts`.
5. **Documento**: imagen (jpg/png/webp) o pdf, ≤5MB (tabla de REQUISITOS.md §4). Si ya había uno
   vinculado al registro, el nuevo lo reemplaza.
6. **Vacunación**: si el registro se marca como vacuna, el título pasa a integrar la lista de
   vacunas visible en el perfil de la mascota (HU-8.1, último criterio) — se resuelve leyendo
   `HistoriaClinica` filtrando `vacunacion=true` desde el endpoint de mascota/perfil existente, no
   se desnormaliza en `Mascota`.
7. **Inmutabilidad / modificación (HU-8.3)**: "modificar" nunca hace UPDATE. Da de baja lógica el
   registro anterior y crea uno nuevo con los campos fusionados (los que no vinieron en el PATCH
   conservan el valor del registro anterior, salvo `vacunacion` que no es editable y siempre se
   arrastra).
8. **Permisos de edición y baja (HU-8.3 / HU-8.4, misma regla)**:
   - Adoptante: solo si es dueño de la mascota **y** creó el registro que edita/elimina
     (`historiaClinica.usuarioAlta === actor.usuarioId`).
   - Refugio: cualquier integrante del refugio dueño de la mascota puede editar o eliminar
     cualquier registro de esa mascota, sin importar qué integrante lo cargó.
   - Cualquier otro caso: `NO_AUTORIZADO` (403). Mensaje "No tenés permisos para editar este
     registro" en el PATCH y "No tiene permisos para eliminar este registro" en el DELETE (este
     último es el texto literal de HU-8.4, en tercera persona a diferencia del resto del backend
     — se respeta tal cual porque la HU lo cita entre comillas).
9. **Baja (HU-8.4)**: es una baja lógica simple (`fechaBaja`/`usuarioBaja`), no dispara un alta de
   reemplazo — a diferencia de "modificar" (HU-8.3), acá no hay corrección, el registro
   simplemente deja de estar vigente. El documento adjunto (si lo hubiera) no se borra del
   storage, igual que el resto de las bajas lógicas del backend (ver `mascotas.service.ts`).
   El modal de confirmación ("¿Estás seguro?" con Cancelar/Aceptar) es responsabilidad
   exclusiva del front — el backend solo expone el DELETE idempotente en el permiso.

## 7. Criterios de aceptación

Los de `docs/REQUISITOS.md` Módulo 8, HU-8.1 a HU-8.3 (ver historias de usuario pegadas en la
conversación de implementación), con esta única desviación textual: el mensaje de permisos
insuficientes se implementa como "No tenés permisos para editar este registro" (variante en
segunda persona singular, consistente con el resto de los mensajes del backend).

## 8. Casos borde y errores

- Mascota inexistente o dada de baja → `NO_ENCONTRADO` (404).
- Registro de historia clínica inexistente o ya dado de baja → `NO_ENCONTRADO` (404).
- PATCH que deja el registro fusionado sin `fechaVisita`/`titulo`/`descripcion` (porque el
  registro anterior no los tenía, caso imposible en la práctica ya que son obligatorios en el
  alta, pero se valida igual por si hay datos inconsistentes) → `VALIDACION` (400).
- Documento con mime no permitido o > 5MB → `ARCHIVO_INVALIDO` / `ARCHIVO_DEMASIADO_GRANDE` (400),
  no se sube ni se vincula nada.

## 9. Notas y decisiones

- 2026-08-24: spec redactada y aprobada en el mismo intercambio en el que se pidió la
  implementación, a partir de las HUs pegadas por el usuario y del modelo ya existente en
  `schema.prisma`. HU-8.4 (baja) quedó fuera de la primera entrega por pedido explícito del
  usuario.
- 2026-08-25: se agrega HU-8.4 (baja) a pedido del usuario, reusando exactamente la misma regla
  de permisos que HU-8.3 (`puedeGestionar` en el service). Es una baja lógica simple, sin alta de
  reemplazo.
- 2026-08-24: se decide exponer el alta y el listado anidados bajo `/mascotas/:mascotaId/...` y el
  detalle/edición como recurso propio `/historias-clinicas/:id`, siguiendo el patrón ya usado por
  `mascotasRouter` (`/mias`) y por la relación 1:N del modelo.
