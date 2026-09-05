# Qué probar en el 2.12.0

No hay `CHANGELOG.md` en el repo (se buscó con `**/CHANGELOG*.md`; solo aparecen los de `node_modules`, de librerías de terceros). Este documento reemplaza esa función para esta versión: qué cambió y qué tocar en el teléfono para confirmarlo, sin tener que leer el código.

PIN de prueba extra por si querés repetir cualquier paso en la otra tienda: **Bolívar → Contador 30 → PIN 000030**.

---

## A) Qué cambió desde 2.11.0

- El escáner de la góndola resuelve el código en el teléfono, contra los productos de la hoja abierta — ya no depende de la señal ni de un catálogo de ejemplo.
- El catálogo que usa la app sale del servidor real, no del dataset de demo que traía la instalación.
- Un Contador ve y puede abrir solo las hojas asignadas a él, aunque el teléfono tenga descargadas las de otro colaborador (por ejemplo, porque el Coordinador usó el mismo equipo).
- Una descarga de hojas cortada a la mitad ya no se muestra como si estuviera completa: la pantalla avisa "descarga incompleta" y ofrece reintentar.
- Sin señal, Inicio ya no muestra "0 hojas" ni "0 asignadas" cuando en realidad no se pudo consultar el servidor — ahora dice "—" y aclara "sin red".
- Una hoja ya no se declara finalizada ante el servidor si le queda un conteo rechazado o pendiente de subir; y el aviso de error dice la razón real, no "revisá la conexión" para algo que no es de red.
- La barra de progreso al bajar el catálogo de Dynamics avanza con el dato real de paginación, no un porcentaje fijo.
- Historial: paginación real con "Cargar más", filtro por período (año/mes), chip de sucursal para el Administrador, y folio / fecha / quién lacró visibles en cada fila de la lista (antes solo en el detalle).
- Pantalla nueva de Comparativo mensual y la historia de un ítem, accesibles desde Historial.
- La conciliación (planilla vs. fondo de multas) se muestra ANTES de lacrar, no solo después.
- Ocho pantallas más ahora atrapan los errores de red al cargar: muestran el problema y ofrecen reintentar, en vez de quedarse con el spinner girando para siempre.
- El botón para cerrar una ronda nombra qué ronda cierra y cuál abre (antes decía siempre "abrir el 2do conteo", aunque se estuviera cerrando la 2da).
- La asistencia del personal se deduce automáticamente de las hojas que contaron, sin carga manual.
- Se puede cambiar el PIN propio desde la app, en los 4 roles.
- Login: el PIN se borra tras un rechazo (queda listo para reintentar) y avisa cuántos minutos faltan si hubo demasiados intentos.
- Versión de la app subida a 2.12.0, con script reproducible para armar el release.

---

## B) Qué probar en el teléfono

### 1. Login — PIN vacío tras un rechazo
**Rol:** Contador (Luis) · **PIN:** 220022, pero escribí primero uno incorrecto (por ejemplo `999999`).
**Pantalla:** Ingreso, tras elegir Luzuriaga → Luis.
**Tocar:** Ingresar con el PIN incorrecto.
**Debe leerse:** un cartel titulado **"No se pudo ingresar"** con el texto **"PIN incorrecto."**, y los 6 puntos del PIN vacíos apenas se cierra el cartel (no hay que borrarlos a mano).
Después, escribí el PIN correcto (220022) e ingresá.

### 2. Mis hojas — solo las propias
**Rol:** Contador (Luis, 220022) y después Contador (Carla, 330033).
**Pantalla:** Mis hojas.
**Tocar:** nada más que entrar a la pantalla con cada sesión.
**Debe leerse:** con Luis, el pie de la lista dice **"Mostrando las N hojas asignadas · X en proceso · Y finalizadas · Z pendientes"** con los números de hoja de Luis. Al salir y volver a entrar como Carla, la lista muestra OTROS números de hoja — ninguno de los que vio Luis.

