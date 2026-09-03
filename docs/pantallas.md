# Levantamiento de requerimiento — Mockup "Inventario Masivo 8,000 Productos (3 Conteos)"

Fuentes:
- `index.html` (raíz del proyecto, 1179 líneas) — mockup HTML entregado por el cliente. Todas las citas de línea son de este archivo salvo que se indique lo contrario.
- `Automatización del proceso de inventario.vtt` (raíz del proyecto, 3152 líneas) — transcripción WebVTT de la reunión de requisitos entre **Gilmer Roger Mendoza Sánchez** (encargado actual del proceso de inventario en Excel), **Fernando Colque Valentín** (desarrollador/analista del bot y la app) y **Oscar J. Zarzosa Tinoco** (gerencia/auditoría). Las citas indican el número de línea del `.vtt` (formato `línea:HH:MM:SS`).

Este documento cubre las 7 pantallas del mockup con datos concretos, reglas de negocio con su origen, y una sección final de preguntas abiertas. No se modificó ningún otro archivo del proyecto.

---

## Pantalla 1: "LOGIN / SELECCIÓN DE TIENDA Y ROL (8,000 PRODUCTOS)"

`index.html:172` (comentario), div `#screen-login` líneas 174-269.

**Para qué sirve:** punto de entrada de la app. El usuario elige sucursal y rol, y el sistema lo redirige a la pantalla correspondiente a ese rol (`handleLogin()`, línea 1075-1079).

**Roles reales que ofrece el mockup** (líneas 206-222, confirmado por `selectRole()` línea 1057-1073):
- **Coordinador** (`role-coordinador`) — "160 Hojas"
- **Conteo** (`role-conteo`) — "Mi Lote"
- **Auditor** (`role-auditor`) — "Gilmer"

**Datos que muestra:**
- Selector de sucursal (línea 191-196) con ítems de ejemplo:
  - Market Central Luzuriaga — 8,000 ítems, 11 colaboradores (seleccionada por defecto)
  - Market Carhuaz — 3,500 ítems
  - Market Bolívar — 4,200 ítems
  - Market Sucre — 2,800 ítems
- Usuario conectado (input, línea 229): por defecto "Coordinador General de Market"; cambia dinámicamente según el rol elegido (línea 1069-1072): Conteo → "Carlos Méndez (Asignado 20 Hojas)"; Auditor → "Gilmer Roger Mendoza (Auditor ERP)".
- Tarjeta "Snapshot Microsoft Dynamics" (línea 237-258): 8,000 ÍTEMS · 1er Conteo: 160 Hojas · Por Hoja: 50 Ítems · Estimado: ~4 Horas.

**Acciones:** elegir sucursal (select), elegir rol (3 botones), botón "Ingresar a Gestión de Hojas (8,000 Ítems)" (línea 264-267).

**Reglas de negocio (mockup + reunión):**
- 160 hojas × 50 ítems/hoja = 8,000 ítems. La cuenta cierra exactamente.
- El proceso arranca de un reporte que envía un bot configurado por Fernando, vía correo, en Excel y PDF, por sucursal (`.vtt:17-41`, `00:00:13-00:00:45`: *"inicia nace del reporte que envía... el bot que está configurado señor Fernando... envía cada sucursal el correo del conteo ya en Excel y en PDF"*).
- La hoja que reciben los colaboradores va **en blanco, sin stock** — es conteo ciego: *"para ellos el stock no se envía... prácticamente envía el conteo y hoja en blanco... y para nosotros nos envía el stock"* (`.vtt:74-95`, `00:01:19-00:01:38`).
- El stock real de cada tienda varía porque "no todos los Market tienen los mismos productos" y el bot solo saca los códigos marcados como responsabilidad "empleado" en Dynamics para esa tienda (`.vtt:2670-2692`, `00:40:39-00:40:59`). Esto explica por qué cada sucursal tiene un número de ítems distinto en el selector.

**Origen de datos:** el número de ítems por tienda y el snapshot vienen de Dynamics (vía el bot/reporte). El rol y usuario conectado son de la app.

---

## Pantalla 2: "PANEL DEL COORDINADOR (PARTICIÓN Y ASIGNACIÓN DE 8,000 ÍTEMS)"

`index.html:273` (comentario), div `#screen-coordinador` líneas 275-405.

**Para qué sirve:** el Coordinador reparte las 160 hojas entre el personal presente ese día, por zona física de tienda. Rol: **Coordinador**.

