# Auditoría funcional — app-inventario (APK inventario-v1.2.0)

Fecha: 2026-09-03 · Auditor: sesión `app-inventario-brain` · Encargo del orquestador `app-inventario-orch`.
Alcance: las 9 pantallas portadas a React Native (Expo SDK 55), la capa `lib/` (dominio, puertos, adaptadores en memoria), las 9 maquetas validadas en `mobile/design/` y el APK `inventario-v1.2.0.apk`.
Regla de trabajo: no se modificó código. Todo lo que dice "verificado" lo miré yo en código, capturas, bundle del APK o salida de herramientas; lo que no pude mirar está en la sección "Qué no pude verificar".

---

## 1. Veredicto

**Sin bloqueantes. Las dos reglas de negocio se sostienen.** Conteo ciego: ninguna pantalla del rol Conteo muestra stock del ERP, el total de 8.000 ni el avance global de 160 hojas. Dynamics fase 2: la interfaz visible no promete escritura en Dynamics.

**Listo para validar hoy con el Coordinador y el Contador, siguiendo un guion (sección 7). NO está listo para mostrar el cierre del Auditor de punta a punta**: el botón "Ejecutar lacrado digital" no se puede habilitar con los datos sembrados (I-1), y el botón "Ir a aprobación y lacrado" del panel de auditoría muestra un alert de "se porta en una próxima tarea" aunque la pantalla existe (I-2).

Conteo de hallazgos:

| Severidad | Cantidad |
|---|---|
| Bloqueante | 0 |
| Importante | 6 |
| Menor | 15 |

Tres arreglos cortos cambiarían el veredicto a "listo completo": I-2 (una línea: navegar en vez de alert), I-1 (ajuste de semilla) e I-3 (refrescar tabs al enfocar). Ninguno lo toco yo: decisión del orquestador.

---

## 2. Qué verifiqué y con qué

| Afirmación del orquestador | Resultado | Evidencia |
|---|---|---|
| 62 tests verdes | ✅ | `npx vitest run` en `mobile/`: 4 archivos, 62 tests, 168 ms, exit 0 |
| `tsc --noEmit` limpio | ✅ | exit 0, sin salida |
| APK 125,8 MB de las 05:33 | ✅ | `inventario-v1.2.0.apk` 125.832.036 bytes, 05:33:27; idéntico en tamaño al `android/app/build/outputs/apk/release/app-release.apk` (05:33:14) |
| El APK contiene el código actual | ✅ | Ningún archivo de `mobile/app`, `components`, `lib`, `app.config.ts` es más nuevo que el APK (último cambio: `ModalConteo.tsx` 05:32:06). El bundle Hermes dentro del APK contiene las cadenas nuevas ("Total contado", "Volver a mis hojas", "Hojas repartidas") y NO contiene "Total para Dynamics" |
| "Dynamics" fuera del modal del Contador | ✅ | `components/ui/ModalConteo.tsx:164` dice "Total contado"; bundle sin "Total para Dynamics"; captura `emu-conteo-modal-producto.png` |
| `verificar.py` sobre las maquetas | ✅ | 9/9 "Todo limpio" (login, home, hojas, mis-hojas, conteo, ciclo-conteos, auditoria, liquidacion, lacrado) |
| "Finalizar hoja" abre su modal | ✅ | Capturas de las 05:28 y 05:30 muestran el modal "Finalizar hoja #002 · Quedan 18 de 50 ítems sin contar"; código en `app/conteo/contar.tsx:275` y `:298-321` (overlay hermano del ScrollView) |
| 3 roles recorridos en emulador, logcat sin FATAL | ⚠️ no re-verificable | No hay emulador corriendo (`adb devices` vacío). Las 13 capturas `emu-*.png` muestran las 9 pantallas renderizadas sin errores visibles |
| Cifras: 160×50, zonas, 20 por persona, 8.000→650→130, 11 colaboradores | ✅ (ver sección 5) | Semilla en `lib/adaptadores/_compartido.ts`, `sesion-memoria.ts`, capturas |

Herramientas: `npx tsc --noEmit`, `npx vitest run`, `python verificar.py` ×9, `aapt2 dump badging`, inspección del `assets/index.android.bundle` del APK (búsqueda de cadenas ASCII y UTF-16), lectura completa de `mobile/app`, `mobile/components`, `mobile/lib`, cuerpo HTML+JS de las 9 maquetas, `docs/pantallas.md`, `SKILL.md`, `AGENTS.md`, y las 15 capturas PNG.

---

## 3. Regla de negocio 1a — Conteo ciego

**Resultado: se sostiene.** No encontré ninguna filtración.

Qué revisé, por capa:

