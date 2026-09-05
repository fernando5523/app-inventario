import { describe, expect, it, vi } from 'vitest';

// _http.ts importa react-native/expo-constants (para la URL base) — Node no
// los parsea. Mismo mock que _http.test.ts y hojas-sqlite.test.ts: se
// reemplazan ANTES de importar nada que arrastre _http.
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

import { ErrorApi } from './adaptadores/_http';
import { mensajeDeErrorIngreso } from './mensaje-error-ingreso';

// Un 429 tal como llega desde _http.ts: el `detalles` del body ya parseado.
const MENSAJE_BACKEND = 'Demasiados intentos de ingreso. Volve a intentar en unos minutos.';
const con429 = (detalles: unknown) =>
  new ErrorApi('demasiados-intentos', { mensaje: MENSAJE_BACKEND, detalles });

describe('mensajeDeErrorIngreso: "demasiados intentos" dice el minuto exacto', () => {
  it('redondea los segundos del backend HACIA ARRIBA a minutos', () => {
    expect(mensajeDeErrorIngreso(con429({ reintentarEnSegundos: 180 }))).toBe('Demasiados intentos. Esperá 3 min antes de volver a probar.');
    // 61 s NO es "1 min": a ese minuto todavía está bloqueada. Redondea a 2.
    expect(mensajeDeErrorIngreso(con429({ reintentarEnSegundos: 61 }))).toBe('Demasiados intentos. Esperá 2 min antes de volver a probar.');
    // Menos de un minuto redondea a 1, no a 0.
    expect(mensajeDeErrorIngreso(con429({ reintentarEnSegundos: 30 }))).toBe('Demasiados intentos. Esperá 1 min antes de volver a probar.');
  });

  it('0 segundos: "un momento", sin número', () => {
    expect(mensajeDeErrorIngreso(con429({ reintentarEnSegundos: 0 }))).toBe('Demasiados intentos. Esperá un momento antes de volver a probar.');
  });

  it('sin el campo (backend viejo, o detalles ausente): cae al mensaje del backend, no inventa un tiempo', () => {
    expect(mensajeDeErrorIngreso(con429(undefined))).toBe(MENSAJE_BACKEND);
    expect(mensajeDeErrorIngreso(con429({ otraCosa: 1 }))).toBe(MENSAJE_BACKEND);
    // Un valor basura tampoco se usa: negativo o no numérico → mensaje del backend.
    expect(mensajeDeErrorIngreso(con429({ reintentarEnSegundos: -5 }))).toBe(MENSAJE_BACKEND);
    expect(mensajeDeErrorIngreso(con429({ reintentarEnSegundos: 'pronto' }))).toBe(MENSAJE_BACKEND);
  });

  it('otro error de API (PIN incorrecto): muestra su propio mensaje, no el de espera', () => {
    expect(mensajeDeErrorIngreso(new ErrorApi('credenciales-invalidas', { mensaje: 'PIN incorrecto.' }))).toBe('PIN incorrecto.');
  });

  it('un error que no es de API: mensaje del Error, o genérico si ni Error es', () => {
    expect(mensajeDeErrorIngreso(new Error('algo raro'))).toBe('algo raro');
    expect(mensajeDeErrorIngreso('caída suelta')).toBe('Intentá de nuevo.');
  });
});
