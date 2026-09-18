/**
 * El sello del mes: como se arma, como se hashea y -- sobre todo -- como se
 * VERIFICA. CERO Prisma aca (solo `node:crypto`), misma razon que
 * historial.calculos.ts: es el control mas importante del sistema y tiene
 * que poder testearse sin base de datos.
 *
 * La idea de fondo: el lacrado no es "poner un cartel de cerrado". Es
 * calcular una huella del contenido del inventario y guardarla junto al
 * contenido que la produjo. Con eso, cualquiera puede volver a calcularla
 * mas adelante y saber si algo se movio. Sin `contenido` guardado, el hash
 * seria un numero magico irreproducible; sin serializacion canonica, el
 * mismo contenido daria hashes distintos segun el orden en que salieron las
 * claves del objeto y la verificacion daria falsos positivos todo el tiempo.
 */

import { createHash } from 'node:crypto';

/**
 * Version del formato de `contenido`. Ver `armarContenidoLacrado`.
 *
 * v1 -> v2 (liquidacion v2, 2026-09): se agrega `resultado.montoSobranteEmpleado`
 * y `diferencias[].esEmpresa` al contenido sellado -- son plata y
 * clasificacion que ahora SI puede moverse despues del cierre (el Auditor
 * reclasifica al liquidar), asi que tienen que quedar bajo el hash como el
 * resto de la planilla.
 *
 * v2 -> v3 (asistencia registrada por dia, 2026-09-18): se agrega
 * `resultado.diasDelInventario` y `liquidaciones[].diasAsistidos`.
 *
 * EL AGUJERO QUE CIERRA: el sello ya cubria `multaInasistencia` de cada fila
 * -- la plata -- pero no el "1 de 3 dias" que la justifica. Con la multa por
 * dia, esos dos numeros SON la multa: `(dias - diasAsistidos) x tarifa`. Un
 * sello que firma "S/40" sin firmar el "1 de 3" deja que alguien edite
 * `dias_asistidos` en la base y la multa quede sin explicacion, o peor, con
 * una explicacion falsa que cuadra igual. Y `liquidaciones_colaborador` no
 * tiene trigger de inmutabilidad (solo lo tienen `lacrados_inventario` y
 * `aprobaciones_cierre`): el hash es lo UNICO que protege esa tabla.
 *
 * SUBIR ESTE NUMERO NO INVALIDA LOS SELLOS VIEJOS: `armarContenidoLacrado`
 * recibe la version a armar y arma la forma DE ESA version -- verificar un
 * sello v1 sigue construyendo el contenido v1 (sin los campos nuevos), y uno
 * v2 el suyo, asi que un inventario ya lacrado (ej. el 45, folio
 * INV-2026-09-CON-10-9A8) sigue dando `intacto: true`. Lo unico que cambia
 * para esos es que ahora se les nota correctamente `versionDistinta: true`
 * -- exactamente para lo que existe ese flag.
 */
export const VERSION_CONTENIDO_LACRADO = 3;

export const ALGORITMO_HASH = 'sha256';

/**
 * Cuantas aprobaciones DISTINTAS habilitan el lacrado.
 *
 * Decision del cliente (2026-09-10): "POR AHORA" se firma con UNA sola --
 * hoy hay un solo auditor real (Gilmer) y exigir dos bloqueaba el cierre
 * para siempre. El modelo de doble firma NO se toca -- la tabla
 * `aprobaciones_cierre`, el `@@unique([inventarioId, aprobadorId])` y "no
 * firmas dos veces" siguen intactos (ver historial.permisos.ts). Lo UNICO
 * que cambia es este numero, y viaja como parametro explicito a
 * `validarPuedeAprobar`/`validarPuedeLacrar` -- ninguna de las dos vuelve a
 * leer un 2 (ni un 1) escrito a mano.
 *
 * Configurable por variable de entorno para no tener que tocar codigo el
 * dia que entre una segunda cuenta de auditor: alcanza con subir
 * `LACRADO_APROBACIONES_REQUERIDAS` a 2. Default 1 (el proceso real de
 * hoy) si la variable no esta seteada.
 */