- **Dominio.** `Producto` (`lib/dominio/tipos.ts:31-38`) no tiene campo de stock. `ItemAuditoria` (el único tipo con `stockErp`, `tipos.ts:140-156`) solo lo consumen `app/auditor/auditoria.tsx` y `components/ui/TarjetaItemAuditoria.tsx`. Grep de `stockErp|precioVenta` en `app/` y `components/`: solo esos dos archivos y `scanner-demo.tsx` (ver I-5).
- **Puertos.** `RepositorioHojas.mias()` vs `todas()` (`lib/puertos/repositorios.ts:40-50`). `todas()` se llama únicamente desde `InicioScreen.tsx:67` (rama `coordinador`) y `app/coordinador/hojas.tsx:132`. Las tres pantallas de Conteo (`conteo/index.tsx` → `InicioScreen`, `mis-hojas.tsx:37`, `contar.tsx:78`) usan solo `mias()`.
- **Pantallas del rol Conteo.** Grep de `8\.000|8000|\b160\b|7\.870|650|130` en `app/conteo/*`: cero coincidencias. `BarraApp` recibe `cifras` propias: "Hoja #002 · Lote de 50 ítems" (Inicio), "20 hojas · 1000 ítems · 1 en proceso" (Mis hojas), sin cifras en Contar (`contar.tsx:222`). El bloque "Tu avance" muestra solo su hoja y sus hojas pendientes (`InicioScreen.tsx:137-157`). `TarjetaProducto` y `ModalConteo` muestran únicamente empaques, sueltas y total contado. El escáner simulado ofrece solo productos de la hoja (`ModalEscaner.tsx:76-79`) y rechaza códigos ajenos (`contar.tsx:176-186`).
- **Rutas.** `RolTabsLayout.tsx:27-29` redirige a nivel de layout si el rol de la sesión no coincide con el grupo: un Contador no puede montar `/coordinador/*` ni `/auditor/*` (donde sí viven 8.000, 160 y el ERP).
- **Capturas.** `emu-conteo-inicio.png`, `emu-conteo-mis-hojas.png`, `emu-conteo-contar.png`, `emu-conteo-modal-producto.png`: sin totales globales ni ERP.

Riesgo latente (no es filtración hoy): `repositorioInventario.activo()` devuelve `items` (8.000) y `totalHojas` (160) a cualquier rol, e `InicioScreen.tsx:64` los guarda en estado también para Conteo aunque no los renderiza. No hay barrera de tipo: una línea mal puesta en el futuro los mostraría. Lo anoto como observación, no como hallazgo.

---

## 4. Regla de negocio 1b — Dynamics es fase 2

**Resultado: se sostiene en la interfaz visible.** Dos observaciones, ninguna bloqueante.

- `app/auditor/lacrado.tsx:220-241`: tarjeta "Envío a Dynamics" con badge "Pendiente", texto "El ajuste automático a Dynamics es una funcionalidad de **fase 2**. Por ahora, el equipo de TI registra manualmente el resultado lacrado en el ERP", botón "Marcar como registrado manualmente" deshabilitado hasta lacrar. El puerto `marcarRegistradoEnDynamics` (`lacrado-memoria.ts:126-134`) solo pone un booleano; no hay ningún `fetch` a Dynamics en `lib/`.
- `app/coordinador/hojas.tsx:241-242`: "Es una lectura del catálogo — no escribe ni ajusta nada en Dynamics" (coincide con `hojas.html:621`).
- `ModalConteo.tsx:164`: "Total contado" (la maqueta `conteo.html:916` todavía dice "Total para Dynamics"; la app ya no). Bundle del APK sin "Total para Dynamics".

Observaciones:
1. **I-5**: la ruta muerta `app/scanner-demo.tsx:574` dice "Total para Microsoft Dynamics:" y viaja dentro del APK. No es alcanzable desde la UI, sí por deep link.
2. **M-10**: los textos "Sincronizado con Dynamics", "confirmá que hay sincronización con Dynamics", "sin sincronizar con Dynamics" (`lacrado.tsx:128-131,150`, `lacrado-memoria.ts:117`, `CicloScreen.tsx:150`) describen la sincronización de las hojas como si fuera contra Dynamics. Son herencia literal de las maquetas validadas (`lacrado.html:725,775`, `ciclo-conteos.html:719`), así que no lo cuento como violación, pero bajo la regla "no prometer escritura en Dynamics" conviene decidirlo.

---

## 5. Coherencia de datos

