# Spec 015 — Soporte (HU-15.1, HU-15.2, HU-15.3)

**Estado:** APROBADA
**Sprint:** 13 (Fase 13 del ROADMAP: en paralelo, sin dependencias, baja prioridad) · **Responsable:** ncorrea-13 · **Última actualización:** 2026-09-21

## 1. Objetivo

Que cualquier persona, tenga o no cuenta, pueda leer las preguntas frecuentes (FAQs) y enviar una consulta al equipo de PetHood desde un formulario. Las consultas quedan guardadas y las lee el administrador global en web-admin, que además mantiene el catálogo de FAQs sin tocar código.

## 2. Alcance

- **Incluye:**
  - HU-15.1: consulta pública de FAQs agrupadas por categoría.
  - HU-15.2: formulario de contacto público. Las consultas se guardan en una tabla y el admin las ve en web-admin.
  - HU-15.3: ABM de `Faq` y `Faq_Categoria` desde web-admin.
- **NO incluye:**
  - Manual de operación: es texto estático que resuelve el frontend, el backend no expone endpoint.
  - Envío por correo: no se manda ningún mail, ni al soporte ni de respuesta al usuario. Si más adelante se quiere, se agrega sobre esta misma tabla.
  - Respuesta al usuario desde la plataforma: el admin lee la consulta y la marca como resuelta, sin canal de vuelta.
  - Moderación y reportes de contenido (HU-3.1 a HU-3.7): es otro flujo, con otro actor y otra entidad (`Reporte_Problema`). Va en spec 008 y esta spec no la toca.

## 3. Entidades involucradas

Ver `MODELO_DATOS.md`. Esta spec introduce **tres tablas nuevas** (una migración: `npx prisma migrate dev --name soporte`). Bajas siempre lógicas, nunca DELETE físico.

- **`ConsultaSoporte`** (nueva, HU-15.2), tabla `consulta_soporte`:

| Campo | Tipo | Notas |
| --- | --- | --- |
| `consulta_soporte_id` | PK autoincremental | |
| `consulta_soporte_nombre_completo` | String | |
| `consulta_soporte_email` | String | Correo de contacto |
| `consulta_soporte_asunto` | String | |
| `consulta_soporte_mensaje` | String | Texto largo |
| `consulta_soporte_resuelta` | Boolean, default `false` | Lo marca el admin |

- auditoría estándar. Quien envía no está autenticado, así que `usuarioAlta` = `USUARIO_SISTEMA_ID` (mismo criterio que los cron jobs). El endpoint no lee el JWT aunque venga.

- **`FaqCategoria`** (nueva, HU-15.3): `faq_categoria_id`, `faq_categoria_nombre`, `faq_categoria_descripcion` + auditoría.
- **`Faq`** (nueva, HU-15.3): `faq_id`, `faq_pregunta`, `faq_respuesta`, `faq_orden`, FK `faq_categoria_id` NOT NULL + auditoría.

Nombres exactos según `MODELO_DATOS.md` para las FAQs. Los de `ConsultaSoporte` los define esta spec y hay que agregarlos ahí (ver §9).

Nuevos límites en `src/shared/validation/limits.ts` (**duplicar a mano** en `pethood-frontend/apps/mobile/shared/validation/limits.ts` en el mismo PR):

```ts
consultaSoporte: {
  nombreCompleto: { min: 2, max: 100 },
  email: { max: 100 },
  asunto: { min: 5, max: 100 },
  mensaje: { min: 10, max: 1000 },
},
faq: {
  pregunta: { min: 5, max: 200 },
  respuesta: { min: 5, max: 2000 },
  orden: { min: 1, max: 999 },
},
faqCategoria: {
  nombre: { min: 2, max: 50 },
  descripcion: { max: 200 },
},
```

Los números son una propuesta: ninguna consigna los fija (ver §9).

## 4. API (contrato backend)

Módulo nuevo: `src/modules/soporte/` (scaffold de 5 archivos). Errores siempre `{ error: { codigo, mensaje } }`.

### FAQs (HU-15.1 y HU-15.3)

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| GET | /api/v1/faqs | pública | FAQs activas agrupadas por categoría, ordenadas por `orden` |
| GET | /api/v1/admin/faq-categorias | JWT, admin | Listar categorías |
| POST | /api/v1/admin/faq-categorias | JWT, admin | Crear categoría |
| PATCH | /api/v1/admin/faq-categorias/:id | JWT, admin | Editar categoría |
| DELETE | /api/v1/admin/faq-categorias/:id | JWT, admin | Baja lógica (solo si no tiene FAQs activas) |
| POST | /api/v1/admin/faqs | JWT, admin | Crear FAQ |
| PATCH | /api/v1/admin/faqs/:id | JWT, admin | Editar pregunta, respuesta, orden o categoría |
| DELETE | /api/v1/admin/faqs/:id | JWT, admin | Baja lógica |

