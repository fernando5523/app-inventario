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

/** Version del formato de `contenido`. Ver `armarContenidoLacrado`. */
export const VERSION_CONTENIDO_LACRADO = 1;

export const ALGORITMO_HASH = 'sha256';

/** Cuantas aprobaciones distintas habilitan el lacrado (Gilmer + Michell). */
export const APROBACIONES_REQUERIDAS = 2;

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
  }>;

  /** La planilla que firma la gente. Se ordena por `colaboradorId` al armar. */
  liquidaciones: Array<{
    colaboradorId: number;
    asistio: boolean;
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
 */
export function armarContenidoLacrado(datos: DatosLacrado): ContenidoLacrado {
  const porNumero = (a: number, b: number): number => a - b;

  return {
    version: VERSION_CONTENIDO_LACRADO,
    inventarioId: datos.inventarioId,
    sucursalId: datos.sucursalId,
    sucursalNombre: datos.sucursalNombre,
    periodoAnio: datos.periodoAnio,
    periodoMes: datos.periodoMes,
    tamanoHoja: datos.tamanoHoja,
    snapshotItems: datos.snapshotItems,
    snapshotTomadoEn: datos.snapshotTomadoEn,
    cerradoEn: datos.cerradoEn,
    resultado: datos.resultado,
    diferencias: [...datos.diferencias].sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0)),
    liquidaciones: [...datos.liquidaciones].sort((a, b) => porNumero(a.colaboradorId, b.colaboradorId)),
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
