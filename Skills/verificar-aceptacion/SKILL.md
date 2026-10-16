---
name: verificar-aceptacion
description: Mantiene un catálogo de criterios de aceptación por historia de usuario y verifica su cumplimiento contra la implementación y evidencia disponible cuando se solicita una revisión de aceptación.
---

# Verificar aceptación

Usa esta Skill cuando se solicite comprobar si una o varias historias de usuario cumplen sus criterios de aceptación.

## Fuentes y alcance

- `criterios.md` es el catálogo persistente. Conserva criterios identificables por US e ID.
- Sin una US indicada, revisa todas las historias del catálogo. Si el usuario limita el alcance, revisa esas historias y sincroniza el catálogo con las fuentes actuales.
- Trata los planes, historias y listas de tareas del repositorio como fuentes de requisitos. No cambies ni suavices un criterio para que parezca cumplido.
- Si hay criterios distintos para la misma US en varias fuentes, conserva la diferencia y cita ambas fuentes; no elijas una silenciosamente.

## Procedimiento

1. Lee `criterios.md`, las fuentes de requisitos relevantes y las instrucciones locales `AGENTS.md`, si existen.
2. Busca criterios nuevos o modificados en las fuentes del alcance. Actualiza el catálogo antes de evaluarlos; conserva su sentido y referencia de origen.
3. Revisa código ejecutable, configuración y pruebas relacionadas con cada criterio. Los comentarios, propuestas y checklists por sí solos no demuestran cumplimiento.
4. Ejecuta únicamente verificaciones existentes que sean pertinentes, proporcionales y seguras. No añadas ni modifiques código ni pruebas durante una auditoría. No ejecutes pruebas que escriban en bases de datos compartidas; usa una instancia aislada o limita el estado a **No verificable**.
5. Asigna a cada criterio uno de estos estados:
   - **Cumple:** comportamiento implementado y evidencia suficiente para contrastar el criterio.
   - **Parcial:** hay implementación, pero falta una parte o una verificación importante.
   - **No cumple:** la implementación falta o contradice el criterio.
   - **No verificable:** la evidencia o el entorno disponible no permiten decidir.
6. Presenta una tabla por US con ID, criterio resumido, estado y evidencia concreta (archivo, prueba y resultado cuando exista). Separa hallazgos de código de pruebas ejecutadas; no afirmes que un build demuestra comportamiento funcional.
7. No edites `faltantes.md` ni marques tareas completas automáticamente. Hazlo solo si el usuario también lo pide o una Skill aplicable lo requiere.

Si faltan criterios para una US nueva, incorpóralos al catálogo desde la fuente del repositorio antes de evaluarla. Si no existe una fuente de aceptación identificable, registra la US como pendiente de definición en la respuesta y pide la fuente necesaria.
