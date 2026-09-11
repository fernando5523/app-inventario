import { describe, expect, it } from 'vitest';
import {
  debeReintentarAutomaticamente,
  debeRefrescar,
  esVueltaAPrimerPlano,
  MAX_REINTENTOS_AUTOMATICOS,
  REINTENTO_INICIAL,
  trasIntentoFallido,
  type EstadoApp,
} from './refresco';
import { cifraMisHojas } from '../../lib/dominio/cifra-sin-red';

describe('esVueltaAPrimerPlano', () => {
  it('background -> active: la persona volvió a la app', () => {
    expect(esVueltaAPrimerPlano('background', 'active')).toBe(true);
  });

  it('inactive -> active: también cuenta (iOS, salir del switcher)', () => {
    expect(esVueltaAPrimerPlano('inactive', 'active')).toBe(true);
  });

  it('active -> active NO cuenta: AppState repite el evento en algunos equipos', () => {
    // Sin esta guarda, cada evento espurio dispararía una recarga.
    expect(esVueltaAPrimerPlano('active', 'active')).toBe(false);
  });

  it.each<[EstadoApp, EstadoApp]>([
    ['active', 'background'],
    ['active', 'inactive'],
    ['background', 'inactive'],
    ['inactive', 'background'],
  ])('%s -> %s: irse o moverse fuera de foco nunca refresca', (anterior, siguiente) => {
    expect(esVueltaAPrimerPlano(anterior, siguiente)).toBe(false);
  });

  it('lo que importa es el CAMBIO, no el estado nuevo', () => {
    // Mismo estado final `active`, distinto resultado según de dónde venía.
    expect(esVueltaAPrimerPlano('background', 'active')).toBe(true);
    expect(esVueltaAPrimerPlano('active', 'active')).toBe(false);
  });
});

describe('debeRefrescar', () => {
  it('en reposo y sin pausa: refresca', () => {
    expect(debeRefrescar({ enVuelo: false, pausado: false })).toBe(true);
  });

  it('con una recarga ya corriendo: no dispara otra', () => {
    // Enfocar la pantalla y volver de segundo plano pasan JUNTOS al
    // desbloquear el teléfono: sin el candado salen dos pedidas iguales y la
    // que conteste segunda pisa a la primera.
    expect(debeRefrescar({ enVuelo: true, pausado: false })).toBe(false);
  });

  it('pausado: no refresca, aunque no haya nada en vuelo', () => {
    // Modal abierto o formulario a medio escribir. Refrescar acá le cierra
    // el modal o le pisa lo que escribió: es perder trabajo de la persona.
    expect(debeRefrescar({ enVuelo: false, pausado: true })).toBe(false);
  });

  it('pausado gana aunque tampoco haya nada corriendo: es la regla, no una optimización', () => {
    expect(debeRefrescar({ enVuelo: true, pausado: true })).toBe(false);
  });

  it.each([
    [false, false, true],
    [true, false, false],
    [false, true, false],
    [true, true, false],
  ])('enVuelo=%s pausado=%s -> %s', (enVuelo, pausado, esperado) => {
    expect(debeRefrescar({ enVuelo, pausado })).toBe(esperado);
  });
});

// ---------------------------------------------------------------------------
// Bug real (2026-09-11): "0 hojas asignadas" en Inicio (Contador) se
// arreglaba SOLO al entrar a Mis hojas y volver -- no porque esa pantalla
// haga algo distinto (usa el MISMO useRefrescoAlEnfocar), sino porque cada
// visita es un REINTENTO nuevo, y el fallo original era transitorio. El
// cliente fue explícito: ningún dato depende de navegar a otra pantalla --
// Inicio tiene que reintentar SOLO, sin que nadie la enfoque de nuevo.
// ---------------------------------------------------------------------------
describe('debeReintentarAutomaticamente / trasIntentoFallido', () => {
  it('con cero intentos previos (recién falló la primera vez), corresponde reintentar', () => {
    expect(debeReintentarAutomaticamente(REINTENTO_INICIAL)).toBe(true);
  });

  it('deja de insistir solo al agotar el cupo -- a partir de ahí, el próximo foco (o "Reintentar" a mano) retoma', () => {
    let estado = REINTENTO_INICIAL;
    for (let i = 0; i < MAX_REINTENTOS_AUTOMATICOS; i++) {
      expect(debeReintentarAutomaticamente(estado)).toBe(true);
      estado = trasIntentoFallido(estado);
    }
    expect(debeReintentarAutomaticamente(estado)).toBe(false);
  });

  it('trasIntentoFallido solo suma, nunca resetea sola -- el éxito es lo único que vuelve a REINTENTO_INICIAL', () => {
    expect(trasIntentoFallido(REINTENTO_INICIAL)).toEqual({ intentos: 1 });
    expect(trasIntentoFallido({ intentos: 3 })).toEqual({ intentos: 4 });
  });
});

describe('el ciclo completo: descarga en curso -> Inicio dice "—"; descarga termina -> muestra el número real, sin navegar a ningún lado', () => {
  it('falla, falla, y al tercer intento automático la descarga sale bien: la cifra pasa de null a la cantidad real', () => {
    // Simula lo que hace InicioScreen en cada reintento automático: llamar
    // cifraMisHojas() con el resultado de ESE intento. Nada acá navega ni
    // enfoca ninguna pantalla -- es la misma función pura, invocada de
    // nuevo por el propio mecanismo de reintento, no por una visita a Mis
    // hojas.
    let estado = REINTENTO_INICIAL;

    // Intento 1: falla (el timeout real que vio el cliente).
    let cifra = cifraMisHojas([], { ok: false, motivo: 'sin-red' });
    expect(cifra).toBeNull(); // Inicio muestra "—"
    expect(debeReintentarAutomaticamente(estado)).toBe(true);
    estado = trasIntentoFallido(estado);

    // Intento 2 (automático, sin que nadie toque la pantalla): falla de nuevo.
    cifra = cifraMisHojas([], { ok: false, motivo: 'sin-red' });
    expect(cifra).toBeNull();
    expect(debeReintentarAutomaticamente(estado)).toBe(true);
    estado = trasIntentoFallido(estado);

    // Intento 3 (automático): la descarga YA terminó bien -- llegaron 2 hojas.
    cifra = cifraMisHojas([{}, {}], { ok: true });
    expect(cifra).toBe(2); // Inicio muestra "2", nadie navegó a ningún lado.
  });
});