export const APROBACIONES_REQUERIDAS = parsearAprobacionesRequeridas(process.env.LACRADO_APROBACIONES_REQUERIDAS);

/**
 * Pura, aparte de `APROBACIONES_REQUERIDAS` (que se calcula una sola vez al
 * cargar el modulo): asi se puede testear la validacion del valor sin tocar
 * variables de entorno ni reiniciar el proceso.
 */
export function parsearAprobacionesRequeridas(crudo: string | undefined): number {
  if (crudo === undefined || crudo.trim() === '') return 1;
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `LACRADO_APROBACIONES_REQUERIDAS invalido: "${crudo}" -- tiene que ser un numero entero >= 1.`,
    );
  }
  return n;
}

// ---------------------------------------------------------------------------
// Serializacion canonica
// ---------------------------------------------------------------------------

/**
 * JSON con las claves de cada objeto ordenadas alfabeticamente y sin
 * espacios. Es LA pieza que hace verificable al hash: `{a:1,b:2}` y
 * `{b:2,a:1}` son el mismo dato y tienen que dar el mismo hash, pero
 * `JSON.stringify` los serializa distinto segun el orden de insercion.
 *
 * Los arrays NO se ordenan: en un array el orden ES parte del dato (la
 * planilla de liquidacion tiene un orden), asi que quien arma el contenido
 * es el responsable de emitirlos siempre en el mismo orden -- de eso se
 * ocupa `armarContenidoLacrado`.
 */