**Datos que muestra:**
- Asistencia: "8 / 11 Asistieron" (línea 298).
- Bloque de auto-distribución (línea 302-312): "20 Hojas / persona" — 160 hojas ÷ 8 colaboradores presentes = 20 hojas c/u.
- Zonas físicas de tienda con cantidad de hojas por zona (línea 324-328): Zona A Abarrotes (40), Zona B Lácteos (30), Zona C Licores (25), Zona D Almacén (65). Suma: 40+30+25+65 = 160 ✓, cierra con el total.
- Lista de hojas (ejemplo, líneas 335-393):
  - Hoja #001 · Abarrotes (Arroz & Azúcar) · Códigos 0001-0050 · Góndola A1 · asignada a Carlos Méndez · "50/50 CONTADO" · Sincronizado.
  - Hoja #002 · Abarrotes (Aceites & Fideos) · Códigos 0051-0100 · Góndola A2 · asignada a Ana Valdivia · "32/50 EN PROCESO".
  - Hoja #003 · Conservas de Pescado · Códigos 0101-0150 · Góndola A3 · asignada a Lucía Guerrero · "PENDIENTE".
  - Texto: "Mostrando 3 de 160 Hojas de Conteo (8,000 ítems en total)".

**Acciones:** botón "Repartir Hojas Automáticamente" (`autoAsignarHojas()`, línea 308-312, 1081-1087) — reparte equitativamente por zonas; filtro de zonas (botones horizontales); abrir una hoja en progreso; botón inferior "Comenzar a Contar Mi Lote Asignado" (línea 400-403) que navega a la pantalla de Conteo.

**Reglas de negocio:**
- El Coordinador **arma y distribuye las hojas y controla la asistencia, pero NO puede ver el stock ni el resultado del inventario una vez finalizado**: *"el coordinador va a sacar las hojas, va a distribuir las hojas, la asistencia, todo va a asignar al personal, pero ellos no van a poder ver el stock... no van a poder ver el resultado... eso netamente nos corresponde a mi persona [Gilmer] para poder visualizar y a Michell... solo las personas autorizadas van a poder ver el resultado"* (`.vtt:1999-2049`, `00:31:25-00:32:05`). El "Coordinador solamente va a poder designar el reporte y ver el control del personal que ha asistido" (`.vtt:2052-2063`, `00:32:05-00:32:16`).
- La lista de personal para asignar hojas se obtiene de Recursos Humanos, filtrada por asistencia: *"la lista de personas la voy a sacar de la base de tus recursos humanos... para que tú también de pasado marques la lista, cuántos vinieron y en base a ello asignes las hojas"* (`.vtt:1893-1913`, `00:29:57-00:30:11`).
- Las hojas se reparten por persona para evitar duplicar o cruzar el conteo entre colaboradores: *"para que tampoco no estén cruzándose la información o estén duplicando la información"* (`.vtt:1869-1875`, `00:29:38-00:29:43`).

**Origen de datos:** la lista de personal/asistencia viene de RRHH (según lo dicho en la reunión); la partición de 8,000 ítems en 160 hojas de 50 se genera a partir del reporte/snapshot de Dynamics. La asignación hoja↔colaborador es generada por la app (Coordinador).

---

## Pantalla 3: "CONTEO CIEGO EN TIENDA (COLABORADOR EN LOTE DE 50 ÍTEMS)"

`index.html:409` (comentario), div `#screen-conteo` líneas 411-537.

**Para qué sirve:** el colaborador registra el conteo físico de los 50 ítems de su hoja asignada, sin ver el stock del sistema (conteo ciego). Rol: **Conteo**.

**Datos que muestra:**
- Encabezado: "Hoja #002 (Lote de 50) • 1er Conteo" · "Aceites & Fideos (Góndola A2)" · progreso "32/50 contados" (línea 419-427).
- Buscador/filtro dentro de los 50 ítems de la hoja + botón "Scan" (cámara) (línea 432-441).
- Lista de productos de ejemplo (líneas 447-516):
  | Código | Barcode | Producto | Empaque | Empaque contado | Sueltas | Total |
  |---|---|---|---|---|---|---|
  | #0051 | 7750123051 | Aceite Vegetal Primor 1L | Caja x12 | 2 cajas | 0 und | 24 und |
  | #0052 | 7750999015 | Cerveza Cusqueña Trigo 310ml | Pack x6 | 5 packs | 2 und | 32 und |
  | #0053 | 7750123088 | Leche Evaporada Gloria Azul 400g | Plancha x24 | 2 planchas | 5 und | 53 und |
  | #0054 | 7750123054 | Fideos Canuto Lavaggi 500g | Fardo x20 | sin contar | — | — (botón "Contar") |
