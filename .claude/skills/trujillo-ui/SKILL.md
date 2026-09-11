---
name: trujillo-ui
description: >
  Sistema de diseño y controles de la app móvil de inventario Trujillo:
  tokens de marca, selects desplegables, PIN en modal, grupo segmentado,
  botón principal y marco de teléfono para maquetas HTML.
  Trigger: al crear o editar cualquier pantalla de la app de inventario
  Trujillo (maqueta HTML en mobile/design/ o componente React Native en
  mobile/), o al elegir colores, tipografía o comportamiento de un control.
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.3"
---

## When to Use

- Crear una pantalla nueva de la app de inventario (son 7 en total; la 1 es el login)
- Editar controles existentes en `mobile/design/*.html`
- Portar una maqueta validada a React Native en `mobile/app/`
- Decidir color, tipografía, espaciado o comportamiento de cualquier control

El flujo acordado con el cliente es: **maquetar en HTML → validar con capturas → recién ahí portar a React Native.**

## Critical Patterns

Reglas que salieron de bugs reales en la pantalla 1. No son preferencias.

| Regla | Por qué |
|---|---|
| `.pantalla` **debe** declarar `color: var(--app-tinta)` | Sin eso el texto sin color propio hereda el del documento, que en tema oscuro es CLARO, y desaparece sobre el fondo blanco de la app |
| Los tokens `--app-*` y de marca **nunca** cambian con el tema | La app pinta su propio mundo. Solo el lienzo que rodea al teléfono sigue el tema del visor |
| El desplegable va `position: absolute` fuera del flujo | Si ocupa espacio, al abrirse empuja todo lo de abajo y la pantalla salta |
| Los modales cuelgan de `.telefono`, no de `.campo` ni de `.pantalla` | Colgando del campo, el teclado se sale de la pantalla cuando el campo está abajo |
| Scroll con barra oculta, sin paginador | Es como se comporta una `FlatList` nativa: se desplaza, no muestra barra |
| `max-height` del desplegable **no** múltiplo de la altura de fila | El corte a media fila es lo que avisa que hay más abajo. Cortar justo hace que la lista parezca terminada |
| Ningún campo viene preseleccionado | Criterio del cliente: *un default que nadie mira es un dato que nadie verifica*. En un inventario auditado, cada dato autocompletado es un dato sin verificar |
| Un dato derivado se muestra, no se elige | El rol sale del padrón de la persona. Si el que cuenta puede auto-asignarse Auditor, el control de los 3 conteos no vale nada |
| Iconos de campo en gris (`.icono`) | El rojo se reserva para chevron, selección y acciones |
| El logo va como PNG real embebido en data URI | Nunca recrear el wordmark con fuentes parecidas |
| El rojo de marca (`--rojo`) es la ACCIÓN, nunca un estado | Los estados usan la paleta semántica (`--ok`, `--proceso`, `--espera`); si el rojo también fuera "en proceso" competiría con el llamado a la acción |
| El estado se comunica por **al menos dos vías** además del texto | En una lista de 160 filas el ojo escanea, no lee: badge + color del código de hoja (`.hoja-codigo`) + borde de la tarjeta (`.hoja.contada` / `.hoja.en-proceso`) refuerzan la misma señal |
| Una tarjeta de lista con **2 o más acciones** las pone en un speed dial flotante, **nunca apiladas dentro de la card** | Las acciones dentro de cada card multiplican el alto de la lista (una fila de botones por ítem) y compiten con el contenido que uno vino a leer. El flotante deja la lista limpia y da **una sola zona de acción**, siempre en el mismo lugar del pulgar |
| `--pad-lateral` es la única fuente del margen lateral | La leen `.pantalla`, `.toast`, `.chips` y `.accion-fija`. Una pantalla operativa usa `<div class="telefono denso">` (14px); el default es 26px |
| Todo texto visible va en **español latino neutro con tuteo** | Pedido explícito del cliente. Nada de voseo rioplatense: *ingresa* y no *ingresá*, *elige* y no *elegí*, *intenta de nuevo* y no *intentá*, *aquí* y no *acá*, *a ti* y no *a vos*. Se coló dos veces después del barrido, así que cada texto nuevo se revisa antes de commitear. Solo aplica a lo que la persona ve o escucha (incluye `accessibilityLabel`); comentarios e identificadores quedan como están |
| Un control que no cambia nada **se saca** — si un campo dejó de aceptarse, el input se saca de la pantalla, no se deja "por las dudas" | Aparecieron dos: un selector de rol que era decorativo (el rol sale de la sesión) y un selector de tamaño de hoja que no viajaba en la petición — el servidor ya usaba el tamaño del primer conteo. Un tercer caso, más caro: los campos de "ajustes a favor del personal" y "faltante de empresa" tipeados a mano en Liquidación siguieron vivos en la pantalla después de que el servidor dejó de leerlos (el Excel de Dynamics y la clasificación de productos los reemplazaron) — el Auditor tipeaba un monto que se aceptaba y se ignoraba en silencio. Un control muerto le hace creer a la persona que está decidiendo algo |
| Si la tarjeta abre algo al tocarla, **no lleva botón** | El botón "+ Contar" repetía la acción de la tarjeta, comía ancho del nombre del producto y multiplicaba el alto de la lista. Antes de sacar un botón: confirmar que la tarjeta ya es táctil, y dejarle `accessibilityRole="button"` con un label que diga qué abre |
| Cantidades: **campo numérico**, no botones de incremento | Cargar 300 unidades con `+1` son 300 toques. Con teclado numérico son dos. Los atajos de empaque quedan como opción, nunca como único camino |
| Filtros en **modal con selector buscable** cuando las opciones pueden crecer | Los chips en fila funcionan con 3 categorías y se rompen con 100. El modal aguanta los dos extremos con lista buscable y desplazamiento |
| El bloque de **configuración** no se mezcla con el contenido operativo | En la pantalla de hojas, el armado (catálogo, crear, repartir) convivía con la lista en un mismo desplazamiento. La configuración va en su propia entrada del menú, o se colapsa a una línea de resumen cuando ya está hecha — y vuelve a abrirse sola cuando hace falta otra vez, derivado del estado real y no de un interruptor manual |
| Una acción irreversible **dice qué queda firme** antes de ejecutarse | "Esto cierra la planilla: los descuentos quedan firmes y solo un auditor puede lacrar después. No se puede deshacer." La confirmación nombra la consecuencia y la cifra, no pregunta "¿Estás seguro?" |

