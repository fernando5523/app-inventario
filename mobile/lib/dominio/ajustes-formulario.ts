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

/**
 * SIN monto de empresa (backend 48899bc): el faltante de empresa lo calcula
 * la clasificación de productos al liquidar, y PUT /ajustes dejó de aceptarlo.
 * Un campo que el servidor ignora es un dato que miente.
 */
export interface CamposAjustes {
  /** Tal como se tipeó. Se parsea acá, no en el componente. */
  montoNegativos: string;
  nota: string;
}

export interface AjustesValidados {
  montoNegativos: number;
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
    return { ok: false, error: 'Pon cuánto suman los ajustes del mes. Si no hubo ninguno, escribe 0.' };
  }
  if (negativos < 0) {
    return { ok: false, error: 'Los ajustes no pueden ser negativos: son plata a favor del personal.' };
  }

  const nota = campos.nota.trim();
  if (nota === '') {
    return { ok: false, error: 'Contá de dónde salen estos ajustes: sin nota nadie puede auditarlos después.' };
  }

  return { ok: true, datos: { montoNegativos: negativos, nota } };
}

/**
 * La aclaración pegada al faltante de empresa en el resumen. Ese monto YA NO
 * SE TIPEA: lo calcula la clasificación de productos, y el definitivo es el
 * que queda al liquidar. Mostrarlo sin decir de dónde sale invitaría a buscar
 * dónde corregirlo.
 */
export function notaFaltanteEmpresa(proyectada: boolean): string {
  return proyectada
    ? 'Lo calcula la clasificación de productos; el monto definitivo queda fijo al liquidar.'
    : 'Lo calculó la clasificación de productos al liquidar.';
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