- Paginación: "Mostrando ítems 1 al 10 de 50" con solo 3 botones de página visibles (línea 519-525).

**Acciones:** filtrar/buscar dentro de la hoja; escanear código de barras (`openScannerModal()`); abrir modal de conteo por producto (`openCountModal(...)`, pasa nombre, barcode, tipo de empaque, factor, cajas y unidades actuales); botón final "Finalizar Hoja #002 y Ver Ciclo de 3 Conteos" (línea 532-535), que navega a la pantalla 4.

**Reglas de negocio:**
- El conteo es **ciego**: el colaborador no ve el stock del ERP mientras cuenta — solo ve la lista de productos a contar (`.vtt:74-95`, citado arriba).
- El registro de cantidad se hace por **empaques cerrados + unidades sueltas**, no por escaneo masivo de código de barras: Gilmer descarta el escaneo de código de barras como método principal porque el personal no puede memorizar miles de códigos y no es un inventario anual "de barrido": *"con la cámara leyendo el código de barra va a ser algo imposible porque son productos puntuales... el personal no se va a memorizar los 5000 códigos o los 2000 códigos"* (`.vtt:1650-1676`, `00:26:37-00:27:01`). El flujo que describe es: la app muestra el producto de la lista, el colaborador ingresa la cantidad y confirma (`.vtt:1679-1701`, `00:27:02-00:27:30`).
- El escaneo de código de barras sí tiene un uso, pero **secundario**: confirmar que el producto que se está contando visualmente es el correcto, no para registrar la cantidad: *"puedes escanear para confirmar que tenga ese código"* (`.vtt:1789-1791`, `00:28:40-00:28:44`); Gilmer coincide en que "apoyaría bastante... con el escáner del lector de código de barra" (`.vtt:1803-1808`).
- Punto de fricción sin resolver: Gilmer prefiere que, una vez confirmado el conteo de un producto, **no se pueda editar** (para evitar viajes extra al almacén a último momento): *"si tú le pones cuentas cuatro y ahí confirmas sí o sí... van a tener que ir con tal en el market ese producto... y van a perder un poco más de tiempo"* (`.vtt:1547-1562`, `00:25:17-00:25:31`). Fernando, en cambio, propone permitir editar posteriormente pero dejando el cambio registrado como histórico: *"por ahí se puede editar posteriormente, pero ya esa edición quede registrado como un histórico"* (`.vtt:1941-1953`, `00:30:33-00:30:45`). El mockup (`saveCount()`, línea 1151-1157) no modela ni un "confirmar y bloquear" ni un histórico de ediciones — solo guarda el conteo.
- Productos con empaque (Caja, Pack, Plancha, Fardo) llevan un factor de conversión a unidades (ej. Caja x12, Pack x6, Plancha x24, Fardo x20) — ver Modal 1 más abajo.

**Origen de datos:** la lista de 50 productos de la hoja (código, barcode, nombre, tipo/factor de empaque) viene del reporte/snapshot de Dynamics repartido por el Coordinador. Las cantidades contadas (cajas + sueltas → total) se generan en la app.

---

## Modal 1: "REGISTRO DE CONTEO CON SOPORTE DE EMPAQUES Y UNIDADES"

`index.html:919` (comentario), div `#modal-count` líneas 921-1000. Se abre desde la Pantalla 3.

**Para qué sirve:** capturar la cantidad contada de un producto en dos campos — empaques cerrados y unidades sueltas — y convertir automáticamente a unidades para Dynamics.

**Datos que muestra:** código de barras y nombre del producto; badge de empaque (ej. "📦 Caja x 12 und"); campo "Cajas Cerradas" con su factor ("Factor: 12 und/caja"); campo "Unidades Sueltas"; total convertido para Dynamics (`total-units-display`) y desglose (`breakdown-text`, ej. "2 Cajas (24 und) + 0 Sueltas").

**Acciones:** +/- en cajas y en unidades sueltas; atajos "+1 Caja", "+5 Cajas", "+5 Und", "Borrar"; botón "Guardar Registro en Hoja" (`saveCount()`).

**Cálculo:** `total = cajas × factor_empaque + unidades_sueltas` (`calcPackageTotal()`, línea 1143-1149).