### Honestidad de los datos en pantalla

De lejos, la familia de bugs más cara de la app: **números y estados que mienten**. Ninguno lo vio un test; todos aparecieron mirando la pantalla con datos reales.

| Regla | Por qué |
|---|---|
| Un **vacío nunca se muestra como éxito** | El panel de auditoría dijo "10 de 10 cuadrado" y "Cuadró en 3er", en verde, con cero conteos cargados. Sin dato no es coincidencia: es *sin contar*, con su propio estado y color neutro. Nada en verde sin dato que lo respalde |
| Sin red, un dato que no se pudo traer es **"—"**, nunca `0` | Inicio mostraba "0 hojas · 0 ítems" con 25 hojas reales, y usaba ese 0 como denominador de un porcentaje. Un cero inventado es peor que un guion honesto |
| Ningún texto nombra una **ronda fija** | Había literales de "2do conteo" en el bloque de la 3ra, y un paso cerrado que seguía diciendo "todavía no empezó". El ordinal y el estado salen de la ronda real; en la última ronda no hay "siguiente conteo", hay cierre |
| No se inventan datos que parezcan reales | "Zona ACONDICIONADORES · Góndola 001" se derivaba de la categoría y del número de hoja. Nadie los había cargado, así que confundían más de lo que ayudaban |
| Los nombres que vienen del ERP se muestran **tal cual** | La app pluralizaba el empaque ("Emp.45s"). Si Dynamics dice `Emp.45`, en pantalla dice `Emp.45` |
| La cuenta que se **muestra** es la que se **guarda** — y si dos pantallas muestran el mismo número, salen de la MISMA función, nunca de dos copias de la fórmula | El total del modal se calculaba aparte del desglose. Un solo cálculo, o el día que difieran nadie va a saber cuál creer. Y la conversión va a la vista: `2 Emp.45 × 45 = 90` + `3 sueltas` → `93 und`. La misma trampa cruzó de pantalla: el encabezado de Liquidación mostraba 60 y la planilla que se firmaba usaba 10, porque cada uno armaba el neto con su propia copia de la fórmula |
| Un total sale del **conjunto completo**, no del filtrado | El avance de la hoja sigue siendo el de la hoja aunque haya un filtro puesto; si se muestra el del filtro, se dice que es del filtro |
| Una pantalla que lee de la copia local **pide al servidor cuando hay red** | El Coordinador veía "Quedan 20 hojas sin finalizar" horas después de que se finalizaran en otro teléfono, y el Ciclo mostraba "sin datos" con 22 conteos cargados. La copia local es para seguir trabajando sin señal, no la fuente de verdad |
| **Mismo nombre, mismo número**: si una cifra no es la misma que otra, no puede llevar el mismo rótulo | La matriz de Auditoría decía "Faltante neto" en una columna que era el faltante bruto de ESE ítem, no el neto de la liquidación (que resta negativos, empresa y sobrante del mes entero). Dos cifras con el mismo nombre y distinto valor le hacen creer a quien lee que está mirando la misma cosa |
| Las etiquetas y avisos **nunca hablan de detalles técnicos** (endpoint, backend, servidor, API) | Un aviso le decía al Auditor que "faltaba un endpoint del backend" para poder liquidar. Quien usa la app no sabe qué es un endpoint y no tiene por qué: el texto dice qué falta hacer en TÉRMINOS DEL NEGOCIO ("todavía no se cargaron los ajustes del mes"), nunca en términos de la implementación |
| Una **regla de negocio no se disfraza de error**: si reintentar no va a funcionar nunca, el mensaje no dice "vuelve a intentar" | El inventario mensual duplicado (una tienda que ya tenía su inventario del mes) decía "El servidor tuvo un problema. Vuelve a intentar" — una invitación a reintentar algo que iba a fallar siempre. El mensaje nombra la regla real ("Market Bolívar ya tiene su inventario de septiembre") para que la persona sepa que no es un problema técnico, es un hecho |