### 3. Escáner — código de un producto de la hoja
**Rol:** Contador (Luis, 220022).
**Pantalla:** Contar (una hoja abierta con productos).
**Tocar:** ícono de escáner, apuntar al código de barras de un producto que SÍ está en esa hoja.
**Debe leerse:** el modal de escaneo se cierra solo y aparece **"Confirmado con la cámara: {nombre del producto}. El código no dice cuántas hay — la cantidad y el empaque los cargás vos."** (o, si el código es de un empaque, "Confirmado con la cámara: {producto} · {empaque} ×{factor}.").

### 4. Escáner — código que NO es de la hoja
**Rol:** Contador (Luis, 220022), misma hoja.
**Pantalla:** Contar.
**Tocar:** escanear un código de un producto de OTRA hoja o que no existe en el catálogo.
**Debe leerse:** el modal queda abierto y muestra **"El código {código} no pertenece a la hoja #{número}. No se registró nada."** — nada se marca como contado.

### 5. Contar sin red y reabrir
**Rol:** Contador (Luis, 220022).
**Pantalla:** Contar.
**Tocar:** activar el Modo Avión, contar un producto, anotar el número que queda arriba ("X / Y Productos"), cerrar la app por completo (no solo minimizarla) y volver a abrirla con el avión todavía activado.
**Debe leerse:** el mismo **"X / Y Productos"** que quedó antes de cerrar (no se perdió el conteo), y la banda de arriba dice **"Sin conexión — seguí contando, se guarda en el equipo y sube solo."** (o, si ya había algo pendiente de antes, "Sin conexión — N conteos guardados en el equipo, se van a subir solos."). Desactivá el avión antes de seguir con el resto de las pruebas.

### 6. Cerrar la ronda 1
**Rol:** Coordinador (Nancy, 110011).
**Pantalla:** Ciclo de conteos.
**Tocar:** el botón que dice **"Cerrar el 1er conteo y abrir el 2do conteo · N ítems"**.
**Debe leerse:** un cartel titulado **"2do conteo abierto"** con el texto **"Se abrió la ronda 2 con N hojas nuevas, sin asignar. Repartilas desde Gestión de hojas."**.

### 7. La ronda 2 llega en cero
**Rol:** Coordinador (Nancy, 110011), después Contador (Luis, 220022).
**Pantalla:** Gestión de hojas → repartir una hoja de la ronda 2 a Luis; después Mis hojas → Contar, con Luis.
**Tocar:** abrir esa hoja recién repartida.
**Debe leerse:** arriba, **"0 / N Productos"** — ningún renglón trae el número que Luis cargó en la ronda 1, aunque sea la misma góndola.

### 8. Historial — filtros (y el chip de Sucursal)
**Rol:** Administrador (Admin Sistema, 001000) — **no Coordinador**: `historial.routes.ts` exige `requiereRol('administrador', 'auditor')`; un Coordinador recibe 403. Nancy no sirve acá.
**Pantalla:** Historial.
**Tocar:** el chip de **Sucursal** (solo lo ve el Administrador — un Auditor no lo tiene, porque su alcance ya está fijo en la suya), después **Período** (elegir un año) y el filtro de **Estado**.
**Debe leerse:** el chip de Sucursal ofrece **"Todas"** más un chip por cada tienda (con su nombre real, incluida Luzuriaga). La cabecera cambia a **"Mostrando N de M inventarios"** con M igual o menor al total sin filtrar. Con una combinación sin resultados, aparece **"Ningún inventario con estos filtros"** / **"Probá con otra combinación."**.

### 9. Historial — Cargar más
**Rol:** Administrador (Admin Sistema, 001000).
**Pantalla:** Historial, con un filtro que deje más inventarios de los que entran en una página.
**Tocar:** el botón **"Cargar más (N restantes)"** al final de la lista.
**Debe leerse:** se agregan más filas a la lista (no reemplaza las que ya estaban) y el botón actualiza su número de "restantes"; cuando llega a 0, el botón desaparece.