export function serializarCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map(serializarCanonico).join(',')}]`;

  const entradas = Object.entries(valor as Record<string, unknown>)
    // `undefined` no sobrevive a un round-trip por JSON: si se dejara pasar,
    // el contenido guardado y el recalculado podrian diferir por una clave
    // que en realidad nunca existio.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${serializarCanonico(v)}`).join(',')}}`;
}

/** SHA-256 hexadecimal (64 chars) de la forma canonica del contenido. */
export function calcularHash(contenido: unknown): string {
  return createHash(ALGORITMO_HASH).update(serializarCanonico(contenido), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Contenido sellado
// ---------------------------------------------------------------------------

export interface DatosLacrado {
  inventarioId: number;
  sucursalId: number;
  sucursalNombre: string;
  periodoAnio: number;
  periodoMes: number;
  tamanoHoja: number;
  snapshotItems: number | null;
  snapshotTomadoEn: string | null;
  cerradoEn: string | null;

  resultado: {
    itemsTotales: number;
    itemsConDiferencia: number;
    itemsSegundoConteo: number;
    itemsTercerConteo: number;
    unidadesFaltantes: number;
    unidadesSobrantes: number;
    montoFaltanteBruto: number;
    /**
     * NULL, no 0, cuando todavía no se capturó (ver
     * schema.prisma#ResultadoInventario). El sello es EL documento
     * inmutable del cierre -- si acá se sellara un 0 en vez de null,
     * el lacrado afirmaría para siempre "no hubo ajustes"/"vino todo el
     * mundo" sin que nadie lo haya verificado. Mejor un sello que dice
     * "no se sabía" que uno que miente con un cero prolijo.
     */
    montoNegativos: number | null;
    montoFaltanteEmpresa: number;
    /**
     * Sobrante a favor del empleado (liquidacion v2). Solo entra al hash en
     * `version >= 2` -- ver `VERSION_CONTENIDO_LACRADO`. Opcional: los
     * llamadores de version 1 (tests viejos, datos de antes de esta
     * funcionalidad) no tienen por que conocerlo.
     */
    montoSobranteEmpleado?: number | null;
    /**
     * Cuantos dias duro el inventario: el DENOMINADOR de todas las multas de
     * la planilla. Entra al hash en `version >= 3` -- mismo motivo que
     * `liquidaciones[].diasAsistidos`.
     *
     * 0 en la base significa "este inventario se cerro cuando la asistencia
     * se deducia de las hojas", NO "duro cero dias". `armarContenidoLacrado`
     * lo traduce a `null` antes de sellarlo: ver el comentario ahi.
     */
    diasDelInventario?: number;
    colaboradoresAlcanzados: number;
    /** NULL, no 0 -- misma razón que `montoNegativos`, arriba. */
    colaboradoresAsistieron: number | null;
    multaInasistencia: number;
  } | null;

  /** Una entrada por item con diferencia. Se ordena por `codigo` al armar. */
  diferencias: Array<{
    codigo: string;
    stockSistema: number;
    conteoFinal: number;
    diferencia: number;
    resueltoEnConteo: number;
    montoDiferencia: number | null;
    /**
     * Clasificacion efectiva al momento de liquidar (liquidacion v2). Solo
     * entra al hash en `version >= 2` -- mismo motivo que
     * `resultado.montoSobranteEmpleado`.
     */
    esEmpresa?: boolean;
  }>;

  /** La planilla que firma la gente. Se ordena por `colaboradorId` al armar. */
  liquidaciones: Array<{
    colaboradorId: number;
    asistio: boolean;
    /**
     * Dias que asistio esta persona. Entra al hash en `version >= 3` -- es la
     * JUSTIFICACION de `multaInasistencia`, que ya estaba sellado: con la
     * multa por dia, `(diasDelInventario - diasAsistidos) x tarifa` ES el
     * monto. Opcional por lo mismo que `resultado.montoSobranteEmpleado`.
     */
    diasAsistidos?: number;
    cuotaBase: number;
    multaInasistencia: number;
    bonoAsistencia: number;
  }>;

  /** Las dos firmas. Se ordenan por `aprobadorId` al armar. */
  aprobaciones: Array<{
    aprobadorId: number;
    rolAlAprobar: string;
    aprobadoEn: string;
  }>;
}

export interface ContenidoLacrado extends Record<string, unknown> {
  version: number;
}

/**
 * Arma el objeto EXACTO que entra al hash.
 *
 * Que entra y por que: los totales del inventario (el resultado del mes),
 * el detalle de diferencias (lo que se va a ajustar en el ERP), la planilla
 * de liquidacion (lo que se le descuenta a cada persona) y las
 * aprobaciones (quien firmo). Si el sello no cubriera la planilla, se
 * podria cambiar el descuento de alguien despues de lacrado sin que el hash
 * se entere -- y es justamente la parte que le importa al colaborador.
 *
 * Que NO entra: nada que cambie por si solo con el paso del tiempo o por
 * una accion ajena al cierre (`updatedAt`, el estado del registro manual en
 * Dynamics, el nombre actual de un colaborador). Meter un campo volatil en
 * el hash rompe la verificacion sin que nadie haya alterado nada, y una
 * alarma que suena sola termina ignorandose.
 *
 * Los tres arrays se ordenan aca -- no se confia en el orden en que vino la
 * query. `version` viaja adentro para que un cambio futuro de formato no
 * invalide los sellos viejos: se verifica cada uno con las reglas de SU
 * version.
 *
 * `version` es un PARAMETRO, no siempre `VERSION_CONTENIDO_LACRADO`: al
 * LACRAR un inventario nuevo se usa la ultima (el default). Al VERIFICAR uno
 * ya lacrado hay que reconstruir la forma CON LA QUE SE SELLO -- quien llama
 * (historial.service.ts#verificarSello) tiene que pasar la version guardada
 * en `lacrado.contenido.version`, o esta funcion produciria una forma que
 * nunca existio y el hash jamas volveria a coincidir con uno legitimo.
 */
export function armarContenidoLacrado(
  datos: DatosLacrado,
  version: number = VERSION_CONTENIDO_LACRADO,
): ContenidoLacrado {
  const porNumero = (a: number, b: number): number => a - b;
  const v2 = version >= 2;
  const v3 = version >= 3;

  /**
   * SI ESTE INVENTARIO TIENE ASISTENCIA POR DIA, o si es de la regla vieja.
   *
   * `diasDelInventario` es `Int @default(0)`, y un 0 ahi NO dice "duro cero
   * dias": dice "se cerro cuando la asistencia se deducia de las hojas y no
   * existia el concepto de dia". Sellar ese 0 tal cual seria firmar una
   * AFIRMACION FALSA sobre el inventario -- y un sello vale justamente porque
   * lo que dice es verdad.
   *
   * Por eso, cuando no hay asistencia por dia, los dos campos nuevos se
   * sellan en `null`: "esto no se midio". Es la misma distincion que el resto
   * del sistema hace entre null y 0 (ver `montoNegativos`), y acá pesa mas que
   * en ningun otro lado.
   *
   * `null` y no `undefined`: `undefined` haria desaparecer la clave del
   * contenido canonico, y entonces un sello v3 de un inventario viejo seria
   * indistinguible de uno al que le borraron el campo. El `null` explicito
   * queda bajo el hash y afirma, con todas las letras, que no se midio.
   */
  const diasDelInventario = datos.resultado?.diasDelInventario ?? 0;
  const conAsistenciaPorDia = diasDelInventario > 0;

  return {
    version,
    inventarioId: datos.inventarioId,
    sucursalId: datos.sucursalId,
    sucursalNombre: datos.sucursalNombre,
    periodoAnio: datos.periodoAnio,
    periodoMes: datos.periodoMes,
    tamanoHoja: datos.tamanoHoja,
    snapshotItems: datos.snapshotItems,
    snapshotTomadoEn: datos.snapshotTomadoEn,
    cerradoEn: datos.cerradoEn,
    resultado:
      datos.resultado === null
        ? null
        : {
            ...datos.resultado,
            // `undefined`, no `null`: `serializarCanonico` descarta las
            // claves `undefined` (ver su propio comentario), asi que en v1
            // la clave directamente NO EXISTE en el contenido -- igual que
            // antes de que este campo existiera. Un `null` explicito SI
            // cambiaria el hash de los sellos viejos.
            montoSobranteEmpleado: v2 ? (datos.resultado.montoSobranteEmpleado ?? null) : undefined,
            diasDelInventario: v3 ? (conAsistenciaPorDia ? diasDelInventario : null) : undefined,
          },
    diferencias: [...datos.diferencias]
      .sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0))
      .map((d) => ({ ...d, esEmpresa: v2 ? (d.esEmpresa ?? false) : undefined })),
    liquidaciones: [...datos.liquidaciones]
      .sort((a, b) => porNumero(a.colaboradorId, b.colaboradorId))
      // Con asistencia por dia, el 0 de alguien que no vino nunca es un CERO
      // REAL y se sella como tal; sin ella, la columna entera es un default
      // que no significa nada y va en `null`. Ver `conAsistenciaPorDia`.
      .map((l) => ({
        ...l,
        diasAsistidos: v3 ? (conAsistenciaPorDia ? (l.diasAsistidos ?? 0) : null) : undefined,
      })),
    aprobaciones: [...datos.aprobaciones].sort((a, b) => porNumero(a.aprobadorId, b.aprobadorId)),
  };
}

// ---------------------------------------------------------------------------
// Folio legible
// ---------------------------------------------------------------------------

/**
 * Sigla de 3 letras de una sucursal, para el folio: "Market Central
 * Luzuriaga" -> "LUZ", "Market Carhuaz" -> "CAR". Se toma la ULTIMA palabra
 * significativa porque es la que identifica a la tienda -- todas empiezan
 * con "Market", asi que las primeras letras del nombre completo darian
 * "MAR" para las cuatro y el folio no distinguiria nada.
 */
export function siglaSucursal(nombre: string): string {
  const GENERICAS = new Set(['market', 'mercado', 'tienda', 'sucursal', 'central', 'de', 'del', 'la', 'el', 'los']);

  const palabras = nombre
    .normalize('NFD')
    // Saca las tildes: la sigla es ASCII, va en un identificador.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 0);

  const significativas = palabras.filter((p) => !GENERICAS.has(p.toLowerCase()));
  const elegida = significativas[significativas.length - 1] ?? palabras[palabras.length - 1] ?? 'SUC';

  return elegida.toUpperCase().slice(0, 3).padEnd(3, 'X');
}

export interface DatosFolio {
  periodoAnio: number;
  periodoMes: number;
  sucursalNombre: string;
  items: number;
  hash: string;
}

/**
 * "INV-2026-08-LUZ-8000-K99" -- el formato que ya validó el cliente en
 * mobile/design/lacrado.html. Es el identificador que se cita en un acta o
 * en un mail: nadie dicta 64 caracteres hexadecimales por telefono.
 *
 * El sufijo son los 3 primeros caracteres del hash en mayusculas. NO es un
 * control criptografico -- 3 caracteres colisionan facil -- es un digito
 * verificador a ojo: si el folio del papel no termina igual que el hash del
 * sistema, alguien copio mal. El control de verdad es `hash` completo.
 */
export function armarFolio(d: DatosFolio): string {
  const mes = String(d.periodoMes).padStart(2, '0');
  const sufijo = d.hash.slice(0, 3).toUpperCase();
  return `INV-${d.periodoAnio}-${mes}-${siglaSucursal(d.sucursalNombre)}-${d.items}-${sufijo}`;
}

// ---------------------------------------------------------------------------
// Verificacion
// ---------------------------------------------------------------------------

export interface ResultadoVerificacion {
  /** true = el inventario esta tal cual se lacro. */
  intacto: boolean;
  hashGuardado: string;
  hashRecalculado: string;
  /**
   * Que secciones difieren entre el contenido sellado y el estado actual.
   * Un booleano solo dice "algo cambio"; esto dice DONDE mirar, que es la
   * diferencia entre una alarma util y uno de esos avisos que se ignoran.
   */
  seccionesAlteradas: string[];
  /**
   * true cuando el sello se hizo con una version de formato distinta a la
   * que corre hoy. En ese caso `intacto` no es concluyente y hay que decirlo
   * en vez de reportar una alteracion que quizas no existe.
   */
  versionDistinta: boolean;
}

/**
 * Compara el contenido sellado contra el estado actual del inventario.
 *
 * Esto es lo que convierte la inmutabilidad de una promesa en un control:
 * el schema puede prohibir el UPDATE, pero alguien con acceso a la base
 * siempre puede tocar una fila. Lo que no puede es hacerlo sin que este
 * chequeo lo diga.
 */
export function verificarLacrado(
  contenidoGuardado: Record<string, unknown>,
  hashGuardado: string,
  contenidoActual: ContenidoLacrado,
): ResultadoVerificacion {
  const hashRecalculado = calcularHash(contenidoActual);

  const versionGuardada = contenidoGuardado['version'];
  const versionDistinta = versionGuardada !== VERSION_CONTENIDO_LACRADO;

  const seccionesAlteradas: string[] = [];
  const claves = new Set([...Object.keys(contenidoGuardado), ...Object.keys(contenidoActual)]);
  for (const clave of claves) {
    if (clave === 'version') continue;
    if (serializarCanonico(contenidoGuardado[clave]) !== serializarCanonico(contenidoActual[clave])) {
      seccionesAlteradas.push(clave);
    }
  }
  seccionesAlteradas.sort();

  return {
    intacto: hashGuardado === hashRecalculado,
    hashGuardado,
    hashRecalculado,
    seccionesAlteradas,
    versionDistinta,
  };
}