**Regla de negocio relevante (de la reunión, no modelada en el mockup):** cuando el faltante o sobrante de un producto empaquetado es igual o mayor a "la mitad del paquete más uno", se contabiliza y descuenta **por paquete completo** en vez de por unidad suelta; si es menos de la mitad, se descuenta al trabajador de forma individual por unidad. Esta regla la define y ajusta el propio Gilmer, no es fija: *"si es menos de la mitad del paquete, sería para descontar al trabajador... pero si ya es más de la mitad del paquete, ya separaría lo que es para paquetes"* (`.vtt:1120-1131`, `00:18:23-00:18:37`); Oscar confirma que ese umbral "mitad más uno" lo define el auditor caso por caso, no el sistema de forma automática: *"eso lo vas a definir tu persona... si la mitad más uno es igual a un paquete... eso lo va a ir definiendo usted"* (`.vtt:2465-2481`, `00:37:39-00:37:55`). El modal del mockup no tiene ningún campo o indicador para esta regla.

---

## Modal 2: "SIMULADOR DE ESCÁNER BARCODE"

`index.html:1003` (comentario), div `#modal-scanner` líneas 1005-1034. Se abre desde la Pantalla 3 (botón "Scan").

**Para qué sirve:** simula la lectura de cámara de un código de barras. En el mockup es solo un simulador con dos botones de ejemplo ("Aceite (Caja x12)", "Cusqueña (Pack x6)") que abren el Modal 1 con esos datos precargados (`simulateScan()`, línea 1167-1170).

---

## Pantalla 4: "EL CICLO COMPLETO DE LOS 3 CONTEOS (EMBUDO DE DISCREPANCIAS)"

`index.html:541` (comentario), div `#screen-ciclos` líneas 543-633.

**Para qué sirve:** visualiza cómo se reduce automáticamente el universo de ítems a recontar en cada pasada. No tiene un rol de acceso explícito marcado en el mockup (se llega desde el flujo de Conteo, botón de la Pantalla 3); conceptualmente es información relevante para Coordinador/Auditor.

**Datos que muestra** (líneas 562-620):
- Paso 1 — 1er Conteo General (100% Catálogo): 8,000 ÍTEMS. 91.8% ok (barra verde) / 8.2% no ok (barra roja). "✓ 7,350 Cuadrados (OK)" / "✗ 650 Observados (Pasan a 2do)".
- Paso 2 — 2do Reconteo (Filtro de Diferencias): 650 ÍTEMS (13 Hojas). 80%/20%. "✓ 520 Cuadrados en 2da pasada" / "✗ 130 Persisten (Pasan a 3ro)".
- Paso 3 — 3er Reconteo Definitivo (Cierre Gilmer): 130 ÍTEMS (3 Hojas). Texto: "Conteo final auditado directamente por Gilmer Mendoza. Las cantidades resultantes se fijan para la liquidación."

**Acciones:** botón inferior "Ver Comparativo de los 3 Conteos en Auditoría" → navega a Pantalla 5.

**Verificación matemática:**
- 7,350 + 650 = 8,000 ✓ (cierra el total del 1er conteo).
- 520 + 130 = 650 ✓ (cierra el total del 2do conteo).
- 650 ÷ 50 = 13 hojas exactas ✓.
- **130 ÷ 50 = 2 hojas completas + 1 hoja parcial de 30 ítems = 3 hojas.** El mockup decía "3 Hojas" para 130 ítems y NO era un error: así lo confirmó el cliente (ver Decisiones del Cliente, punto 4) — el tamaño de hoja es configurable (20/30/50) y la cantidad de hojas siempre se calcula, con la última hoja parcial cuando el total no da exacto.
- 7,350 + 520 = 7,870 → coincide exactamente con "100% Cuadrados: 7,870 items" de la Pantalla 5. Los 130 ítems del 3er conteo son los que finalmente componen el faltante/sobrante neto reportado en Pantallas 5 y 6. Este cruce sí cierra.

**Reglas de negocio (de la reunión):**
- El ciclo de 3 conteos es exactamente el proceso descrito por Gilmer en Excel: 1er conteo → se filtran solo los que NO están OK (sobrante/faltante) → se genera un nuevo archivo en blanco solo con esos códigos para el 2do conteo → se repite el filtro para un 3er conteo (`.vtt:271-407`, `00:04:36-00:06:52`: *"filtro lo que es sobrantes y faltantes para su segundo reconteo... creo un nuevo Excel... y este Excel nuevamente se envía a recontar... de igual manera se vuelve a filtrar lo que es faltantes y sobrantes para el tercer reconteo, ya prácticamente en el tercer reconteo disminuye más"*).
- El 3er conteo es el cierre definitivo, auditado por Gilmer, y sus cantidades quedan fijas para la liquidación (no hay 4to conteo mencionado en ningún momento, ni en mockup ni en reunión).
- Fernando confirma en la reunión que este ciclo de "T uno, 2 y 3" (T1/T2/T3) es justamente lo que se debe modelar en la app (`.vtt:1338-1344`, `00:22:17-00:22:29`).

