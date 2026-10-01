/**
 * Dominio puro de "importar el Excel de ajustes de Dynamics" (Pantalla del
 * Auditor, contra backend/src/modules/liquidacion/liquidacion.ajustes-negativos.ts,
 * commit e39b370). Sin Prisma, sin fetch, sin React -- solo los tipos que
 * calcan la respuesta del lector, los textos de cada motivo, y la regla NULL
 * != 0 llevada a lo que la pantalla tiene que decir.
 */

// ---------------------------------------------------------------------------
// Vista previa (POST .../ajustes-negativos/preview)
// ---------------------------------------------------------------------------

export type MotivoRechazoLinea = 'otra-tienda' | 'datos-invalidos';
export type MotivoAdvertenciaLinea = 'importe-no-coincide' | 'fuera-de-periodo' | 'responsable-no-empleado';

export interface LineaAjusteNegativoValida {
  fila: number;
  codigo: string;
  nombre2: string;
  importe: number;
  motivoAjuste: string;
  responsable: string;
  advertencias: readonly MotivoAdvertenciaLinea[];
}

export interface LineaAjusteNegativoRechazada {
  fila: number;
  motivo: MotivoRechazoLinea;
}

/**
 * Misma forma que `ResultadoLecturaAjustes` del backend: `ok:false` es el
 * archivo entero sin poder leer (columna faltante o no es un .xlsx), nunca
 * una lista vacía disfrazándolo -- ver el 0 explícito más abajo.
 */
export type ResultadoPreviewAjustesNegativos =
  | {
      ok: true;
      validas: readonly LineaAjusteNegativoValida[];
      rechazadas: readonly LineaAjusteNegativoRechazada[];
      totalImporte: number;
    }
  | { ok: false; motivo: 'columna-faltante' | 'archivo-invalido'; detalle: string };

/** Por qué una línea NO entra a la suma, nunca en silencio. */
export function textoMotivoRechazo(motivo: MotivoRechazoLinea): string {
  switch (motivo) {
    case 'otra-tienda':
      return 'Es de otra tienda: el Almacén de esa fila no es el de esta sucursal.';
    case 'datos-invalidos':
      return 'Cantidad, Precio, Importe o la fecha de "Registrado en" no se pudieron leer.';
  }
}

/** La línea SIGUE sumando -- esto es lo que el Auditor decide si excluir o no. */
export function textoMotivoAdvertencia(motivo: MotivoAdvertenciaLinea): string {
  switch (motivo) {
    case 'importe-no-coincide':
      return 'El Importe no coincide con Cantidad × Precio.';
    case 'fuera-de-periodo':
      return 'La fecha de "Registrado en" cae fuera del período de este inventario.';
    case 'responsable-no-empleado':
      return 'El Responsable no dice "Empleado".';
  }
}

// ---------------------------------------------------------------------------
// Estado de los negativos del inventario: NULL != 0
// ---------------------------------------------------------------------------

export type EstadoNegativos = 'sin-importar' | 'importado';

export interface EstadoNegativosVisible {
  estado: EstadoNegativos;
  /** Mismo criterio que liquidacion.cierre.ts: NULL bloquea, 0 no. */
  bloqueaLiquidar: boolean;
  /** `null` mientras no se importó nada -- nunca 0 por defecto. */
  monto: number | null;
  texto: string;
}

const TEXTO_SIN_IMPORTAR =
  'Todavía no se importó el Excel de ajustes de este mes: esto bloquea liquidar.';
const TEXTO_IMPORTADO_SIN_LINEAS =
  'Se importó el Excel de este mes: no había ninguna línea útil que reportar.';
const TEXTO_IMPORTADO_CON_MONTO = 'Excel de ajustes importado.';

/**
 * `montoNegativos` tal como lo devuelve `GET .../ajustes`
 * (`ResultadoInventario.montoNegativos`, backend). `null` = nadie importó
 * nada todavía; `0` = alguien importó un archivo válido sin líneas útiles --
 * un hecho verificado, no lo mismo que "no se hizo nada".
 */