### Frescura y avisos

| Regla | Por qué |
|---|---|
| **Ningún dato depende de cerrar sesión** para actualizarse | El Coordinador abría la ronda 3 y los contadores seguían viendo la 2 hasta reiniciar la app. Toda pantalla recarga al enfocarse y al volver la app a primer plano; las listas además con "tirar para refrescar" |
| Refrescar **no pisa** lo que la persona está haciendo | Si hay un modal de conteo abierto o una edición en curso, el refresco espera. Y jamás borra trabajo local sin sincronizar |
| Se navega por **identidad**, no por el número visible | Los números de hoja se repiten en cada ronda: al cambiar de ronda, "Hoja #001" llevaba a la hoja de otra persona, con los mismos productos a la vista y cada conteo rechazado. Si la hoja abierta ya no pertenece a la ronda activa, se saca de la vista y se dice por qué |
| Un aviso va **donde se puede actuar** | Un rechazo de una hoja ajena pintaba de rojo el Inicio de cualquiera. El Inicio dice cuántas hojas propias faltan subir; el motivo puntual vive en la hoja que lo causó |
| **Pendiente ≠ rechazado ≠ sin red** | "1 ítem sin sincronizar" se mostraba igual para algo que iba a subir solo y para algo que el servidor ya había rechazado y no iba a entrar nunca. Cada estado con su texto, su color y su acción; un fallo de red deja el ítem pendiente, un 4xx lo marca rechazado con el motivo del servidor |

### Filtros

Modal con selectores buscables combinables (categoría/nombre/código en Contar; persona/estado/número en Gestión de hojas) — reglas que salieron de construir el de Contar y de la verificación que pidió el cliente.

