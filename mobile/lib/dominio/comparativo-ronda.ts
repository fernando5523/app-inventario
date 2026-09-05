/**
 * El comparativo contra Dynamics de una ronda, listo para mostrar en la
 * pantalla del Ciclo.
 *
 * Vive acá y no dentro del componente porque es una regla de presentación con
 * casos borde reales (ronda sin abrir, ronda sin ítems auditables), y se
 * prueba sin montar la pantalla.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO NO ROMPE EL CONTEO CIEGO
 * ---------------------------------------------------------------------------
 * Trabaja sobre `ResumenRonda`, que son AGREGADOS: cuántos cuadraron, cuántos
 * pasan a recontar, cuántos sin stock del ERP. Nunca el stock de un ítem
 * puntual. Por eso el Coordinador puede verlo mientras todavía coordina el
 * conteo: de "1.100 cuadraron y 136 pasan al 2do" no se deduce cuánto stock
 * espera el ERP de ningún artículo.
 *
 * La matriz de auditoría —que sí trae `stockErp` y `precioVenta` por ítem— es
 * del Auditor y NO se usa acá. Si alguna vez hiciera falta para llenar un
 * paso de esta pantalla, es una decisión de negocio, no un cambio técnico.
 */

/** Lo mínimo de `ResumenRonda` que necesita el comparativo. */
export interface ResumenParaMostrar {
  total: number;
  cuadrados: number;
  aRecontar: number;
  sinContar: number;
  sinDatoErp: number;
}

export interface ComparativoVisible {
  avance: { pct: number; texto: string };
  detalle: string;
}

/**
 * `null` cuando la ronda todavía no existe (el endpoint responde 404 y quien
 * llama pasa `null`) o cuando no entró ningún ítem.
 *
 * La distinción importa y por eso el llamador muestra dos textos distintos:
 * "todavía no empezó" NO es lo mismo que "no lo podemos calcular". Decir lo
 * segundo cuando pasa lo primero hace que el Coordinador crea que el sistema
 * está roto justo cuando funciona como debe.
 */
export function comparativoDeRonda(
  r: ResumenParaMostrar | null,
  formatoNumero: (n: number) => string,
  formatoPct: (n: number) => string,
): ComparativoVisible | null {
  if (r === null || r.total === 0) return null;

  // El porcentaje se calcula sobre los AUDITABLES, no sobre el total: un ítem
  // sin stock en el ERP no puede cuadrar ni dejar de cuadrar, y meterlo en el
  // denominador haría que el ciclo parezca peor de lo que está.
  const auditables = r.total - r.sinDatoErp;
  const pct = auditables === 0 ? 0 : (r.cuadrados / auditables) * 100;

  // Solo se nombra lo que NO es cero: "0 sin contar" es ruido que compite con
  // las cifras que sí importan.
  const partes = [`${formatoNumero(r.cuadrados)} cuadraron contra Dynamics`];
  if (r.aRecontar > 0) partes.push(`${formatoNumero(r.aRecontar)} pasan al siguiente conteo`);
  if (r.sinContar > 0) partes.push(`${formatoNumero(r.sinContar)} sin contar`);
  if (r.sinDatoErp > 0) partes.push(`${formatoNumero(r.sinDatoErp)} sin stock en el ERP`);

  return {
    avance: {
      pct,
      texto: `${formatoNumero(r.cuadrados)} de ${formatoNumero(auditables)} ítems cuadrados (${formatoPct(pct)}%)`,
    },
    detalle: `${partes.join(' · ')}.`,
  };
}
