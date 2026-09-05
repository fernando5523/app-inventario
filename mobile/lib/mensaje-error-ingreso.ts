import { esErrorApi } from './adaptadores/_http';

/**
 * Los segundos de espera que mandó el servidor en un 429, si vinieron.
 *
 * El limitador de login (backend `sesion.routes.ts`, campo agregado en
 * f2a372e) responde `{ error, detalles: { reintentarEnSegundos } }` — el mismo
 * contrato `{error, detalles}` que `_http.ts` ya parsea a `ErrorApi.detalles`,
 * así que acá NO hace falta tocar el cliente HTTP: el dato ya llegó. `detalles`
 * es `unknown` (puede venir de cualquier endpoint), por eso se valida a mano.
 * `null` si no vino o no es un número >= 0: nunca se inventa un tiempo.
 */
function segundosDeEspera(detalles: unknown): number | null {
  if (typeof detalles !== 'object' || detalles === null) return null;
  const valor = (detalles as { reintentarEnSegundos?: unknown }).reintentarEnSegundos;
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 ? valor : null;
}

/**
 * El texto a mostrar cuando falla el ingreso.
 *
 * Para "demasiados intentos" (429) con tiempo del servidor, dice el minuto
 * EXACTO, redondeado HACIA ARRIBA: decir "1 min" cuando faltan 90 s y a ese
 * minuto la persona sigue bloqueada es peor que redondear para arriba y que
 * entre un toque antes. Con 0 segundos, "un momento" (sin número).
 *
 * Sin ese dato — el backend viejo, u otra clase de error — cae al mensaje que
 * ya venía: el del backend pensado para la persona, o uno genérico. Nunca se
 * inventa un tiempo que no dijo el servidor.
 */
export function mensajeDeErrorIngreso(error: unknown): string {
  if (esErrorApi(error) && error.clase === 'demasiados-intentos') {
    const segundos = segundosDeEspera(error.detalles);
    if (segundos !== null) {
      const minutos = Math.ceil(segundos / 60);
      return minutos > 0
        ? `Demasiados intentos. Esperá ${minutos} min antes de volver a probar.`
        : 'Demasiados intentos. Esperá un momento antes de volver a probar.';
    }
    // Sin el campo: el mensaje del backend ("…en unos minutos"), como antes.
  }
  if (error instanceof Error) return error.message;
  return 'Intentá de nuevo.';
}