export function estadoNegativos(montoNegativos: number | null): EstadoNegativosVisible {
  if (montoNegativos === null) {
    return { estado: 'sin-importar', bloqueaLiquidar: true, monto: null, texto: TEXTO_SIN_IMPORTAR };
  }
  return {
    estado: 'importado',
    bloqueaLiquidar: false,
    monto: montoNegativos,
    texto: montoNegativos === 0 ? TEXTO_IMPORTADO_SIN_LINEAS : TEXTO_IMPORTADO_CON_MONTO,
  };
}

// ---------------------------------------------------------------------------
// Líneas de la importación VIGENTE (GET .../ajustes-negativos/lineas)
// ---------------------------------------------------------------------------

export interface LineaAjusteNegativoGuardada {
  id: number;
  fila: number;
  codigo: string;
  descripcion: string;
  importe: number;
  excluida: boolean;
  motivoExclusion: string | null;
  excluidaPor: { id: number; nombre: string } | null;
  excluidaEn: string | null;
}

export interface ImportacionVigente {
  id: number;
  nombreArchivo: string;
  importadoPor: { id: number; nombre: string };
  importadoEn: string;
}

export interface ListadoLineasAjustesNegativos {
  /** `null` = nadie importó nada todavía -- distinto de una importación real con `lineas: []`. */
  importacion: ImportacionVigente | null;
  lineas: readonly LineaAjusteNegativoGuardada[];
  /** `false` con el inventario ya liquidado/lacrado: la pantalla bloquea excluir/incluir ANTES de intentar la llamada. */
  puedeEditar: boolean;
}

// ---------------------------------------------------------------------------
// El monto que se muestra
// ---------------------------------------------------------------------------

/** Suma de `importe` de las líneas NO excluidas -- lo que la pantalla muestra tras excluir/incluir. */
export function totalLineasNoExcluidas(lineas: readonly { importe: number; excluida: boolean }[]): number {
  return lineas.reduce((acumulado, l) => acumulado + (l.excluida ? 0 : l.importe), 0);
}

// ---------------------------------------------------------------------------
// LA PANTALLA: QUÉ SE PUEDE HACER Y QUÉ TEXTO CORRESPONDE
// ---------------------------------------------------------------------------
/**
 * Lo que sigue son las decisiones de la pantalla de importación, las MISMAS
 * para el teléfono y para el navegador, sacadas del JSX.
 *
 * Se extrajeron al clonar la pantalla para la web
 * (`components/pantallas/AjustesNegativosScreen.web.tsx`): en el teléfono
 * varias de estas frases viven dentro de un `Alert.alert`, y en
 * react-native-web `Alert.alert` es un método con el cuerpo VACÍO
 * (`react-native-web/dist/exports/Alert/index.js`: `static alert() {}`). O
 * sea: el Auditor confirmaba la importación y la pantalla no decía NADA.
 * Sacarlas del Alert obligó a decidir dónde viven, y la respuesta es acá: en
 * los dos JSX serían dos copias que se separan en el primer cambio de
 * palabras, y los textos de esta pantalla son los que explican de dónde sale
 * un descuento a nómina.
 */

export type AccionLinea = 'excluir' | 'incluir';

/**
 * Qué se le puede hacer HOY a una línea guardada: la excluida se vuelve a
 * incluir, y al revés. Es un solo botón por fila, no dos -- dos botones donde
 * uno siempre está apagado es una fila que hay que leer dos veces.
 */
export function accionDeLinea(excluida: boolean): AccionLinea {
  return excluida ? 'incluir' : 'excluir';
}

export interface TextosAccionLinea {
  /** El botón de la fila. */
  etiqueta: string;
  /** El título del diálogo que pide el motivo. */
  titulo: string;
  /** Lo que se espera que escriba. No un "Motivo…" genérico: la frase dice qué se está por justificar. */
  placeholder: string;
}

/**
 * Las palabras de cada acción, en un solo lugar. "Excluir" y "Volver a
 * incluir" no son simétricas de casualidad: excluir SACA plata del descuento y
 * volver a incluir la devuelve, así que el diálogo tiene que decir cuál de las
 * dos se está firmando.
 */
export function textosAccionLinea(accion: AccionLinea): TextosAccionLinea {
  return accion === 'excluir'
    ? {
        etiqueta: 'Excluir',
        titulo: 'Excluir esta línea',
        placeholder: 'Por qué esta línea no corresponde (el motivo del ajuste está mal, es de otro período…)',
      }
    : {
        etiqueta: 'Volver a incluir',
        titulo: 'Volver a incluir esta línea',
        placeholder: 'Por qué esta línea vuelve a contar',
      };
}

