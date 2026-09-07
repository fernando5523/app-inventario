/**
 * La lógica de teclear un dígito en TecladoPin, SIN React ni react-native —
 * para poder probar la carrera que rompía el reseteo de PIN sin renderizar el
 * modal (bajo vitest, `react-native` ni siquiera transforma).
 *
 * EL BUG QUE ESTO EXISTE PARA CERRAR (release 2.12.0): al teclear el último
 * dígito, TecladoPin hacía `onCambiar(nuevo)` y ACTO SEGUIDO `onCerrar()`.
 * `onCambiar` es un `setState` del padre —asíncrono—, así que un handler que
 * corriera dentro de `onCerrar` y leyera el estado del padre veía el valor
 * del render ANTERIOR (5 dígitos, no 6). En el reseteo de PIN (UsuariosScreen)
 * eso caía en un guard `pin.length !== LARGO_PIN` y volvía sin llamar al
 * backend: return silencioso, el PIN nunca cambiaba y no había error.
 *
 * La regla: el valor FINAL viaja como DATO de vuelta (lo devuelve `teclear`),
 * nunca se lee del estado del padre. Quien completa el PIN recibe los
 * `longitud` dígitos como argumento.
 */
export interface ResultadoTecla {
  /**
   * El valor tras aplicar la tecla. `null` cuando el teclado ya estaba lleno
   * (la tecla se ignora), para distinguirlo de un valor vacío legítimo.
   */
  valor: string | null;
  /** true cuando el valor llegó a `longitud`: hay que disparar `onCompletar`. */
  completo: boolean;
}

export function teclear(valor: string, digito: string, longitud: number): ResultadoTecla {
  if (valor.length >= longitud) return { valor: null, completo: false };
  const nuevo = valor + digito;
  return { valor: nuevo, completo: nuevo.length === longitud };
}

/**
 * Qué hacer al teclear un dígito, con la REGLA DEL OJO (decisión del cliente,
 * 2026-09-07). Al completar los `longitud` dígitos:
 *   - ojo APAGADO  → 'confirma': se confirma solo, como siempre (cero toques
 *     extra para quien tipea bien y no revela).
 *   - ojo PRENDIDO → 'espera': NO se cierra; el teclado muestra el PIN
 *     revelado y pide UN toque de confirmación, para poder revisarlo antes de
 *     mandarlo. El repaso aparece solo para quien lo pidió al prender el ojo.
 * Un dígito intermedio siempre 'sigue'; con el teclado lleno se 'ignora'.
 *
 * El valor final viaja en el resultado (mismo motivo que `teclear`): quien
 * confirma recibe los `longitud` dígitos, nunca el estado del padre.
 */
export type AccionTecla =
  | { tipo: 'sigue'; valor: string }
  | { tipo: 'confirma'; valor: string }
  | { tipo: 'espera'; valor: string }
  | { tipo: 'ignora' };

export function accionAlTeclear(valor: string, digito: string, longitud: number, revelado: boolean): AccionTecla {
  const { valor: nuevo, completo } = teclear(valor, digito, longitud);
  if (nuevo === null) return { tipo: 'ignora' };
  if (!completo) return { tipo: 'sigue', valor: nuevo };
  return revelado ? { tipo: 'espera', valor: nuevo } : { tipo: 'confirma', valor: nuevo };
}