| Regla | Por qué |
|---|---|
| Las opciones de un filtro salen **SOLO del conjunto abierto** (la hoja, la ronda) — nunca de la tabla que comparte el teléfono | `hojas_estructura`/`productos_estructura` son tablas COMPARTIDAS del dispositivo (si el Coordinador bajó `todas`, ahí quedan las hojas de todos los contadores): un filtro que mirara la tabla entera en vez de la hoja abierta mezclaría categorías, nombres o códigos de otra ronda o de otro colaborador, rompiendo el conteo ciego. Se blindó con un test que siembra una hoja ajena (otra ronda, otro colaborador) y comprueba que nada de ella se cuela — y para confirmar que el test protege de verdad, se rompió a propósito el filtro por `hoja_id` de la consulta: el test falló al toque. Se revirtió el sabotaje antes de commitear |
| Los selectores de un filtro combinable van **EN CASCADA**: cada uno ofrece lo que sigue siendo posible con los OTROS filtros YA aplicados | Calcularlos sobre el filtro completo (los tres campos a la vez) deja al propio campo viendo una sola opción: la que ya tiene puesta. Si un valor elegido deja de tener sentido con el cambio de otro campo, se limpia solo — nunca queda un filtro puesto que no corresponde a ninguna fila. Ojo con la trampa: los campos que NO cambiaron se revalidan solo contra el que cambió, nunca entre sí, o uno invalida al otro en falso |
| Las opciones de un select buscable van **ordenadas ascendente**, alfabético natural en español (`localeCompare('es')`) | Salían en el orden en que aparecen los datos (el de la góndola), que no ayuda a encontrar un valor puntual en una lista larga. Los códigos, si son numéricos, se ordenan por su VALOR (`localeCompare` con `numeric: true`): que `100010` no quede antes que `9` |
| El campo de búsqueda de un select buscable **nunca lleva `autoFocus`** | El teclado se abría solo al entrar al modal y tapaba la pantalla antes de que la persona tocara nada que lo pidiera. Aparece recién cuando toca el campo |
| El modal de un filtro combinable **aprovecha el ancho de pantalla** (margen lateral coherente con `--pad-lateral`) y sus desplegables **FLOTAN** sobre lo de abajo, nunca lo empujan | Un modal angosto con ancho fijo dejaba aire de sobra en pantallas anchas y cortaba nombres largos. Es el mismo patrón que ya pide esta skill para los selects de la pantalla 1 ("El desplegable va `position: absolute` fuera del flujo", más arriba) — el de Contar se había construido en acordeón (empujando los campos de abajo) y se corrigió para que coincida |
| Un valor o una opción que no entra **trunca al final**, nunca al medio | Cortar al medio ("SAPOLIO LIMPIATODO...NTIBACTERIAL") es ilegible; al final, la persona sigue reconociendo el producto por como empieza el nombre |
| El total de la pantalla sigue siendo del **conjunto completo** aunque haya un filtro puesto | Reafirma la regla de "Honestidad de los datos en pantalla" de más arriba — el modal de filtros es justo la superficie donde más fácil se confunde "lo que veo filtrado" con "el total real". Si se muestra el del filtro, hay que decir que es del filtro |
| Una prop que cambia el comportamiento de un componente **compartido** entre pantallas va **opt-in, con default igual al comportamiento de siempre** | El select buscable de Contar y el de Gestión de hojas (Coordinador) son el MISMO componente. Sacarle el `autoFocus` o hacerle flotar la lista para uno sin este criterio habría cambiado el otro sin que nadie lo pidiera ahí — la prop nueva queda en `false` (o el valor de siempre) por defecto, y solo la pantalla que la necesita la prende |

### Paleta

Valores tomados del PNG del logo, no estimados a ojo.

| Token | Valor | Uso |
|---|---|---|
| `--rojo` | `#D82018` | Marca, opción seleccionada, segmentado activo, acción principal |
| `--rojo-hover` | `#B81810` | Presionado |
| `--rojo-suave` | `#FDF0EF` | Hover de opciones |
| `--dorado` | `#F8B818` | Estrellas, flecha del botón, ícono del toast |
| `--app-tinta` | `#1C1917` | Texto, puntos del PIN, toast |
| `--app-gris` | `#6B6560` | Subtítulos y metadatos |
| `--app-gris-cl` | `#9A938D` | Placeholders e iconos de campo |
| `--app-borde` | `#E3DEDA` | Bordes de control |

Fondo de app: blanco puro `#FFFFFF`. Tipografía: **Figtree** para UI, **Baloo 2** para acentos de marca (hace eco del wordmark redondeado).