`GET /faqs` (respuesta plana, sin envelope; las categorías sin FAQs activas no se devuelven):

```json
200 [
  {
    "id": 1,
    "nombre": "Adopciones",
    "descripcion": "Todo sobre el proceso de adopción",
    "faqs": [
      { "id": 3, "pregunta": "¿Cómo adopto una mascota?", "respuesta": "...", "orden": 1 }
    ]
  }
]
```

`POST /admin/faqs`:

```json
{ "pregunta": "¿Cómo adopto una mascota?", "respuesta": "...", "orden": 1, "faqCategoriaId": 1 }
→ 201 { "id": 3, "pregunta": "...", "respuesta": "...", "orden": 1, "faqCategoriaId": 1 }
```

Errores: `400 VALIDACION`, `404 FAQ_NO_ENCONTRADA`, `404 CATEGORIA_NO_ENCONTRADA`, `409 CATEGORIA_CON_FAQS`, `403 ROL_NO_AUTORIZADO`.

### Formulario de contacto (HU-15.2)

| Método | Ruta | Auth | Descripción |
| --- | --- | --- | --- |
| POST | /api/v1/soporte/consultas | pública, con rate limit por IP | Enviar una consulta |
| GET | /api/v1/admin/soporte/consultas?resuelta=false | JWT, admin | Listar consultas, más nuevas primero, filtro opcional por `resuelta` |
| PATCH | /api/v1/admin/soporte/consultas/:id/resolver | JWT, admin | Marcar como resuelta |
| DELETE | /api/v1/admin/soporte/consultas/:id | JWT, admin | Baja lógica |

`POST /soporte/consultas`:

```json
{
  "nombreCompleto": "Ana Pérez",
  "email": "ana@correo.com",
  "asunto": "No puedo subir fotos",
  "mensaje": "Cuando intento publicar una mascota la foto no carga."
}
→ 201 { "mensaje": "Su consulta ha sido enviada con éxito" }
```

La respuesta no devuelve el registro creado: quien envía no necesita el id.

`GET /admin/soporte/consultas`:

```json
200 [
  {
    "id": 12,
    "nombreCompleto": "Ana Pérez",
    "email": "ana@correo.com",
    "asunto": "No puedo subir fotos",
    "mensaje": "...",
    "resuelta": false,
    "fechaAlta": "2026-09-21T15:00:00.000Z"
  }
]
```

Errores: `400 VALIDACION` (campo faltante o inválido, con el detalle por campo), `429 DEMASIADAS_CONSULTAS` (rate limit), `404 CONSULTA_NO_ENCONTRADA`, `409 CONSULTA_YA_RESUELTA`, `403 ROL_NO_AUTORIZADO`.

## 5. Pantallas (frontend)

Referencia para el equipo de frontend. «Pantalla de Ayuda y Soporte» y «Formulario de Soporte» son los nombres de la consigna.

- **Mobile y landing, Ayuda y Soporte (HU-15.1):** accesible sin sesión desde el menú lateral o la landing. Manual de operación (texto estático) y FAQs en **acordeón** colapsable: al tocar una pregunta se expande su respuesta sin recargar. Estados: cargando, vacío ("Todavía no hay preguntas frecuentes"), error.
- **Sección de contacto (HU-15.2):** al final de la misma pantalla. Enlace de soporte y formulario con Nombre completo, Correo electrónico de contacto, Asunto, Mensaje y botón «Enviar Mensaje». Éxito: toast verde "Su consulta ha sido enviada con éxito". Campos faltantes: aviso de error indicando que faltan campos (GUI-0.1.4, pantalla de campos requeridos).
- **Web-admin, Consultas de soporte:** tabla con filtro pendientes/resueltas, detalle de la consulta y acción «Marcar como resuelta».
- **Web-admin, FAQs (HU-15.3):** ABM de categorías y FAQs, con modal de confirmación en las bajas y edición del orden.

## 6. Reglas de negocio y validaciones