**Origen de datos:** el stock ERP (Dynamics) es el valor contra el que se comparan los 3 conteos; los 3 conteos en sí (T1, T2, T3) se generan en la app.

---

## Pantalla 5: "PANEL DE AUDITORÍA (MATRIZ COMPARATIVA DE 3 CONTEOS)"

`index.html:637` (comentario), div `#screen-auditoria` líneas 639-743.

**Para qué sirve:** el Auditor (Gilmer) revisa, ítem por ítem, la evolución de los 3 conteos frente al stock ERP y las reglas automáticas aplicadas (ej. cervezas por cuenta de la empresa). Rol: **Auditor**.

**Datos que muestra:**
- Resumen global (línea 650-663): "100% Cuadrados: 7,870 items" · "Faltante Neto: -S/ 1,850.00" · "Sobrante Neto: +S/ 460.00".
- Fila de ejemplo 1 — Arroz Superior Costeño 1kg, código 7750123004, P. Venta S/4.50, estado "FALTANTE (-2)" (línea 673-701): Stock ERP 50 → 1er Conteo 45 ✗ → 2do Conteo 48 ✓ (cuadró en el 2do) → Diferencia -S/9.00 (2 unidades × S/4.50).
- Fila de ejemplo 2 — Cerveza Cusqueña Trigo 310ml (línea 704-733), etiqueta "EMPRESA": Stock ERP 42 → 1er Conteo 30 → 3er Conteo 36 (-6) → "Cobro Tienda: S/0.00" con nota "Regla Gerencia: Asumido por Empresa (S/0 a nómina)".

**Acciones:** botón inferior "Generar Liquidación de Descuentos & Multas" → navega a Pantalla 6.

**Reglas de negocio:**
- Fórmula base: Diferencia = Conteo − Stock; si es negativo es faltante, si es positivo es sobrante (`.vtt:189-200`, `00:03:05-00:03:22`: *"sacamos si es sobrante, si es faltante, prácticamente el conteo menos el stock... da el resultado, si es faltante o sobrante"*).
- El precio usado para valorizar faltantes/sobrantes es el **precio de venta**, no el precio de compra: *"el precio es precio de venta, no es precio de compra, es precio de venta"* (`.vtt:556-557`, `00:09:21-00:09:27`).
- **Regla especial de cervezas**: por orden de gerencia, la categoría cerveza se cuenta como responsabilidad del empleado (para hacer seguimiento del producto, por robo), pero el importe faltante **lo asume la empresa**, no se descuenta a nómina: *"hay productos que se cuenta de empresa, por ejemplo las cervezas. Cuando faltan cervezas está en empleado... gerencia ha ordenado que se haga inventario mensual para poder hacer seguimiento... porque demasiado robo... lo cuentan como empleado, está en la categoría de empleado, responsable de empleado, pero se le descuenta, prácticamente se va para la empresa, no para el empleado"* (`.vtt:508-542`, `00:08:31-00:09:07`).

**Origen de datos:** Stock ERP viene de Dynamics; 1er/2do/3er Conteo se generan en la app; la clasificación "EMPRESA" vs "empleado" por categoría de producto viene precargada/configurada en Dynamics (`.vtt:2605-2615`, `00:39:37-00:39:51`: *"acá hay empresa, este producto es de empresa... ya está cargado en el sistema Dynamics, ya está alimentado"*).

---

## Pantalla 6: "LIQUIDACIÓN, NÓMINA Y MULTAS DE ASISTENCIA"

`index.html:747` (comentario), div `#screen-liquidacion` líneas 749-850.

**Para qué sirve:** calcula el descuento de nómina por colaborador a partir del faltante neto, los negativos del mes y las multas por inasistencia. No tiene un botón de rol explícito, pero por el contenido (ver nómina de todos los colaboradores) corresponde al **Auditor**.

**Datos que muestra:**
- Encabezado: "Liquidación Final Luzuriaga (8,000 Ítems)" · "Agosto 2026".
- Resumen matemático (línea 761-782):
  - Faltante Bruto (8,000 ítems): S/1,850.00
  - (-) Negativos Mes (Jocelyn): -S/310.00
  - (-) Faltante Empresa (Cervezas): -S/150.00
  - Faltante Neto a Descontar: S/1,390.00 (1850−310−150=1390 ✓)
  - Cuota Base (11 colaboradores): S/126.36/persona (1390÷11=126.36 ✓)