Cualquier color nuevo sobre el que vaya texto blanco tiene que dar **≥ 4.5:1** de contraste. Verificarlo antes de proponerlo, no después.

### Paleta de estados

Semántica, no de marca. Sale de la pantalla 2 (hojas de conteo). El rojo de marca sigue siendo la acción, nunca un estado.

| Estado | Token | Hex | Contraste |
|---|---|---|---|
| Contado | `--ok` / `--ok-suave` | `#0A6B57` / `#E7F4EF` | 5.71:1 |
| En proceso | `--proceso` / `--proceso-suave` | `#8A5A05` / `#FDF3DC` | 5.37:1 |
| Sin asignar | `--espera` / `--espera-suave` | `#6B6560` / `#F2EFED` | 5.02:1 |
| Faltante | `--falta` / `--falta-suave` | `#A23B2E` / `#FBEAE7` | 6.56:1 / 5.63:1 |

`--riel` (`#EDE9E6`) es el fondo neutro de las barras de progreso.

## Controles

Markup mínimo de cada uno. El CSS completo está en [assets/controles.css](assets/controles.css).

**Select desplegable** — el `.campo` es el ancla de posicionamiento:

```html
<div class="campo">
  <label id="lbl-suc">Sucursal</label>
  <button type="button" class="control" id="btn-sucursal"
          aria-labelledby="lbl-suc" aria-expanded="false" aria-haspopup="listbox">
    <svg class="icono" ...></svg>
    <span class="valor vacio" id="val-sucursal">Selecciona una sucursal</span>
    <svg class="chevron" ...></svg>
  </button>
  <div class="lista" id="lista-sucursal" role="listbox" aria-labelledby="lbl-suc" hidden></div>
</div>
```

Opción, con subtítulo y estado seleccionado:

```html
<button type="button" class="opcion" role="option" aria-selected="false">
  <span>Market Carhuaz<span class="meta">6 colaboradores</span></span>
</button>
```

**Modal** — hijo directo de `.telefono`, después de `.pantalla`:

```html
<div class="modal" id="modal-x" role="dialog" aria-modal="true" aria-labelledby="titulo-x" hidden>
  <div class="modal-fondo" id="fondo-x"></div>
  <div class="modal-caja">
    <div class="modal-cabecera">
      <h3 id="titulo-x">Título</h3>
      <button type="button" class="modal-cerrar" aria-label="Cerrar">…</button>
    </div>
    <!-- contenido -->
  </div>
</div>
```

Se cierra por **cuatro** caminos: fondo, ✕, `Escape` y al completarse la tarea.

**Grupo segmentado** (dato derivado) — `.inerte` mientras no hay dato:

```html
<div class="rol-cabecera">
  <label id="lbl-rol">Rol</label>
  <span class="nota">Lo define la persona</span>
</div>
<div class="roles inerte" id="roles" role="group" aria-labelledby="lbl-rol">
  <div class="rol">COORD.</div>
  <div class="rol activo" aria-current="true">CONTEO</div>
  <div class="rol">AUDITOR</div>
</div>
```

Son `<div>`, no `<button>`: no se eligen.

**Grupo segmentado elegible** (`.segmentado`/`.segmento`) — visualmente parecido a `.roles`, pero es lo opuesto: acá SÍ hay una elección real, por eso son `<button>`:

```html
<div class="segmentado" id="selector-tamano" role="group" aria-label="Tamaño de hoja">
  <button type="button" class="segmento" data-tam="20">20 ítems</button>
  <button type="button" class="segmento" data-tam="30">30 ítems</button>
  <button type="button" class="segmento activo" data-tam="50">50 ítems</button>
</div>
```

`.roles` vs `.segmentado` — la pregunta que decide cuál usar: *¿este dato lo elige quien mira la pantalla, o ya viene decidido por otra parte del sistema?*

| | `.roles` | `.segmentado` |
|---|---|---|
| Markup | `<div>` | `<button>` |
| El dato... | ya está derivado (rol del padrón) | lo elige la persona ahora (tamaño de hoja) |
| Se puede tocar | no | sí |
| Ejemplo | rol de quien ingresó (pantalla 1) | tamaño de hoja para un reconteo (pantalla 4) |