1. Toda entrada se valida con Zod en `soporte.dto.ts`, componiendo reglas de `shared/validation/`. Si falta una (por ejemplo `email`), se agrega ahí antes de usarla.
2. `nombreCompleto`: solo caracteres alfabéticos (REQUISITOS §4), con trim.
3. `email`: contiene `@` y dominio (REQUISITOS §4).
4. `asunto` y `mensaje`: con trim, rechazando vacíos o de solo espacios.
5. Todos los campos del formulario son obligatorios.
6. **Rate limit por IP** en `POST /soporte/consultas`, porque el endpoint es público y admite spam. Propuesta: 5 consultas por hora por IP (ver §9).
7. Una consulta resuelta no se vuelve a resolver (`409 CONSULTA_YA_RESUELTA`).
8. `GET /faqs` devuelve solo registros sin `fechaBaja`, ordenados por `Faq.orden` y luego por `id`.
9. Baja de categoría con FAQs activas → `409 CATEGORIA_CON_FAQS`.
10. Toda escritura completa la auditoría con los helpers de `shared/auditoria.ts`. Altas, ediciones y bajas del admin escriben en `LogAuditoria`.
11. Las FAQs se guardan como texto plano. El frontend no las renderiza como HTML.

## 7. Criterios de aceptación

- [ ] `GET /faqs` sin token devuelve las FAQs agrupadas por categoría y ordenadas.
- [ ] Una FAQ o categoría dada de baja no aparece en `GET /faqs`.
- [ ] Admin crea, edita y da de baja FAQs y categorías, y el cambio se ve en `GET /faqs` sin tocar código ni redeploy.
- [ ] Baja de categoría con FAQs activas devuelve `409 CATEGORIA_CON_FAQS`.
- [ ] `POST /soporte/consultas` sin token, con datos válidos, devuelve `201` y la consulta queda guardada con `resuelta = false`.
- [ ] Con algún campo faltante devuelve `400 VALIDACION` indicando cuál.
- [ ] Con un correo sin `@` o sin dominio, o un nombre con números, devuelve `400 VALIDACION`.
- [ ] Superado el rate limit devuelve `429 DEMASIADAS_CONSULTAS`.
- [ ] Admin lista las consultas y filtra por resuelta.
- [ ] Admin marca una consulta como resuelta. Repetirlo devuelve `409 CONSULTA_YA_RESUELTA`.
- [ ] Un no-admin recibe `403 ROL_NO_AUTORIZADO` en cualquier `/admin/*` de esta spec, y sin token recibe `401`.
- [ ] Ningún registro se elimina físicamente.
- [ ] Tests de servicio con el repository mockeado y `npm run lint` sin errores.

## 8. Casos borde y errores

- `:id` no numérico: `400 VALIDACION` vía `parsearId`.
- Mover una FAQ a una categoría dada de baja o inexistente: `404 CATEGORIA_NO_ENCONTRADA`.
- Dos FAQs con el mismo `orden` en la misma categoría: se permite, el desempate es por `id`.
- Consulta enviada con un JWT válido en el header: se ignora, se trata igual que una anónima.
- Detrás de un proxy o de Tailscale, el rate limit necesita `trust proxy` en `app.ts` para ver la IP real. Sin eso todos comparten un solo contador.

## 9. Notas y decisiones

Decisiones de esta revisión (2026-09-21, ncorrea-13):

1. **HU-15.3 se incluye en esta spec.** El catálogo de FAQs debe guardarse en base y ser editable sin tocar código. Esto reemplaza el enfoque estático de HU-15.1 y levanta el estado PENDIENTE de `REQUISITOS.md`.
2. **Las consultas se guardan en tabla y las lee el admin en web-admin.** No hay envío de mails por ahora.
3. **HU-15 y HU-3 son flujos distintos** y no comparten entidad. `Reporte_Problema` queda para spec 008.

Pendientes antes de pasar a APROBADA:

1. **Rate limit:** no hay librería instalada. Propuesta: `express-rate-limit`, con 5 consultas por hora por IP. Es una dependencia nueva que hay que aprobar.
2. **Límites de caracteres:** los de §3 son valores conservadores propios, sin consigna que los fije.
3. **Actualizar docs en el mismo PR:**
   - `MODELO_DATOS.md`: agregar `Consulta_Soporte` y sacar el estado PENDIENTE de `Faq`.
   - `REQUISITOS.md`: la línea "Módulo 15: sin entidad de dominio, contenido estático" y la nota de HU-15.3 ya no valen.
   - `docs/ARQUITECTURA.md`: agregar `soporte/` al árbol.
4. **Propagar al frontend:** el `AGENTS.md` y `limits.ts` de `pethood-frontend` no se sincronizan solos.
