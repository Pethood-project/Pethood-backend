# Spec 021 — Navegación y Filtros de Adoptar (Módulo 11)

**Estado:** IMPLEMENTADA
**Sprint:** 13 · **Responsable:** equipo PetHood · **Última actualización:** 2026-09-27

## 1. Objetivo

Permitir que un adoptante acote el feed de Adoptar por fecha de publicación, texto libre y
ubicación, para llegar más rápido a la mascota que busca. Cubre HU-11.1 a HU-11.4 (los
filtros por características ya existían; esta spec agrega fecha, texto y cercanía).

## 2. Alcance

- **Incluye:** orden por fecha de alta, rango de fecha de publicación, búsqueda parcial de
  texto libre (título, descripción, nombre de mascota y rasgos de personalidad) y filtro
  geoespacial por cercanía: coordenadas actuales del usuario contra la ubicación del refugio
  (coordenada capturada de la publicación o extraída de su enlace de Google Maps).
- **NO incluye:** mapa interactivo ni SDK de mapas (seguimos sin mapa); geocodificación de
  direcciones; filtro por localidad de texto libre (se quitó, ver nota 9).

## 3. Entidades involucradas

`Publicacion` y `Refugio`. **Campos nuevos:** `publicacion_ubicacion_latitud`,
`publicacion_ubicacion_longitud` (`Decimal(9,6)` nullable) y `refugio_mapa_url` (texto,
nullable). Migraciones `20260927130000_publicacion_geolocalizacion` y
`20260928120000_refugio_mapa_url`. Sin cambios en otras entidades.

## 4. API (contrato backend)

`GET /api/v1/publicaciones` (feed, perfil personal) acepta, además de los filtros previos:

| Query | Descripción |
|---|---|
| `texto` | Búsqueda parcial (substring, sin distinguir mayúsculas) en título, descripción, nombre de mascota y personalidad |
| `orden` | `recientes` (default) \| `antiguas`, por fecha de alta |
| `fechaDesde`, `fechaHasta` | `AAAA-MM-DD`, rango de `fechaAlta` inclusive |
| `latitud`, `longitud`, `radioKm` | Filtro por distancia (Haversine); las tres juntas. Sin `radioKm` no se recorta por cercanía ("Ninguno") |

La cercanía se resuelve contra las coordenadas capturadas de la publicación **o** las
extraídas del `refugio_mapa_url` del refugio que la publicó: entra la publicación si
cualquiera de las dos cae dentro del radio. El parseo del link vive en `src/shared/geo.ts`
(función pura) y los conjuntos de ids se intersecan con el resto de los filtros.

**Ficha de una publicación:** `GET /api/v1/publicaciones/:id?latitud=&longitud=` acepta las
coordenadas del usuario y devuelve `distanciaKm` (redondeada a un decimal) contra la
ubicación de quien publicó, usando la misma resolución (publicación o link de Maps del
refugio). Sin coordenadas, `distanciaKm` es `null`.

## 5. Pantallas (frontend mobile)

- **Adoptar (GUI-05):** barra de búsqueda por texto (debounce 350 ms) en el encabezado.
- **Filtros (GUI-23):** secciones nuevas de **Ordenar por**, **Fecha de publicación** y
  **Ubicación**. Ubicación tiene "Usar mi ubicación actual" (GPS) y un selector de radio con
  **Ninguno** como opción por defecto. Se eliminó el input de texto de Localidad.
- **Detalle de mascota (GUI-10):** ícono de mapa junto al nombre del refugio que abre el
  `mapaUrl` en Google Maps, y la **distancia** a quien publicó al lado de la ubicación
  (requiere ubicación del usuario; si no hay permiso, no se muestra).
- **Nueva/editar publicación:** captura de coordenadas best-effort al guardar, para que el
  filtro por cercanía tenga contra qué comparar.

## 6. Reglas de negocio y validaciones

1. La ubicación solo se aplica con el GPS del usuario y un radio elegido; "Ninguno" no limita la búsqueda. Frontend.
2. `radioKm` entre 1 y 500; coordenadas dentro del rango real. Backend (Zod).
3. `fechaDesde ≤ fechaHasta`. Backend (Zod) y frontend (DateField acota el picker).
4. La distancia se mide contra la ubicación del refugio: coordenada capturada de la publicación o extraída de su enlace de Maps.
5. El orden por defecto es el más reciente primero; el cambio de orden no altera los filtros.

## 7. Criterios de aceptación

- [ ] Ordenar por "Más antiguas" invierte el feed y la paginación sigue siendo determinística.
- [ ] La búsqueda por texto matchea nombres, descripciones y rasgos de personalidad de forma parcial.
- [ ] El rango de fechas acota por fecha de publicación, ambas puntas inclusive.
- [ ] Con GPS concedido y un radio elegido, el feed muestra publicaciones dentro del radio.
- [ ] "Ninguno" (default) no recorta por distancia; "Limpiar" vuelve a "Ninguno".
- [ ] El detalle de la mascota muestra el ícono de mapa y abre el link del refugio.
- [ ] Los filtros por características existentes siguen funcionando.

## 8. Casos borde y errores

- GPS desactivado o sin permiso al elegir un radio: aviso y el filtro queda en "Ninguno"; nunca se bloquea el feed.
- Refugio sin link, o con un link del que no se puedan obtener coordenadas (p. ej. una pantalla de consentimiento de Google): queda fuera del filtro por distancia. Los links cortos `maps.app.goo.gl` se resuelven siguiendo la redirección, con caché y tope de 4 s.
- `fechaDesde` posterior a `fechaHasta`: 400 con mensaje claro.

## 9. Notas y decisiones

- Se capturan coordenadas de la publicación al publicar/editar (best-effort, sin bloquear el
  guardado). Decisión de equipo, 2026-09-27.
- 2026-09-28: se agregó `refugio_mapa_url` y el filtro por radio pasa a tomar también las
  coordenadas extraídas de ese link; se quitó el input de Localidad de texto libre. La
  contradicción con el "no GPS" del anteproyecto sigue anotada en `DEUDA_TECNICA.md`.