- Fondo Multas Inasistencia (línea 785-791): "3 faltas x S/20 = S/60 redistribuido" → "-S/7.50/asistente" (60÷8=7.50 ✓, donde 8 = 11−3 asistentes).
- Planilla de descuentos (ejemplo, líneas 799-841):
  - Carlos Méndez — Asistió • Cuota S/126.36 − Bono S/7.50 = **S/118.86**
  - Ana Valdivia — igual, **S/118.86**
  - Roberto Sánchez — Falta a Inventario (+S/20 Multa) → **S/146.36** (126.36+20=146.36 ✓)

**Acciones:** botón inferior "Proceder al Lacrado Digital (Oscar Zarzosa)" → navega a Pantalla 7.

**Verificación matemática:** todos los cálculos de esta pantalla cierran exactamente entre sí. No usan los mismos valores que el ejemplo real dado en la reunión (ver abajo), pero eso es esperable porque son datos de ejemplo, no el mismo caso.

**Reglas de negocio:**
- El faltante neto de la tienda se reparte entre **todo el personal habilitado (11)**, no solo entre quienes asistieron a contar: *"esto de acá está dividido, este importe está dividido entre 11 personas"* (`.vtt:753-756`, `00:12:40-00:12:44`).
- Quien NO asiste al inventario recibe una **multa de S/20**: *"a los que no participan en los inventarios les cae una multa prácticamente de 20 soles, si es que no van al inventario"* (`.vtt:784-791`, `00:13:13-00:13:22`).
- El fondo de esas multas se reparte entre quienes SÍ asistieron, reduciéndoles su cuota — el mecanismo (aunque no los montos) coincide exactamente con el mockup: *"esas personas que no van van a tener el descuento más, y las personas que van a tener un descuento menor... porque a ellos les va a apoyar el inventario"* (`.vtt:799-811`, `00:13:27-00:13:40`). Ejemplo real dado en la reunión (con otros números, para Luzuriaga en un mes distinto): 4 personas faltaron al 1er inventario de 11, multa = 4×20 = S/80, repartido entre los 7 asistentes = S/11.43 c/u de descuento en su cuota (`.vtt:838-868`, `00:14:07-00:14:39`).
- Los "Negativos" son ajustes de entradas/salidas de producto durante el mes (a favor del empleado), reportados por Jocelyn, con una fecha de corte fija por tienda (ej. del 29 al 28 del mes siguiente para Luzuriaga): *"si bien sabemos durante el mes se da ingreso y salida de productos... este negativo lo envía Jocelyn... no desde el 29 hasta el 23... hasta el 24"* (`.vtt:641-658`, `00:10:59-00:11:21`); *"todos los meses ya tiene, así sea del 29 al 28 del siguiente mes"* (`.vtt:2220-2227`, `00:34:36-00:34:45`).
- El monto de multa (S/20) y el criterio de reparto son iguales conceptualmente entre tiendas, pero el importe final por persona varía porque cada sucursal tiene su propio faltante, dotación y asistencia: *"en otras sucursales es diferente el importe... en Sucre es otro también, sale diferente el importe"* (`.vtt:909-930`, `00:15:15-00:15:35`).

**Origen de datos:** el faltante/sobrante bruto viene del cruce de los 3 conteos vs Dynamics (Pantalla 5); los negativos vienen de un reporte aparte que genera Jocelyn; la multa de inasistencia y el reparto se calculan en la app a partir de la asistencia registrada por el Coordinador (Pantalla 2).

---

## Pantalla 7: "APROBACIÓN, LACRADO DIGITAL & ENVÍO A DYNAMICS"

`index.html:854` (comentario), div `#screen-lacrado` líneas 856-915.

**Para qué sirve:** cierre inmutable del período de inventario: firma/aprobación de los responsables y envío del ajuste final a Dynamics. No tiene rol explícito de acceso marcado; por el contenido (aprobaciones de Gilmer y Michell) corresponde al flujo del **Auditor**.

**Datos que muestra:**
- Cita textual atribuida a "Oscar J. Zarzosa Tinoco" (línea 866-874): *"Cierras el mes, firmas, sellas y lacras. El inventario de los 8,000 ítems queda grabado de forma inmutable; cualquier ajuste posterior entra en el siguiente periodo."* — **Nota: esto es una paráfrasis del mockup, no una cita literal de la transcripción** (ver comparación abajo).
- Validaciones (línea 878-899): "Validación Gilmer Mendoza — APROBADO", "Validación Michell (Tiendas) — APROBADO", "Sincronización Dynamics ERP — LISTO PARA REGISTRO".
- Tras ejecutar el lacrado (línea 910-914): "¡INVENTARIO LACRADO EXITOSAMENTE!" · "Hash ID: #INV-2026-08-LUZ-8000-K99" · "8,000 ítems auditados y transmitidos a Microsoft Dynamics ERP."