Usar `.roles` para un dato derivado que solo se muestra rompe nada; usar `.segmentado` para eso — con `<button>` reales — abre la puerta a que alguien se auto-asigne un dato que no le corresponde elegir.

**Acción principal** — deshabilitada hasta que el formulario esté completo:

```html
<button type="button" class="ingresar" id="btn-ingresar" disabled>
  Ingresar
  <svg ...></svg>
</button>
```

**Barra de contexto** (`.barra-app`) — sede, cifras y salida, arriba de toda pantalla operativa:

```html
<div class="barra-app">
  <div class="contexto">
    <p class="rotulo">Gestión masiva</p>
    <p class="sede">Market Central Luzuriaga</p>
    <p class="cifras">160 hojas · 8.000 ítems · 12 asignadas</p>
  </div>
  <button type="button" class="salir" aria-label="Cerrar sesión">…</button>
</div>
```

**Tarjeta** (`.tarjeta`) — contenedor de bloque con cabecera opcional:

```html
<div class="tarjeta">
  <div class="tarjeta-cabecera">
    <svg class="icono" ...></svg>
    <h2>Personal presente</h2>
    <span class="badge ok">8 / 11 presentes</span>
  </div>
  <!-- contenido -->
</div>
```

**Badge de estado** (`.badge`) — sin clase es "espera"; `.ok` y `.proceso` son los otros dos:

```html
<span class="badge ok">50 / 50 contado</span>
<span class="badge proceso">32 / 50 en proceso</span>
<span class="badge">Sin asignar</span>
```

**Chip de filtro** (`.chip`) — grupo horizontal con scroll oculto:

```html
<div class="chips" role="group" aria-label="Filtrar por zona">
  <button type="button" class="chip" aria-pressed="true">Todas (160)</button>
  <button type="button" class="chip" aria-pressed="false">Zona A: Abarrotes (40)</button>
</div>
```

**Hoja de conteo** (`.hoja`) — la clase de estado (`.contada` / `.en-proceso`, ninguna para sin asignar) tiñe borde, código y barra de progreso a la vez que el badge:

```html
<article class="hoja en-proceso">
  <div class="hoja-cuerpo">
    <span class="hoja-codigo">H002</span>
    <div class="hoja-datos">
      <div class="hoja-titulo">
        <h3>Hoja #002 · Yogures</h3>
        <span class="badge proceso">32 / 50 en proceso</span>
      </div>
      <span class="hoja-meta">Códigos 0051 - 0100 · Góndola B1</span>
      <div class="progreso"><span style="width:64%"></span></div>
    </div>
  </div>
  <div class="hoja-pie">
    <span class="quien">Asignado: <strong>Elena Príncipe</strong></span>
    <button type="button" class="abrir">Abrir hoja</button>
  </div>
</article>
```

**Acción fija** (`.accion-fija`) — flota sobre el borde inferior de `.pantalla.scroll`, con degradé para no tapar el contenido de golpe:

```html
<div class="accion-fija">
  <button type="button" class="accion" id="btn-contar">
    Comenzar a contar mi lote
  </button>
</div>
```

**Tab bar** (`.tab-bar`) — navegación principal inferior, por rol. Cuelga de `.telefono` con `position:absolute`, igual que `.accion-fija`, con altura fija en `--tabbar-alto` (60px):

```html
<nav class="tab-bar" aria-label="Navegación principal">
  <button type="button" class="tab activo" data-destino="/inicio">
    <span class="tab-indicador" aria-hidden="true"></span>
    <svg class="icono">...</svg>
    <span class="tab-etiqueta">Inicio</span>
  </button>
  <!-- resto de tabs, mismo patrón -->
</nav>
```

**Regla `.accion-fija` vs. `.tab-bar`** — ambos compiten por el mismo borde inferior; esta regla evita que cada pantalla lo resuelva distinto:

| El botón fijo... | Resultado |
|---|---|
| navega a una sección **paralela** (algo que ya es o debería ser un tab) | el tab bar lo **reemplaza** — duplicar la misma navegación en dos controles es ruido, no refuerzo |
| confirma o cierra algo **de esta pantalla** (guardar, enviar, finalizar) | **conviven, apilados** — `.accion-fija` se apoya justo arriba del tab bar con `bottom: var(--tabbar-alto)`, y el `padding-bottom` de `.pantalla.scroll` crece para no esconder el último ítem detrás de los dos |