| Cifra | Esperado | En la app | ¿Cierra? |
|---|---|---|---|
| 160 hojas × 50 = 8.000 | 8.000 | Semilla `_compartido.ts:60-67`: 2000+1500+1400+1200+1100+800 = 8.000; `partirEnHojas(8000, 50)` → 160 | ✅ |
| Zonas 40+30+28+24+22+16 = 160 | 160 | Góndolas A1–A40, B1–B30, C1–C28, D1–D24, E1–E22, F1–F16 (`armarZonasYGondolas`); Hoja #002 = "Abarrotes (Góndola A2)" como en la maqueta | ✅ |
| 160 / 8 contadores = 20 | 20 | `repartir()` en bloques contiguos; captura `emu-coord-hojas.png`: "20 hojas por persona" | ✅ |
| 8.000 → 650 → 130; 7.350 (91,9 %); 520 (80 %); 7.870 = 98,4 % | | `CicloScreen.tsx:126-139`: 7,350 (91.9%), 520 (80%), 130 (20%), 7,870 / 8,000 (98.4%). Inicio del Auditor: 7870 / 8000 (98.4%), 130 por auditar | ✅ (650 y 130 son constantes en código, no salen de un puerto — documentado en `CicloScreen.tsx:89-99`) |
| 11 colaboradores = 8 conteo + 1 coordinador + 2 auditores | | `sesion-memoria.ts:26-38`: ids 102,104,105,107,108,109,110,111 conteo; 101 coordinador; 103 y 106 auditores. Liquidación: "11 colaboradores", "Asistieron (8)", "Faltaron (3)" | ✅ |
| Liquidación: 2.200 − 380 − 170 = 1.650; 1.650/11 = 150,00; 3×20/8 = 7,50; asistió 142,50; faltó 170,00 | igual a `liquidacion.html` | `liquidacion-memoria.ts` calcula lo mismo; captura `emu-coord-liquidacion.png` | ✅ |
| Auditoría vs Liquidación en soles | 2.200 en ambas (maquetas) | Auditoría: faltante neto **−S/ 24,00**, empresa −S/ 36,40. Liquidación: faltante bruto **S/ 2.200,00**, empresa S/ 170,00 | ❌ ver I-4c |
| Inicio Auditor "130 por auditar" vs Panel de auditoría | | Panel: "3 ítems auditados · 2 con diferencia"; Lacrado: "8,000 ítems auditados" | ❌ ver I-4b |
| Inicio Coordinador 34/160 finalizadas vs Ciclo | | Ciclo: los 3 pasos "Finalizada" y "Sincronizada" | ❌ ver I-4a |
| Mis hojas del Contador vs maqueta | 1 en proceso + 19 pendientes | 1 en proceso + 19 "Finalizada" con 0/50 | ❌ ver I-4d |

---

## 6. Hallazgos

### Importantes

**I-1 · El lacrado no se puede ejecutar con los datos sembrados: el botón queda deshabilitado para siempre.**
- Dónde: `lib/adaptadores/lacrado-memoria.ts:53` (`todoSincronizado` exige que las 160 hojas tengan `sync === 'sincronizado'`) y `:116-118`; siembra en `lib/adaptadores/_compartido.ts:310-321` (solo las 34 finalizadas quedan sincronizadas, 126 quedan `local`); `app/auditor/lacrado.tsx:121` (`puedeLacrar`).
- Reproducir: ingresar como Gilmer Quispe (Luzuriaga) → Inicio → "Aprobación y lacrado" → banda "Pendiente de sincronizar · esperando WiFi de tienda" → tocar "Aprobar" en Gilmer y en Rosa → badge "2 / 2 aprobado" → el botón "Ejecutar lacrado digital" sigue gris; el texto dice "falta sincronización con Dynamics (WiFi de tienda)". No existe ninguna acción en la app que sincronice esas 126 hojas: solo la #002 puede finalizarse (única con catálogo) y aun así quedarían 125.
- Evidencia: `emu-auditor-lacrado.png` (banda pendiente + botón gris); `emu-coord-inicio.png` ("126 hojas sin sincronizar"). La maqueta `lacrado.html:849-862` tenía el atajo "Simular reconexión WiFi" para llegar al estado `ok`; la app no tiene equivalente.
- Consecuencia: el punto de no retorno del Auditor, el hash y "Marcar como registrado manualmente" no se pueden mostrar al cliente.
- Opciones (decisión del orquestador): sembrar todas las hojas menos la #002 como `sincronizado`, o exigir sincronización solo de las hojas finalizadas.

**I-2 · "Ir a aprobación y lacrado" en el panel de auditoría muestra un alert de "se porta en una próxima tarea", pero la pantalla ya existe.**
- Dónde: `app/auditor/auditoria.tsx:72-74` (`irALacrado` → `Alert.alert(...)`) y `:161-163` (botón). La ruta existe: `app/auditor/lacrado.tsx`, acceso en `components/navegacion/accesos.ts:27`.
- Reproducir: Gilmer → tab "Auditoría" → scroll al final → tocar "Ir a aprobación y lacrado".
- Evidencia: la cadena "Esta pantalla se porta en una próxima tarea" está dentro del bundle del APK.
- Es exactamente la clase de "promesa vacía" que describiste. Arreglo: `router.push('/auditor/lacrado')`. Nota: la maqueta `auditoria.html:772-776` ahí lleva a "Generar liquidación", que en la app es del Coordinador; el destino correcto en la app es el lacrado.

