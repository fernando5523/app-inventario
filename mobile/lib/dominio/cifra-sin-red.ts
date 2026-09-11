/**
 * Cómo se muestra un número que puede no haberse podido traer del
 * servidor (sin red). Nace del hallazgo de la auditoría de "números que
 * mienten" en InicioScreen.tsx: sin red, `items`/`totalHojas` quedaban en
 * `0` y la pantalla decía "0 hojas · 0 ítems" — un cero que significa "no
 * lo sé" mostrado como si significara "no hay ninguno". La cadena entera
 * (InicioScreen) ahora guarda esos dos campos como `number | null`;
 * `null` es "no se pudo traer", nunca "vale cero".
 */

/**
 * El valor tal cual, o "—" cuando no se pudo traer. Nunca un cero
 * inventado en su lugar.
 */
export function cifraOSinRed(valor: number | null, formatear: (n: number) => string = String): string {
  return valor === null ? '—' : formatear(valor);
}

/**
 * El sufijo "/ total (pct%)" de una fila de avance — nunca con `total` en
 * 0 como denominador, en NINGUNO de los dos sentidos en que puede llegar a
 * serlo: `null` (sin red, no se sabe el total) dice "sin red"; `0` real
 * (el inventario existe pero todavía no tiene hojas creadas) dice "sin
 * hojas creadas". Ninguno de los dos casos calcula un "0%" que sonaría a
 * "no avanzó nada" cuando en realidad no hay nada que avanzar todavía.
 */
export function filaPct(parte: number, total: number | null): string {
  if (total === null) return 'sin red';
  if (total === 0) return 'sin hojas creadas';
  return `/ ${total} (${Math.round((parte / total) * 100)}%)`;
}

/** Los motivos por los que una descarga de hojas puede no haber salido bien (hojas-sqlite.ts#ResultadoDescarga). */
export type MotivoSinRed = 'sin-red' | 'sesion-vencida' | 'error' | 'incompleta';

/**
 * Cuántas hojas propias mostrar en Inicio (Contador). Bug real
 * (2026-09-10): `hojasSqlite.mias()` puede devolver `[]` porque la
 * descarga de esa ronda todavía no terminó o falló -- ese `[]` no es "no
 * tenés ninguna hoja asignada", es "no se sabe todavía". Esa distinción
 * vive en `ultimaDescarga()` (hojas-sqlite.ts), que Inicio no consultaba.
 *
 * `null` = el cero que se ve NO es un hecho, nunca se muestra como "0".
 * Un array con hojas siempre devuelve la cantidad real: si HAY hojas, el
 * cero no puede haber sido inventado.
 */
export function cifraMisHojas(misHojas: readonly unknown[], resultado: { ok: boolean; motivo?: MotivoSinRed } | null): number | null {
  if (misHojas.length === 0 && resultado?.ok !== true) return null;
  return misHojas.length;
}

/** Texto corto para la fila de estado cuando `cifraMisHojas` da `null`. */
export function motivoCorto(motivo: MotivoSinRed | undefined): string {
  switch (motivo) {
    case 'sin-red':
      return 'sin red';
    case 'sesion-vencida':
      return 'sesión vencida';
    case 'incompleta':
      return 'descarga incompleta';
    default:
      return 'no se pudo bajar';
  }
}