/**
 * El tope del motivo, CALCADO del backend
 * (`liquidacion.schema.ts#motivoLineaAjusteSchema`: `.trim().min(1).max(500)`).
 * No es un número elegido acá: un límite más chico rechazaría en pantalla algo
 * que el servidor acepta, y uno más grande manda un 400 después de escribir.
 */
export const MOTIVO_LINEA_MAXIMO = 500;

/**
 * POR QUÉ EL MOTIVO ES OBLIGATORIO Y NO UNA GENTILEZA: excluir una línea baja
 * el descuento de una persona. El pedido es de Gilmer, textual en la cabecera
 * del service del backend -- *"el área de negativos a veces se equivoca en
 * poner el motivo"* --, y sin el motivo escrito nadie puede auditar después por
 * qué esa línea no está.
 *
 * DEVUELVE EL TEXTO, no un booleano: en el teléfono el botón simplemente se
 * quedaba apagado y no decía qué faltaba, y en la web un botón gris sin
 * explicación es una pantalla que no responde. `null` = el motivo sirve.
 *
 * El mínimo es 1 carácter tras `trim`, igual que el servidor: NO se inventa un
 * mínimo de seis como en el ajuste final (`ajuste-final.ts#errorDeMotivo`), que
 * es la regla de OTRA pantalla y rechazaría un "Duplicada" perfectamente claro.
 */
export function errorDeMotivoLinea(accion: AccionLinea, motivo: string): string | null {
  const limpio = motivo.trim();
  if (limpio.length === 0) {
    return accion === 'excluir'
      ? 'Escribe por qué se excluye esta línea: queda registrado con tu nombre y es lo que se audita después.'
      : 'Escribe por qué esta línea vuelve a contar: queda registrado con tu nombre.';
  }
  if (limpio.length > MOTIVO_LINEA_MAXIMO) {
    return `El motivo no puede pasar de ${MOTIVO_LINEA_MAXIMO} caracteres: llevas ${limpio.length}.`;
  }
  return null;
}

/**
 * `listado.puedeEditar === false`: el inventario ya se liquidó o se lacró.
 *
 * El botón queda a la vista y apagado con ESTE texto debajo, nunca escondido
 * (mismo criterio que `BotonWeb`): quien vio ayer el botón de excluir tiene que
 * entender por qué hoy no lo puede usar, y no buscarlo.
 */
export const TEXTO_LINEAS_BLOQUEADAS =
  'Este inventario ya se liquidó: excluir o volver a incluir una línea queda bloqueado. No se toca la plata de algo que ya se cerró.';

/**
 * El archivo entero no se pudo leer. Son DOS fallas distintas y se dicen
 * distinto: a una le faltan columnas (el archivo es un Excel, pero no ESTE
 * Excel) y la otra no es un .xlsx. El detalle largo lo manda el backend tal
 * cual -- dice cuáles faltan y la estructura completa esperada --, así que acá
 * solo va el titular.
 */
export function tituloPreviewFallido(motivo: 'columna-faltante' | 'archivo-invalido'): string {
  return motivo === 'columna-faltante' ? 'Faltan columnas en el archivo' : 'El archivo no se pudo leer';
}

export interface ResumenPreview {
  validas: number;
  rechazadas: number;
  /** Válidas que el backend marcó dudosas. SUMAN igual: son las que el Auditor decide excluir DESPUÉS de confirmar. */
  conAdvertencia: number;
  totalImporte: number;
}

/**
 * Las cuatro cifras de la vista previa, contadas una sola vez.
 *
 * `conAdvertencia` es la que más se usa mal: una advertencia NO descarta la
 * línea (fuera de período, responsable que no dice "Empleado"). El backend las
 * deja adentro de `validas` a propósito, porque la decisión de sacarlas es del
 * Auditor y no del lector del archivo. Contarlas aparte es lo que permite
 * decirlo en pantalla sin insinuar que ya quedaron afuera.
 */
export function resumenPreview(preview: Extract<ResultadoPreviewAjustesNegativos, { ok: true }>): ResumenPreview {
  return {
    validas: preview.validas.length,
    rechazadas: preview.rechazadas.length,
    conAdvertencia: preview.validas.filter((v) => v.advertencias.length > 0).length,
    totalImporte: preview.totalImporte,
  };
}