### 10. Comparativo mensual
**Rol:** Administrador (Admin Sistema, 001000) — mismo motivo que el paso 8: `/historial/comparativo` cuelga del mismo router, sin `coordinador` en la lista.
**Pantalla:** Historial → botón **"Comparativo mensual"** (arriba, al lado del ícono de tendencia).
**Tocar:** abrir la pantalla.
**Debe leerse:** el rótulo de arriba dice **"Comparativo mensual"** y la tabla trae las columnas **"Período" · "Ítems" · "Cuadrados" · "Faltante neto" · "Vs. mes anterior"**, una fila por mes cerrado. Si todavía no hay ningún período comparable, en cambio dice **"Todavía no hay períodos comparables"** / **"Hace falta al menos un inventario cerrado con asistencia y ajustes ya cargados."**.

### 11. Conciliación antes de lacrar
**Rol:** Coordinador (Nancy, 110011).
**Pantalla:** Liquidación (antes de aprobar/lacrar el mes).
**Tocar:** abrir la pantalla, sin tocar el botón de lacrado todavía.
**Debe leerse:** una tarjeta titulada **"Conciliación"** con las filas **"Suma real de la planilla"** y **"Diferencia por redondeo"**, y más abajo **"Fondo de multas recaudado"** / **"Repartido entre asistentes"**. Si cierra, badge **"El fondo de multas cierra"**; si no, un aviso **"El fondo de multas no cierra: se repartió S/ X de S/ Y recaudados (diferencia de S/ Z)."**.

### 12. Ajustes del mes
**Rol:** Coordinador (Nancy, 110011) — `PUT/GET /liquidacion/inventarios/:id/ajustes` exige `requiereRol('administrador', 'coordinador')`, sin auditor: es quien después firma el lacrado, y el sello incluye estos montos.
**Requisito previo:** el inventario de Luzuriaga tiene que estar en `conteo_cerrado` (las 3 rondas del ciclo cerradas, o el ciclo terminado antes por falta de ítems a recontar). Si todavía hay una ronda abierta, la pantalla de Liquidación no muestra nada útil ("No se pudo cargar la liquidación").
**Pantalla:** Liquidación.

**12.1 — Antes de cargar nada.**
**Tocar:** abrir la pantalla, sin tocar nada más.
**Debe leerse:** arriba de todo (antes del resumen de faltante), una tarjeta **"Ajustes del mes"** con el badge **"Sin registrar"**, el título **"Sin registrar"** y el texto **"Hasta que alguien cargue los ajustes del mes no se puede calcular el faltante neto ni cerrar la planilla. Si no hubo ajustes, cargá 0 — eso también es un dato."**.

**12.2 — Cargar los ajustes.**
**Tocar:** completar **"Ajustes a favor del personal (S/)"** (0 es válido) y **"¿De dónde salen? (obligatorio)"** con una nota (por ejemplo "mermas documentadas de agosto"); dejar **"Faltante que absorbe la empresa (S/) — opcional"** vacío para conservar el calculado. Tocar **"Guardar ajustes"**.
**Debe leerse:** el badge "Sin registrar" desaparece; el título pasa a **"S/ N en ajustes"** (N = lo que cargaste) y el texto a **"Registrado por Nancy Quispe el {fecha}."** (formato fecha/hora del teléfono). Recién ahí el resumen de abajo ("Faltante neto a descontar", "Cuota base…") deja de decir "No se puede calcular" y muestra cifras.

**12.3 — Después de liquidar (verificación PARCIAL — falta el botón).**
La app hoy **no tiene ningún botón que llame a `POST /liquidacion/inventarios/:id/liquidar`** (revisado `mobile/lib/puertos/repositorios.ts` — `RepositorioLiquidacion` no declara `liquidar()`, y no hay ninguna llamada a esa ruta en toda la carpeta `mobile/`). O sea: **no hay forma de dejar el inventario en `liquidado` desde el teléfono**, así que este último paso no se puede probar en el 2.12.0 tal como está. Queda documentado para cuando exista el botón — el texto que tiene que aparecer, verificado en `backend/src/modules/liquidacion/liquidacion.ajustes.ts`, es un cartel **"No se pudieron guardar los ajustes"** con el cuerpo **"La planilla de este inventario ya se cerró: los ajustes no se pueden cambiar. Lo que se descontó ya se descontó, y cualquier corrección entra en el periodo siguiente."** al tocar "Corregir" → "Guardar ajustes" sobre un inventario ya liquidado o lacrado.
