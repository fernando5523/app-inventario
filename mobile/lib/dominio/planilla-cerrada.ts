/**
 * EL TEXTO DE LA PLANILLA YA LIQUIDADA, igual en el teléfono y en la web.
 *
 * Bugs reales (2026-11-19, Raymondi): la tarjeta "Planilla cerrada" solo
 * aparecía justo después de liquidar, en la misma sesión. Al volver a la
 * pantalla, un inventario liquidado —y hasta lacrado— ofrecía "Liquidar este
 * inventario" de nuevo (el servidor lo rechazaba). Y la tarjeta escribía la
 * hora del reloj y el nombre de quien estuviera mirando, no los de quien
 * liquidó. Todo sale ahora de la liquidación que manda el servidor.
 */
import type { Liquidacion } from '../puertos/repositorios';
import { pluralizar } from './plural';

export function textoPlanillaCerrada(
  l: Pick<Liquidacion, 'liquidadoEn' | 'liquidadoPor' | 'lacrado' | 'planilla'>,
  fecha: (iso: string) => string,
  soles: (n: number) => string,
): { resumen: string; siguiente: string; boton: string } {
  const n = l.planilla.length;
  const total = l.planilla.reduce((c, p) => c + Math.round(p.monto * 100), 0) / 100;
  const cuando =
    l.liquidadoEn === null
      ? 'Planilla liquidada.'
      : `Liquidado el ${fecha(l.liquidadoEn)}${l.liquidadoPor ? ` por ${l.liquidadoPor}` : ''}.`;
  return {
    resumen: `${cuando} Los descuentos de ${n} ${pluralizar(n, 'colaborador', 'colaboradores')} quedaron firmes por ${soles(total)} en total.`,
    siguiente: l.lacrado
      ? 'El inventario ya está lacrado: esta planilla quedó dentro del sello.'
      : 'El paso que sigue es la aprobación y el lacrado: el sello incluye esta planilla.',
    boton: l.lacrado ? 'Ver el lacrado' : 'Ir a aprobación y lacrado',
  };
}