**I-3 · Después de "Finalizar hoja", los tabs ya montados (Inicio, Mis hojas) siguen mostrando la hoja en proceso.**
- Dónde: `components/pantallas/InicioScreen.tsx:51-81` (carga una sola vez por sesión), `app/conteo/mis-hojas.tsx:27-44` (ídem). No hay `useFocusEffect` ni recarga al enfocar en ningún archivo de `app/` ni `components/` (grep). Los tabs de React Navigation permanecen montados una vez visitados.
- Reproducir: María Rojas → Inicio muestra "Hoja #002 · 32 / 50 ítems" y banda "1 hoja sin sincronizar" → tab "Mis hojas" → tab "Contar" → "Finalizar hoja #002" → "Sí, finalizar" (la hoja pasa a finalizada y sincronizada; Contar muestra "Volver a mis hojas") → tab "Inicio": sigue "32 / 50" y "1 hoja sin sincronizar" → tab "Mis hojas": #002 sigue "En proceso 32/50".
- No lo pude ejecutar en emulador (no hay uno corriendo); lo afirmo por código: no existe ningún camino de refresco.
- Consecuencia: el cliente finaliza la hoja, vuelve al inicio y la app le dice que sigue en proceso.

**I-4 · La historia de datos se contradice entre pantallas de la misma sesión.** En las maquetas cada pantalla era una foto estática independiente; en la app conviven y se leen juntas.
- a) Coordinador: Inicio "Hojas finalizadas 34 / 160 (21%)" y "126 hojas sin sincronizar" (`emu-coord-inicio.png`) vs Ciclo "Paso 1 · 1er Conteo General — Finalizada", "Paso 2 — Finalizada", "Paso 3 — Finalizada", "Sincronizada" (`emu-coord-ciclo.png`). Origen: badges fijos en `CicloScreen.tsx:51,210,218` y constantes `:127-128`.
- b) Auditor: Inicio "3er conteo cerrado · Por auditar 130 ítems · 7870 / 8000" (`InicioScreen.tsx:166-174`) vs Auditoría "3 ítems auditados · 2 con diferencia" (`auditoria-memoria.ts:32-39`, 3 ítems) vs Lacrado "8,000 ítems auditados" (`lacrado.tsx:138`). Capturas `emu-auditor-inicio.png`, `emu-auditor-auditoria.png`, `emu-auditor-lacrado.png`.
- c) Soles: Auditoría "Faltante neto −S/ 24.00 · Asumido por la empresa −S/ 36.40" vs Liquidación "Faltante bruto S/ 2,200.00 · Faltante empresa S/ 170.00". En las maquetas cerraba (`auditoria.html:743` y `liquidacion.html:720`, ambas 2,200).
- d) Contador (María Rojas): 19 tarjetas "Finalizada" con "0/50" y detalle "Sin catálogo cargado todavía", cabecera "32 / 1000 ítems contados" con barra al 3 % (`emu-conteo-mis-hojas.png`); Inicio "Tus hojas sin empezar 0 de 20". La maqueta validada cuenta otra historia: 1 en proceso + 19 "Pendiente · Se habilita cuando termines la Hoja #002" (`mis-hojas.html:873,902-904`) y "19 de 20" (`home.html:980`). Origen: `estaFinalizadaEnDemo` (`_compartido.ts:283-285`) marca #001 y #003–#035, que caen dentro del bloque de María (#001–#020); la tarjeta arma "Finalizada" + "Sin catálogo cargado todavía" en `TarjetaHoja.tsx:43-49`.
- Reproducir: recorrer Inicio → Ciclo (Coordinador); Inicio → Auditoría → Lacrado (Auditor); Inicio → Mis hojas (María).
- Sugerencia: elegir las 34 hojas finalizadas fuera del bloque del contador de demo (por ejemplo #041–#074) para que Coordinador y Contador cierren a la vez; para Ciclo e Inicio del Auditor, derivar de datos o rotular explícitamente como ejemplo.

**I-5 · Ruta muerta `scanner-demo` empaquetada en el APK, con "Total para Microsoft Dynamics", modelo de datos paralelo y sin protección de sesión.**
- Dónde: `app/scanner-demo.tsx` (1.000 líneas, validador de escáner v1.0.0), registrada en `app/_layout.tsx:54`; `lib/types.ts` (modelo paralelo: `ProductoCatalogo` con `precioVenta`/`esEmpresa`, `ItemConteo` con `totalUnidades` almacenado en `:37`, contra la regla del dominio "el total nunca se guarda", `tipos.ts:44-48`). Ningún archivo de la app la enlaza; solo `_layout.tsx` y el README.
- Evidencia: bundle del APK contiene "Total para Microsoft Dynamics", "scanner-demo" y "Validador de Escáner".
- Reproducir: `adb shell am start -a android.intent.action.VIEW -d "inventario://scanner-demo"` (scheme en `app.config.ts:7`) abre la pantalla sin login y pide permiso de cámara.
- Arreglo: borrar `app/scanner-demo.tsx`, `lib/types.ts` y la `Stack.Screen`, o moverlo fuera de `app/`.

**I-6 · "Doble validación" sin identidad: un solo auditor aprueba por los dos.**
- Dónde: `app/auditor/lacrado.tsx:167-188` (un botón "Aprobar" por auditor, sin comparar con `sesion.colaborador.id`); `lacrado-memoria.ts:82-103` valida que el id sea auditor de la sucursal, no que sea quien está logueado.
- Reproducir: Gilmer → Lacrado → tocar "Aprobar" en la fila de Rosa Melgarejo → "1 / 2 aprobado" sin que Rosa haya entrado.
- Es herencia de la maqueta (`lacrado.html:713-720`, validada así) y facilita la demo desde un solo teléfono, pero convierte el control de dos personas en un botón doble. Lo marco importante por ser regla de negocio; la decisión es tuya/del cliente.

### Menores

**M-1 · Formato de números inconsistente entre pantallas y con las maquetas.** Inicio Coordinador/Auditor: "8000 ítems", "7870 / 8000" (`InicioScreen.tsx:124,169,172` sin formatear); Hojas, Ciclo, Lacrado: "8,000", "7,350 (91.9%)" (`Intl.NumberFormat('es-PE')` en Android); maquetas: "8.000", "7.350 (91,9%)", "98,4%". Mis hojas: "1000 ítems" (igual que la maqueta). Capturas `emu-coord-inicio.png` vs `emu-coord-hojas.png`. Falta un formateador único en `lib/` y confirmar con el cliente la convención (Perú usa oficialmente 8,000.00; las maquetas usan 8.000).

**M-2 · Código muerto que igual viaja en el APK.** `InicioScreen.tsx:96-104`: rama `Alert.alert(titulo, 'Esta pantalla se porta en una próxima tarea.')` inalcanzable (todos los accesos de `accesos.ts` tienen `ruta`) con comentario desactualizado ("Liquidación y Lacrado todavía no se portaron"); `InicioScreen.tsx:210-214`: "Esperando datos…" inalcanzable (con inventario cargado siempre hay filas). Ambas cadenas están en el bundle.

**M-3 · "Finalizar hoja" queda inline al final de las 50 tarjetas, no como acción fija.** `contar.tsx:270-278`; la maqueta la tiene en `.accion-fija` (`conteo.html:868-870`) y `SKILL.md` la cita como el ejemplo de acción que "convive apilada" sobre el tab bar. El contador tiene que desplazar 50 tarjetas para finalizar. Mismo caso: CTA "Ver comparativo…" en Ciclo del Auditor (`CicloScreen.tsx:234-244`).

**M-4 · Overlays en JS: el tab bar sigue activo debajo del modal y el botón atrás de Android no los cierra.** `ModalConteo.tsx:68`, `ModalEscaner.tsx:36`, confirmación de finalizar `contar.tsx:298-321`: `absoluteFillObject` dentro de la pantalla, sin `BackHandler` (grep: ninguno en `app/` ni `components/`). Captura `emu-conteo-modal-producto.png`: tabs "Inicio / Mis hojas / Contar" nítidos y tocables bajo el fondo atenuado. `TecladoPin` y la confirmación del lacrado sí usan `Modal` nativo con `onRequestClose`. `SKILL.md` exige cierre por cuatro vías.

**M-5 · Acoplamiento latente: `hojas-memoria.ts:21` llama a `sesionMemoria.sesionActiva()` directo, no al puerto.** Si se activa `sesionApi` en `contenedor.ts`, `mias()` devuelve `[]` y el Contador no ve hojas. El comentario de `contenedor.ts:33-34` ("Nada más cambia") no es cierto. Menos grave: `_compartido.ts:302`, `inventario-memoria.ts:52`, `liquidacion-memoria.ts:48`, `lacrado-memoria.ts:95` usan `sesionMemoria.colaboradores()` directo (datos estáticos).

**M-6 · `contar.tsx:46`: `numeroActivo` se inicializa una sola vez desde `params.numero`.** Con el tab "Contar" ya montado, abrir otra hoja desde Mis hojas no cambia de hoja. Hoy no se nota (solo la #002 tiene catálogo); latente.

**M-7 · Versión.** El APK se llama v1.2.0 pero `aapt2` reporta `versionName='1.0.0' versionCode='1'` (`app.config.ts:7,17`); el login muestra "v1.0.0". El README exige subir `version`/`versionCode` antes de publicar.

**M-8 · `mobile/README.md` desactualizado.** Describe la app como "Validador de Escáner" y `lib/types.ts` como contratos de dominio.

**M-9 · "¿Olvidaste tu clave?" termina en "Todavía no está disponible en esta versión."** `app/index.tsx:173`. Es honesto, pero es un link que no lleva a nada; decidir si se saca.

**M-10 · Wording "sincronización con Dynamics".** Ver sección 4. `lacrado.tsx:128-131,150`, `lacrado-memoria.ts:117`, `CicloScreen.tsx:150` (este último nunca se ve: `BandaSync` se oculta en estado `ok`). Heredado de las maquetas; sugerencia: "con el servidor".

**M-11 · Fidelidad menor contra las maquetas (todas visibles, ninguna rompe nada).** Mis hojas: sin "Códigos xxxx-xxxx" en hojas sin catálogo (la maqueta lo calcula por rango, `mis-hojas.html:852-856`) y con zona/góndola en el título (la maqueta solo "Hoja #003"). Inicio: sin badge en la tarjeta de estado ("21% finalizado" / "1 hoja en proceso" / "130 con diferencia", `home.html:966-986`) ni contador "3 accesos"; "Contando ahora 2 colaboradores" (derivado) vs "8 de 11". Auditoría: zona "Abarrotes" para Leche y Cerveza (maqueta: "Lácteos", "Licores · Cervezas", `auditoria.html:815,821`) porque los 3 ítems se toman de la Hoja #002. Liquidación: orden de filas por id (Gilmer tercero) vs maqueta; Rosa "Auditor" (maqueta "Auditora"); sin banda de sincronización; sede "Liquidación · Market Central Luzuriaga" vs "Liquidación Final Luzuriaga (8.000 ítems)". Conteo: "Empaque: 5 Cajas" y atajos "+1 Caja / +5 Cajas" para Pack, Plancha y Fardo (`TarjetaProducto.tsx:61`, `ModalConteo.tsx:133-141,167`): heredado literal de `conteo.html:909-910,1162,1219`.

**M-12 · El hash del lacrado usa el mes actual.** `lacrado-memoria.ts:67-74` → "#INV-2026-09-…" mientras el período liquidado es "Agosto 2026" (maqueta: "#INV-2026-08-LUZ-8000-K99"). Solo visible si el lacrado se ejecuta (hoy no, ver I-1).

**M-13 · TODOs abiertos del design system.** Falta el token `--falta` en `lib/theme.ts` (`BandaSync.tsx:36-40`, `CicloScreen.tsx:64-67`, `TarjetaItemAuditoria.tsx:44`): el badge "Faltante definitivo" sale gris y "offline" usa el mismo color que "pendiente"; `AvanceFila.tsx:28-30` hardcodea `#EDE9E6`; `sesion-api.ts:24-27` TODO de `apiUrl`.

**M-14 · Sin estado vacío en Mis hojas.** Un contador de Carhuaz/Bolívar/Sucre ve "Mostrando las 0 hojas asignadas · 0 en proceso · 0 finalizadas · 0 pendientes" (`mis-hojas.tsx:106-111`) en vez de un `EmptyState` como el de Contar.

**M-15 · Fecha del snapshot.** `hojas.tsx:241` usa `toLocaleString('es-PE')`: en el emulador (zona UTC) muestra "1/9/2026, 14:41:00" para un dato guardado como 09:41 −05:00 (`_compartido.ts:287`); la maqueta muestra "01/09/2026, 09:41" (`hojas.html:944`). En un teléfono en hora de Lima saldrá 9:41, pero el formato sigue distinto.

### Observaciones de higiene (no son hallazgos)

- `emu-conteo-finalizar-modal.png` y `emu-finalizar-abierto.png` son el mismo archivo (md5 `5bc5ce56…`). Según el orquestador fue a propósito al corregir una captura mal nombrada. Convendría dejar una sola.
- Las 15 capturas son 13 `emu-*.png` + 2 `emulador-*.png` (login y PIN).

### Observaciones sobre las maquetas (no son bugs de la app)

- `conteo.html:1357-1358`: al finalizar, el CTA pasa a "Ver ciclo de 3 conteos" → `ciclo-conteos.html`, que muestra 8.000 ítems y 7.350 cuadrados. En la maqueta eso rompería el conteo ciego. La app hace lo correcto ("Volver a mis hojas", `contar.tsx:270-273`). Conviene corregir la maqueta antes de volver a mostrársela al cliente.
- `liquidacion.html:704` lleva rótulo "Auditoría · Liquidación y nómina" y cierra la sesión de Gilmer, pero `home.html:897-902` asigna la liquidación al Coordinador, y `docs/pantallas.md` (Pantalla 2) recoge de la reunión que el Coordinador "no puede ver el stock ni el resultado del inventario". La app sigue a `home.html`. Ver pregunta P-1.
- `home.html` cuenta la historia de Conteo con Elena Príncipe y hojas #002–#021; la app reparte por dominio y la Hoja #002 le toca a María Rojas (#001–#020). Para la demo, la persona de Conteo es María, no Elena.

---

## 7. Limitaciones de la demo y guion sugerido para hoy

No son bugs (son decisiones documentadas de "no inventar datos"), pero el cliente las va a tocar si no se guía la demo:

1. **Solo Market Central Luzuriaga tiene datos.** En Carhuaz, Bolívar y Sucre el Coordinador recibe el alert "Todavía no hay catálogo de Dynamics cargado para esta sucursal" (`inventario-memoria.ts:37`) y Conteo/Auditor ven "Todavía no hay un inventario en curso". El login ofrece las 4 sucursales.
2. **Cualquier PIN de 6 dígitos entra** (`sesion-memoria.ts:91-94`).
3. **Conteo: solo María Rojas tiene una hoja con catálogo (#002).** Los otros 7 contadores ven "No tenés ninguna hoja para contar" y todas sus tarjetas deshabilitadas.
4. **Todo vive en memoria:** cerrar la app reinicia sesión y conteos.
5. **El lacrado no se puede ejecutar** (I-1) y el botón del panel de auditoría no lleva al lacrado (I-2).
6. Escáner simulado y filtro por `bounds` pendiente: ya conocidos.

Guion que funciona hoy tal cual: José Tarazona (Coordinador) → Inicio → Hojas (wizard ya completo) → Ciclo → Liquidación. María Rojas (Conteo) → Inicio → Mis hojas → Hoja #002 → contar Lavaggi, corregir Aceite, escanear un código propio y el ajeno, finalizar (y no volver a Inicio después, por I-3). Gilmer Quispe (Auditor) → Inicio → Auditoría (filtros) → Ciclo → Lacrado desde el Inicio (aprobar dos veces; explicar que el lacrado espera sincronización).

---

## 8. Qué no pude verificar y por qué

- **Recorrido en emulador y logcat.** No hay emulador corriendo (`adb devices` vacío; `adb` no está en el PATH, lo tomé del SDK). No pude confirmar "logcat sin FATAL" ni ejecutar I-3, M-4 y M-6 en vivo. Los tres están afirmados por lectura de código, con el camino de reproducción escrito arriba.
- **Backend (`backend/`).** No lo revisé: `sesion-api.ts` no está enchufado (`contenedor.ts:36`), así que no afecta al APK.
- **Formato de `Intl` en Hermes** para otras cifras: solo tengo las que aparecen en capturas ("8,000", "7,350", "91.9%", "S/ 2,200.00").
- **Comportamiento del botón atrás de Android** con los overlays en JS (M-4): afirmado por ausencia de `BackHandler`, no ejecutado.

---

## 9. Preguntas para el orquestador

- **P-1.** ¿Está confirmado por el cliente que el **Coordinador** ve la liquidación (montos a descontar por persona)? `home.html` se la asigna; `docs/pantallas.md` (reunión, `.vtt:1999-2049`) dice que no puede ver resultados. La app sigue a `home.html`.
- **P-2.** La doble validación del lacrado: `docs/pantallas.md` (Pantalla 7, decisión 1) dice Gilmer + **Michell (Coordinador)**; la maqueta y la app usan dos **auditores** (Gilmer + Rosa). ¿Cuál vale? Afecta a I-6.
- **P-3.** Convención numérica: ¿"8.000 / 98,4 %" (maquetas) o "8,000 / 98.4 %" (Android es-PE)? Afecta a M-1.
- **P-4.** ¿Se elimina `scanner-demo` + `lib/types.ts` antes de la validación (I-5)?

---

## 10. Decisiones del orquestador (2026-09-03, el cliente no estaba disponible)

| Pregunta | Decisión | Estado |
|---|---|---|
| P-1 Coordinador ve la liquidación | Se queda como está, siguiendo `home.html` (maqueta validada por el cliente: "Asigna las 160 hojas y liquida el inventario"). | Anotado como pregunta para el cliente, con la cita de la reunión (`.vtt:1999-2049`). |
| P-2 Segundo validador del lacrado | Se queda con dos auditores (Gilmer + Rosa). Razonamiento: Michell es Coordinador y un Coordinador que no ve resultados no puede aprobar un cierre de auditoría. | Elevado al cliente, sin respuesta. |
| P-3 Convención numérica | Unificar a la de las maquetas: "8.000" y "98,4 %". | Va a arreglo (M-1). **Ver la advertencia de abajo.** |
| P-4 `scanner-demo` | Se borra, junto con `lib/types.ts`. | Va a arreglo (I-5). |

**Van a arreglo ahora:** I-1 (semilla del lacrado), I-2 (`router.push` en vez del alert), I-3 (refrescar al enfocar), I-4d (las 34 finalizadas fuera del bloque de María), I-5 (borrar `scanner-demo`), M-1 (formato numérico).

**No se tocan, y por qué:** I-6 (doble validación sin identidad: herencia de maqueta validada, permite la demo desde un teléfono; queda con prioridad alta para el cliente). I-4 a/b/c (requieren decidir de qué dato se deriva cada cifra: diseño de datos, no arreglo; va con guion).

### Advertencia sobre P-3 / M-1, verificada antes de que se aplique el arreglo

La convención "punto de miles, coma decimal" **no es la de `es-PE`**. Evidencia:

- ICU 77 (Node 24): `Intl.NumberFormat('es-PE')` → `8,000`, `10,000`, `98.4`, `2,200.00`. Con `es-ES` → `8000`, `98,4`. Es decir, el "8,000 / 91.9%" que renderizó Android en `emu-coord-hojas.png` y `emu-coord-ciclo.png` **es** el formato peruano; el "8.000 / 98,4 %" de las maquetas es el de España.
- Las propias maquetas usan la convención peruana para dinero: `liquidacion.html:720` "S/ 2,200.00", `auditoria.html:743` "-S/ 2,200.00", `auditoria.html:818` "S/4.80 = -S/24.00". Y en la misma maqueta conviven "Liquidación Final Luzuriaga (8.000 ítems)" con "S/ 2,200.00" (`liquidacion.html:705,720`).

Consecuencia para el agente que arregle M-1: si aplica "punto de miles, coma decimal" también a los soles, la liquidación pasará a mostrar "S/ 2.200,00", que contradice la maqueta validada y la costumbre peruana. Recomendación concreta:

1. Cantidades (ítems, hojas, porcentajes): "8.000", "7.870", "98,4 %", como decidió el orquestador (es lo que el cliente validó).
2. Dinero: mantener "S/ 2,200.00" y "S/ 4.80" tal cual las maquetas. No tocar `liquidacion.tsx`, `auditoria.tsx` ni `TarjetaItemAuditoria.tsx` en este punto.
3. Un solo formateador en `lib/` (por ejemplo `formato.ts` con `cantidad()`, `porcentaje()`, `soles()`), sin `Intl.NumberFormat('es-PE')` suelto en las pantallas ni números crudos en `InicioScreen`.
4. Elevar al cliente la contradicción interna de sus maquetas (cantidades en formato español, dinero en formato peruano) como pregunta P-3 bis.

---

## 11. Plan de re-auditoría (pendiente del aviso de recompilación)

Cuando llegue el APK nuevo, verificar solo lo tocado y que nada de lo ya verificado se haya roto:

| Arreglo | Qué comprobar | Cómo |
|---|---|---|
| I-1 semilla del lacrado | Con Gilmer: ambas aprobaciones → botón "Ejecutar lacrado digital" habilitado → modal → lacrado con hash → "Marcar como registrado manualmente" habilitado. La banda del Coordinador ya no dice "126 hojas sin sincronizar" (debería decir 1, la #002). | Leer `_compartido.ts` y `lacrado-memoria.ts`; capturas nuevas si las hay. |
| I-2 botón de auditoría | `auditoria.tsx` navega a `/auditor/lacrado`; la cadena "Esta pantalla se porta en una próxima tarea" desaparece del bundle (también la rama muerta de `InicioScreen`, si la limpiaron). | Grep + inspección del bundle. |
| I-3 refresco al enfocar | `useFocusEffect` (o equivalente) en `InicioScreen`, `mis-hojas.tsx` y, si aplica, `contar.tsx`; con la bandera `vigente` para no setear estado tras desmontar; sin bucles (deps estables). | Lectura de código. |
| I-4d hojas finalizadas | `estaFinalizadaEnDemo` fuera de #001–#020. María: 1 en proceso + 19 pendientes, "Tus hojas sin empezar 19 de 20", cabecera "32 / 1000". Coordinador: sigue 34/160 (21 %). Revisar a quién le tocan ahora las finalizadas y que "Contando ahora" siga siendo coherente. | Lectura de `_compartido.ts` + recuento a mano. |
| I-5 scanner-demo | `app/scanner-demo.tsx`, `lib/types.ts` y la `Stack.Screen` borrados; README actualizado; bundle sin "Total para Microsoft Dynamics", "scanner-demo", "Validador de Escáner". `expo-camera` puede quedar en `app.config.ts` (se usará después). | Glob + grep + bundle. |
| M-1 formato | Un solo formateador; "8.000 / 98,4 %" en Inicio, Hojas, Ciclo, Lacrado; dinero sigue "S/ 2,200.00". Sin `Intl.NumberFormat` suelto ni números crudos. | Grep `NumberFormat|toFixed|\$\{.*items` + lectura. |
| Regresión | `npx tsc --noEmit` limpio, `npx vitest run` 62+ verdes, `verificar.py` 9/9 (si tocaron maquetas), conteo ciego (grep de 8.000/160/stockErp en `app/conteo`), Dynamics fase 2 (bundle sin "Total para Dynamics"), tabla de cifras de la sección 5. | Mismos comandos de la sección 2. |
| APK nuevo = código nuevo | Timestamp del APK posterior a todos los fuentes; tamaño igual al `app-release.apk` del build; bundle Hermes con las cadenas nuevas (buscar en ASCII y UTF-16LE). | `date -r`, `wc -c`, script `inspeccionar_apk.py`. |
