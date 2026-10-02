---
name: seguimiento-implementacion
description: Compara las tareas descritas en Skills/tareas.md con el codigo del repositorio y actualiza Skills/faltantes.md con lo que sigue pendiente y lo que ya se verifico.
---

# Seguimiento de implementacion

Usa esta Skill cuando haya que revisar el avance del proyecto frente a su lista de tareas y mantener actualizado el registro de trabajo pendiente.

## Archivos de seguimiento

- `../tareas.md` contiene los requisitos y resultados esperados. Tratalo como la fuente de alcance; no cambies esos requisitos durante una revision normal.
- `../faltantes.md` es el informe de estado que esta Skill debe actualizar despues de revisar el codigo.

## Procedimiento

1. Lee ambos archivos y las instrucciones locales del repositorio (`AGENTS.md`, si existe).
2. Recorre los archivos fuente, configuracion, documentacion y pruebas pertinentes a las tareas. No des por implementado algo solo porque aparezca en un comentario, modelo de datos o documento.
3. Para cada tarea, determina si esta **completa**, **parcial** o **pendiente** con evidencia verificable. Distingue codigo real de stubs, placeholders y propuestas documentadas.
4. Actualiza `../faltantes.md` para que refleje el estado actual: fecha de revision, tareas pendientes o parciales, evidencia con rutas de archivo y una seccion breve de lo comprobado como completo. Retira pendientes que ya no aplican y conserva los que no se hayan resuelto.
5. Si falta informacion o codigo para confirmar algo, indicalo como no verificable; no inventes el comportamiento ni cambies el requisito para hacerlo parecer completo.

## Limites

- La revision normalmente modifica solo `faltantes.md`. No edites codigo ni ejecutes pruebas salvo que el usuario tambien lo pida.
- No cambies `tareas.md` durante una auditoria. Si el usuario cambia explicitamente el alcance, actualiza primero esa lista y luego vuelve a evaluar los faltantes.
- Usa nombres y estados consistentes con las tareas y el codigo; senala discrepancias entre frontend, backend y base de datos.
- Escribe el informe en espanol, de forma concisa y accionable.