Ejemplo: en `home.html` el acceso "Ir a Mis hojas" del Conteo dejó de ser `.accion-fija` porque duplicaba el primer tab — el tab bar lo absorbió. En cambio "Finalizar hoja" en `conteo.html` sí conviviría apilado, porque cierra esa pantalla puntual, no navega a otra sección.

**Banda de sincronización** (`.banda-sync`) — estado offline-first; los equipos son WiFi de tienda, sin datos móviles, así que toda pantalla con datos sincronizados la necesita visible. Sin clase extra es "ok"; `.pendiente` y `.offline` son los otros dos:

```html
<div class="banda-sync ok" id="banda-sync" role="status" aria-live="polite">
  <svg class="icono-sync" ...></svg>
  <span id="texto-sync">Sincronizado con Dynamics · hace 4 min</span>
</div>
```

**Acción secundaria** (`.accion-mini`) — variante compacta de `.accion` para una fila (no ocupa el ancho completo):

```html
<button type="button" class="accion accion-mini" id="btn-aprobar-gilmer">Aprobar</button>
```

**Resumen de cifras clave** (`.resumen-global`) — tira de KPIs; `strong.ok` / `strong.falta` tiñen el valor:

```html
<div class="resumen-global">
  <div class="resumen-dato">
    <span class="resumen-etiqueta">Cuadrado tras 3 pasadas</span>
    <strong class="ok">7.870 ítems <span class="resumen-pct">(98,4%)</span></strong>
  </div>
</div>
```

**Botón flotante de acciones (speed dial)** — el patrón para las acciones de una tarjeta de lista. Validado por el cliente en `usuarios.html` y `tiendas.html`.

**CUÁNDO usarlo**

| Situación | Qué va |
|---|---|
| Una tarjeta de lista con **2 o más** acciones (editar, desactivar, resetear…) | **Speed dial flotante** |
| Una sola acción por tarjeta, y es la razón de ser de la fila (ej. "Abrir hoja") | La tarjeta entera es el botón — no hace falta control aparte |
| La acción es de la PANTALLA, no de un ítem (ej. "Nueva tienda", "Finalizar hoja") | `.accion` arriba o `.accion-fija` abajo, **no** el speed dial |

**Por qué**, y no es estética: con los botones dentro de la card, cada ítem crece una fila entera de controles. En una lista de sucursales son 40px extra por tarjeta que empujan el contenido y hacen scrollear el doble para leer lo mismo; y los botones compiten visualmente con el dato que uno vino a mirar. El flotante saca las acciones de la lista y las concentra en **una sola zona**, siempre en el mismo lugar de la pantalla.

**SELECCIONAR y DESPUÉS actuar.** El FAB **no existe** hasta que hay un ítem seleccionado: se toca la tarjeta (se marca con `.seleccionada`: borde `--rojo` y fondo `--rojo-suave`), y recién ahí aparece el botón. Tocarla de nuevo deselecciona. Sin selección no hay botón, así que **el speed dial nunca puede actuar sobre "nada"**.

**Y tiene que decir SOBRE QUÉ actúa.** Con el menú abierto, las opciones tapan media pantalla y la tarjeta resaltada puede quedar fuera de vista. Si la acción es grave —desactivar una tienda con sus colaboradores y su inventario— el nombre del ítem va en una pill de contexto arriba de las opciones (`.speed-dial-contexto`). Un speed dial que no dice sobre qué actúa es como se desactiva la tienda equivocada.

**Colores** — FAB rojo con icono **blanco**; cada acción es un círculo **gris** (`--riel`) con icono **negro** (`--app-tinta`) y una pill blanca al lado. Las opciones nunca son rojas: el rojo es del FAB y hay uno solo, si todas fueran rojas ninguna se leería como la principal. **La acción destructiva es la excepción**: icono y texto en `--rojo`, sin volver al círculo rojo completo.