**Acciones:** botón "Ejecutar Lacrado y Ajuste en ERP" (`ejecutarLacrado()`, línea 904-907, 1172-1176) — deshabilita el botón y muestra el mensaje de éxito.

**Reglas de negocio:**
- El concepto de "lacrado" (cerrar, firmar, sellar) viene directamente de Oscar en la reunión, con una redacción distinta a la del mockup pero el mismo sentido: *"esto vas a tener que manejarlo con una firma, con un sello... hoy es agosto, cierras agosto y cierras, firmas, sellas, lacras allí, que es esto es veredicto, esto es definido y así está grabado"* (`.vtt:2725-2744`, `00:41:32-00:41:48`).
- La inmutabilidad es explícita: un ajuste después del cierre "va a distorsionar todo el tema del histórico"; cualquier corrección debe entrar en el período siguiente: *"si mañana me dices no apareció uno que no sé que pretenda alterar lo que está grabado, eso va a ser un conflicto... tienes que regularizarlo de ahí hacia adelante"* (`.vtt:2744-2789`, `00:41:55-00:42:35`).
- Doble validación antes del ajuste a Dynamics: Gilmer y Michell — *"lo va a tener que hacer la verificación, mi persona [Gilmer], Michell"* (`.vtt:2958-2961`, `00:45:19-00:45:26`); solo tras el "100% la confirmación" se procede al ajuste: *"ya se va a tener que dar el okey, no el 100% la confirmación ya prácticamente para proceder lo que es el ajuste"* (`.vtt:2969-2975`, `00:45:30-00:45:41`).
- El ajuste a Dynamics, una vez validado, es automático y sin posibilidad de modificación posterior: *"una vez validado, todo lo que sobrantes únicos, se pasa netamente directo al Dynamo [Dynamics]. Es ajuste, ya no hay modificación, no hay nada"* (`.vtt:2231-2246`, `00:34:46-00:35:02`).
- **Importante para el alcance**: en la reunión, Gilmer y Fernando acuerdan explícitamente que la automatización de negativos y el ajuste automático a Dynamics **se dejan para una fase 2**, después de estabilizar el conteo: *"había que ver ese tema de los negativos y esto de los ajustes también lo veríamos en la siguiente fase"* (`.vtt:2253-2260`, `00:35:05-00:35:14`); *"lo optimizamos primero y ya en la siguiente fase es donde nos preocupamos por [el resto]... nos preocupamos en la parte de todos los resúmenes"* (`.vtt:2354-2366`, `00:36:14-00:36:27`). El mockup, sin embargo, presenta el envío automático a Dynamics como parte del flujo ya construido en esta Pantalla 7 — ver Preguntas Abiertas.

**Origen de datos:** el hash/ID de lacrado y el estado de las validaciones se generan en la app; el ajuste final ("registro") se envía a Dynamics.

---

## Comparación de cifras: mockup vs. reunión (hallazgo, no inconsistencia oculta)

En la reunión, Gilmer da un ejemplo real de otra sucursal: *"en Carhuaz son 927 códigos que se cuenta en Carhuaz en Market"* (`.vtt:2662-2668`, `00:40:29-00:40:38`). El mockup, en la Pantalla 1, muestra "Market Carhuaz (3,500 ítems)" (línea 193). Son números para el mismo nombre de tienda que no coinciden. Puede deberse a que el mockup usa datos de ejemplo/placeholder sin relación con la cifra real mencionada en la reunión (ambas cosas son plausibles: el catálogo total de una tienda no es lo mismo que los "códigos empleado" que se cuentan mensualmente — ver Pantalla 1). Se deja registrado como hallazgo a validar con el cliente, no se "arregla" en este documento.

---

## DECISIONES DEL CLIENTE (resueltas)

Respuestas recibidas del cliente el 2026-09-01, en respuesta a las preguntas abiertas originales (numeración según la versión anterior de este documento). Fuente: comunicación directa del cliente al equipo, no hay línea de `index.html` ni timestamp de `.vtt` que citar — se documenta tal como llegó.

1. **Michell (antes pregunta 1) — RESUELTA:** Michell es **Coordinador**. No hace falta un 4to rol. Los 3 roles quedan firmes: Coordinador, Conteo, Auditor.

