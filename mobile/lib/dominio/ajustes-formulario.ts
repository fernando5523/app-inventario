/**
 * Validación del formulario de ajustes del mes, aparte del JSX para poder
 * probarla: de acá sale un monto que BAJA lo que se le descuenta a once
 * personas, y los bordes importan más que el layout.
 *
 * La regla que gobierna todo: **`0` es un valor válido y significativo**.
 * `montoNegativos: null` en la base significa "nadie miró" y bloquea la
 * liquidación entera; un `0` cargado por una persona significa "alguien miró
 * y no había", y la destraba. Un formulario que rechazara el 0 —tratándolo
 * como "campo vacío"— obligaría a inventar un centavo para poder cerrar el
 * mes, que es exactamente el tipo de dato falso que todo esto evita.
 */

export interface CamposAjustes {
  /** Tal como se tipeó. Se parsea acá, no en el componente. */
  montoNegativos: string;
  montoEmpresa: string;
  nota: string;
}

export interface AjustesValidados {
  montoNegativos: number;
  /** `undefined` = no se tocó, y el backend CONSERVA el calculado al cerrar. */
  montoEmpresa?: number;
  nota: string;
}

export type ResultadoValidacion =
  | { ok: true; datos: AjustesValidados }
  | { ok: false; error: string };

/**
 * Acepta coma o punto como decimal: en el teclado del teléfono la coma es lo
 * que sale natural en es-PE, y rechazar "380,50" por eso sería hacer perder
 * el tiempo a alguien que escribió bien.
 */
function aNumero(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (limpio === '') return null;
  // `Number` y no `parseFloat`: parseFloat("380abc") devuelve 380 y se
  // guardaría un monto que nadie escribió.
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

export function validarAjustes(campos: CamposAjustes): ResultadoValidacion {
  const negativos = aNumero(campos.montoNegativos);
  if (negativos === null) {
    return { ok: false, error: 'Poné cuánto suman los ajustes del mes. Si no hubo ninguno, escribí 0.' };
  }
  if (negativos < 0) {
    return { ok: false, error: 'Los ajustes no pueden ser negativos: son plata a favor del personal.' };
  }

  // Vacío ≠ 0. Vacío conserva el calculado al cerrar el conteo (sale de las
  // categorías de empresa de Dynamics); un 0 escrito lo pisa con cero.
  const empresaTexto = campos.montoEmpresa.trim();
  let empresa: number | undefined;
  if (empresaTexto !== '') {
    const n = aNumero(empresaTexto);
    if (n === null) return { ok: false, error: 'El monto de empresa no es un número válido.' };
    if (n < 0) return { ok: false, error: 'El monto de empresa no puede ser negativo.' };
    empresa = n;
  }

  const nota = campos.nota.trim();
  if (nota === '') {
    return { ok: false, error: 'Contá de dónde salen estos ajustes: sin nota nadie puede auditarlos después.' };
  }

  return {
    ok: true,
    datos: { montoNegativos: negativos, ...(empresa !== undefined ? { montoEmpresa: empresa } : {}), nota },
  };
}

/**
 * Qué dice la tarjeta según el estado. Aparte del JSX por lo mismo que
 * `avance-snapshot.ts`: son tres textos con significados distintos y ninguno
 * se puede probar dentro de un ternario anidado.
 */
export function textoDeAjustes(
  estado: { registrado: boolean; montoNegativos: number | null; registradoPor: { nombre: string } | null; registradoEn: string | null },
  soles: (n: number) => string,
  fecha: (iso: string) => string,
): { titulo: string; detalle: string; bloqueaLiquidacion: boolean } {
  if (!estado.registrado || estado.montoNegativos === null) {
    return {
      titulo: 'Sin registrar',
      detalle:
        'Hasta que alguien cargue los ajustes del mes no se puede calcular el faltante neto ni cerrar la planilla. Si no hubo ajustes, cargá 0 — eso también es un dato.',
      bloqueaLiquidacion: true,
    };
  }

  const quien = estado.registradoPor?.nombre ?? 'alguien';
  const cuando = estado.registradoEn === null ? '' : ` el ${fecha(estado.registradoEn)}`;

  return {
    titulo: `${soles(estado.montoNegativos)} en ajustes`,
    // Quién y cuándo van SIEMPRE: es plata que se decidió no descontar, y
    // quien firme la planilla tiene que poder ver de quién salió ese número.
    detalle: `Registrado por ${quien}${cuando}.`,
    bloqueaLiquidacion: false,
  };
}
