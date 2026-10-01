# Specs — flujo spec-driven

Cada módulo tiene una spec numerada que se escribe y aprueba ANTES de codificar. La spec es el contrato entre backend y frontend: si no está en la spec, no se implementa; si hace falta cambiarla, se cambia la spec primero (en el mismo PR).

## Ciclo de vida de una spec

`BORRADOR → EN REVISIÓN → APROBADA → IMPLEMENTADA`

1. **Borrador:** un integrante la redacta con `SPEC_TEMPLATE.md`, basándose en REQUISITOS.md, MODELO_DATOS.md y las historias de usuario de la carpeta.
2. **Revisión:** el equipo la revisa en la weekly (o por PR).
3. **Aprobada:** se puede empezar a codificar. Backend y frontend trabajan en paralelo contra los contratos de API definidos.
4. **Implementada:** el módulo pasó la DoD (ver CONSTITUTION.md).

## Índice

| Nº | Spec | Sprint | Estado |
| --- | --- | --- | --- |
| 001 | Gestión de Perfiles y Autenticación | 1 | BORRADOR |
| 002 | Publicación de Mascotas | 2 | pendiente |
| 003 | Adopción y Favoritos | 3 | BORRADOR |
| 004 | Chat y Notificaciones | 4 | pendiente |
| 005 | Historia Clínica (HU-8.1 a HU-8.4) | 5 | APROBADA |
| 006 | Hogares de Tránsito y Reputación | 6 | pendiente |
| 007 | Campañas, Padrinazgos y Perdidos | 7 | pendiente |
| 008 | Moderación y Reportes (HU-3.1 a HU-3.7) | 13 | IMPLEMENTADA |
| 009 | Dashboards y Reportes (Admin) | 12 | APROBADA |
| 010 | Dashboard de Refugio | 12 | APROBADA |
| 011 | Seguimiento Post-Adopción (HU-9.1, HU-9.2) | 7 | APROBADA |
| 015 | Soporte (HU-15.1, HU-15.2, HU-15.3) | 13 | BORRADOR |
| 016 | Switch de perfil refugio / adoptante (transversal) | 13 | EN REVISIÓN |
| 017 | Perfil del refugio | 13 | EN REVISIÓN |
| 018 | Editar publicación y cambiar su estado (sin HU) | 13 | EN REVISIÓN |
| 019 | Vacunas de la mascota (HU-6.1, HU-8.1) | 13 | APROBADA |
| 020 | Mascotas perdidas y encontradas: registrar y listar avisos (HU-13.1) | 13 | APROBADA |
| 021 | Navegación y Filtros de Adoptar (HU-11.1 a HU-11.4) | 13 | IMPLEMENTADA |
| 022 | Sistema de Reputación (HU-10.1 a HU-10.6) | 13 | IMPLEMENTADA |