/**
 * QUÉ SE ESTÁ POR CONFIRMAR, en una frase, ANTES de apretar.
 *
 * Confirmar escribe la importación y recalcula `montoNegativos`, que es lo que
 * después baja el descuento de once personas. La vista previa ya muestra las
 * cifras sueltas; esta frase es la que las junta en la afirmación que el
 * Auditor firma.
 *
 * `soles` se inyecta y no se importa: este módulo es dominio puro y el formato
 * de moneda vive en `components/ui/formato.ts` (mismo patrón que
 * `ajustes-formulario.ts#estadoAjustesNegativos`).
 */
export function textoQueSeConfirma(resumen: ResumenPreview, soles: (n: number) => string): string {
  const cuantas =
    resumen.validas === 1 ? '1 línea' : `${resumen.validas} líneas`;
  const afuera =
    resumen.rechazadas === 0
      ? ''
      : ` ${resumen.rechazadas === 1 ? '1 línea queda' : `${resumen.rechazadas} líneas quedan`} afuera y no suman.`;
  return `Se van a guardar ${cuantas} por ${soles(resumen.totalImporte)}, que es lo que va a sumar a favor del personal.${afuera}`;
}

export interface ImportacionConfirmada {
  nombreArchivo: string;
  cantidadValidas: number;
  montoNegativos: number;
}

/**
 * EL AVISO DE QUE LA IMPORTACIÓN QUEDÓ GUARDADA: el texto que en el teléfono
 * es un `Alert.alert` y que en el navegador, con `Alert.alert` vacío, no se
 * mostraba en ninguna parte -- el Auditor apretaba "Confirmar" y la pantalla
 * parecía no haber hecho nada, con la importación ya escrita en la base.
 *
 * Dice las tres cosas que hacen falta para creerle: QUÉ archivo entró, CUÁNTAS
 * líneas quedaron contando, y CON QUÉ MONTO -- que es el que la liquidación va
 * a usar.
 */
export function textoImportacionConfirmada(r: ImportacionConfirmada, soles: (n: number) => string): string {
  const cuantas = r.cantidadValidas === 1 ? '1 línea' : `${r.cantidadValidas} líneas`;
  return `${r.nombreArchivo}: ${cuantas} guardada${r.cantidadValidas === 1 ? '' : 's'} por ${soles(r.montoNegativos)}. Ya es el monto de ajustes de este inventario.`;
}

export type EstadoDeLaImportacion = 'sin-importar' | 'vigente';

export interface VistaImportar {
  estado: EstadoDeLaImportacion;
  /** El título de la tarjeta de importar. */
  titulo: string;
  /** El botón que abre el selector, con el verbo que corresponde. */
  boton: string;
  /** Qué pasa con lo que ya estaba. `null` cuando no hay nada que reemplazar. */
  nota: string | null;
}

/**
 * HAY UNA IMPORTACIÓN VIGENTE, O NO LA HAY. Es la misma tarjeta con dos
 * lecturas distintas, y la diferencia importa: con un Excel ya importado el
 * botón no "importa", REEMPLAZA -- y quien no lo sabe cree que está agregando
 * líneas a las que ya estaban.
 *
 * La nota dice además lo único que calma la duda de encima: reemplazar NO borra
 * el historial. El backend marca la anterior como no vigente y la deja en la
 * base (`liquidacion.ajustes-negativos.ts`), así que la frase es un hecho
 * verificable, no una tranquilidad de cortesía.
 */
export function vistaImportar(importacion: ImportacionVigente | null): VistaImportar {
  if (importacion === null) {
    return {
      estado: 'sin-importar',
      titulo: 'Importar el Excel del mes',
      boton: 'Elegir archivo .xlsx',
      nota: null,
    };
  }
  return {
    estado: 'vigente',
    titulo: 'Reemplazar el Excel importado',
    boton: 'Elegir otro archivo .xlsx',
    nota: `Ya hay una importación vigente: ${importacion.nombreArchivo}. Al confirmar otra, esta deja de contar y el monto se recalcula con el archivo nuevo. La anterior queda registrada, no se borra.`,
  };
}