```html
<div class="speed-dial-contenedor" id="speed-dial" hidden>
  <div class="speed-dial-acciones">
    <!-- Pill de contexto: SOBRE QUE item se va a actuar -->
    <span class="speed-dial-contexto" id="speed-dial-nombre">Market Bolívar</span>

    <button type="button" class="speed-dial-fila" aria-label="Editar tienda">
      <span class="speed-dial-etiqueta">Editar tienda</span>
      <span class="speed-dial-btn"><svg ...></svg></span>
    </button>

    <!-- Destructiva: etiqueta e icono en rojo -->
    <button type="button" class="speed-dial-fila" aria-label="Desactivar tienda">
      <span class="speed-dial-etiqueta destructiva">Desactivar</span>
      <span class="speed-dial-btn destructivo"><svg ...></svg></span>
    </button>
  </div>
  <button type="button" class="speed-dial-fab" aria-label="Acciones de tienda" aria-expanded="false">
    <svg ...></svg>
  </button>
</div>
```

El contenedor se muestra al seleccionar (`hidden` mientras no haya selección) y se despliega con la clase `.abierto`. El icono del FAB rota 90° al abrir y cambia a una X. Fuera del menú abierto, una capa transparente a pantalla completa lo cierra al tocar afuera.

En React Native es el mismo diseño con `Animated` (ver `components/pantallas/UsuariosScreen.tsx` y `app/administrador/tiendas.tsx`): `speedDialContenedor` en `position: absolute` con `bottom: ALTO_TAB_BAR + insets.bottom + 28`, y **como hermano del scroll, nunca adentro** — dentro del `ScrollView` el absoluto queda recortado y se desplaza con el contenido.

Guardá el **id** del seleccionado, no el objeto: la lista se recarga después de cada acción, y un objeto guardado queda viejo.

### Trampas del listener global

El cierre por click-fuera tiene que excluir los modales, o tocar dentro de uno cierra los desplegables:

```js
document.addEventListener('click', function (e) {
  if (!e.target.closest('.campo') && !e.target.closest('.modal')) cerrarListas();
});
```

## Commands

```bash
# Pantalla nueva, con CSS y logo ya embebidos
python .claude/skills/trujillo-ui/assets/nueva-pantalla.py conteo \
  --titulo "Conteo de góndola" --numero 3

# Revisar una maqueta antes de darla por buena
python .claude/skills/trujillo-ui/assets/verificar.py mobile/design/login.html
```

`verificar.py` chequea lo que se rompe en silencio al editar a mano: etiquetas sin cerrar, ids duplicados, ids que el JS busca y no existen, tokens CSS muertos, colores fuera de la paleta, el `color` de `.pantalla` y la sintaxis del JS. **Correrlo después de cada tanda de cambios.**

Para editar una maqueta existente: escribir un script Python con reemplazos exactos y ejecutarlo. Los heredocs de bash con JS adentro rompen el quoting.

## Resources

- **[assets/controles.css](assets/controles.css)** — sistema completo, listo para pegar
- **[assets/pantalla-base.html](assets/pantalla-base.html)** — esqueleto con marcadores `__CSS__`, `__LOGO__`, `__TITULO__`
- **[assets/nueva-pantalla.py](assets/nueva-pantalla.py)** — instancia la plantilla
- **[assets/verificar.py](assets/verificar.py)** — auditoría de la maqueta
- **Referencia viva**: `mobile/design/login.html` — pantalla 1, validada con el cliente
- **Referencia viva**: `mobile/design/hojas.html` — pantalla 2, en validación (origen de la paleta de estados y de `.barra-app`, `.tarjeta`, `.badge`, `.chip`, `.hoja`, `.accion-fija`)
- **Referencia viva**: `mobile/design/ciclo-conteos.html` — pantalla 4, origen de `--falta`, `.banda-sync` y `.segmentado`/`.segmento`
- **Referencia viva**: `mobile/design/auditoria.html` y `mobile/design/liquidacion.html` — pantallas 5 y 6, origen de `.resumen-*`
- **Referencia viva**: `mobile/design/lacrado.html` — pantalla 7, origen de `.accion-mini` y `.persona-datos`
- **Logo**: `mobile/assets/logo-trujillo.png`
- **Flujo de negocio**: `index.html` en la raíz (mockup de las 7 pantallas)