2. **Escaneo de código de barras (antes pregunta 2) — RESUELTA:** el escáner es método **secundario pero necesario** — sirve para confirmar que el producto de la lista es el físico que se tiene en la mano. El flujo principal de conteo es buscar en lista e ingresar cantidad (como ya describía Gilmer en la reunión, `.vtt:1679-1701`).

3. **Edición después de guardar (antes pregunta 3) — RESUELTA:** se puede editar mientras la hoja NO esté finalizada. Existe un estado de hoja que congela el conteo. El modelo de estados de una hoja es: **pendiente / en proceso / finalizada / sincronizada**.

4. **Tamaño de hoja de reconteo (antes pregunta 4) — RESUELTA:** el tamaño de hoja es **configurable** por el usuario, con tres opciones: **20, 30 o 50 ítems por hoja** — deja de ser 50 fijo. La cantidad de hojas se **calcula siempre**, nunca se hardcodea. Cuando el total no da exacto, la última hoja queda **parcial**, y eso se indica en la interfaz. Esto confirma que el "130 ítems = 3 Hojas" del 3er conteo (Pantalla 4) NO era un error del mockup: con 50 por hoja son 2 completas + 1 parcial de 30 (ver nota corregida en la verificación matemática de la Pantalla 4, arriba). Las hojas de reconteo del 2do y 3er conteo se arman con el mismo criterio: tamaño elegido, última parcial.

5. **Ajuste automático a Dynamics (antes pregunta 5) — RESUELTA:** confirmado como **fase 2**. En la Pantalla 7, el núcleo es la aprobación y el lacrado digital; el envío a Dynamics se muestra como un paso identificado de fase 2, no como algo que la app ya ejecuta. La interfaz no debe prometer escritura automática hacia Dynamics.

6. **Autenticación del colaborador de Conteo (antes pregunta 12) — RESUELTA:** el PIN no existe en ningún sistema previo (no es de Dynamics ni de RRHH) — vive en la base de datos propia de la app. El login con PIN de 6 dígitos ya diseñado en la Pantalla 1 queda validado tal cual está.

---

## PREGUNTAS ABIERTAS

Estas son las cosas que el mockup y la reunión **no** dejan claras. Las que ya tienen respuesta del cliente pasaron a la sección "Decisiones del Cliente" de arriba; quedan pendientes:

1. **¿Cómo se determina y dónde se configura la regla de "media unidad de paquete" para faltantes/sobrantes por empaque?** Oscar aclara en la reunión que el umbral (mitad + 1 = se cuenta como paquete completo) lo define y ajusta el propio Gilmer caso por caso, no es una regla fija del sistema (`.vtt:2465-2481`). El mockup no tiene ningún campo, pantalla ni configuración para esto. ¿Es una pantalla de configuración aparte (fuera de las 7 mapeadas), un ajuste manual que hace el Auditor en la Pantalla 5, o queda fuera del alcance de esta primera fase (como los negativos)?

2. **¿Qué pasa si el 2do o 3er conteo agrega un sobrante/faltante que no existía en el conteo anterior** (por ejemplo, un producto que en el 1er conteo daba OK pero en el 2do — por error de traspaso o robo — aparece con diferencia)? Ni el mockup ni la reunión contemplan este caso; el flujo asume que el universo de discrepancias solo se reduce, nunca crece.

3. **¿Qué pasa si un colaborador asignado a hojas de conteo forma parte de la lista de "negativos" o de "empresa" (cervezas) en el mismo período?** No se define el orden de precedencia ni si estas categorías son mutuamente excluyentes en el cálculo de la Pantalla 6.

4. **¿Los "3,500 / 4,200 / 2,800 ítems" de Carhuaz, Bolívar y Sucre en la Pantalla 1 son cifras reales de Dynamics o valores de ejemplo del mockup?** Ver el hallazgo arriba (Carhuaz real serían 927 códigos según la reunión, no 3,500).

5. **¿Hay conectividad/offline a considerar?** Ni el mockup ni la reunión mencionan qué pasa si el colaborador pierde conexión a internet mientras cuenta en el almacén o en zonas sin señal dentro de la tienda. Dado que el flujo depende de sincronización en tiempo real con el backend/Dynamics, esto es crítico para el diseño de la Pantalla 3 y debe preguntarse explícitamente al cliente.

6. **¿Cómo entra Zaida/Isela (digitadoras actuales) en el flujo de la app?** La reunión describe que hoy ellas transcriben lo escaneado/contado a Excel, y que la app eliminaría ese paso (`.vtt:2153-2176`, `00:33:39-00:33:59`). ¿Desaparece su rol por completo, o se transforma en un rol de validación/soporte dentro de la app?
