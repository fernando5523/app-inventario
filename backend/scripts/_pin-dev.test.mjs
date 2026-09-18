/**
 * Candado contra la desalineacion entre `_pin-dev.mjs` y el seed.
 *
 * seed.ts se lee como TEXTO y nunca se importa: importarlo ejecuta `main()` y
 * escribe en la base. El test vive en scripts/ y es .mjs a proposito:
 * tsconfig.json solo compila los .ts de src/, asi que tsc no lo mira (y no
 * se queja de importar un .mjs sin tipos), y vitest lo encuentra igual con su
 * patron por defecto (*.test.mjs).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { PIN_DEV_POR_ROL, pinDev } from './_pin-dev.mjs';

const RUTA_SEED = fileURLToPath(new URL('../prisma/seed.ts', import.meta.url));

/** Los pares rol -> PIN del objeto literal `PIN_DEV_POR_ROL` de seed.ts. */
function pinesDelSeed() {
  const texto = readFileSync(RUTA_SEED, 'utf8');
  const bloque = /const PIN_DEV_POR_ROL\b[^=]*=\s*\{([^}]*)\}/.exec(texto);
  if (bloque === null) {
    throw new Error(
      `No se encontro "const PIN_DEV_POR_ROL = { ... }" en ${RUTA_SEED}. Si cambio de forma, hay que ajustar este test.`,
    );
  }
  const pares = [...bloque[1].matchAll(/['"]?(\w+)['"]?\s*:\s*['"](\d+)['"]/g)];
  return Object.fromEntries(pares.map(([, rol, pin]) => [rol, pin]));
}

describe('_pin-dev.mjs es espejo de prisma/seed.ts#PIN_DEV_POR_ROL', () => {
  it('tiene exactamente los mismos roles y PINs que el seed', () => {
    // Si falla, se cambio un PIN de un lado y no del otro. Manda el seed (es
    // lo que queda en la base): se corrige _pin-dev.mjs.
    expect({ ...PIN_DEV_POR_ROL }).toEqual(pinesDelSeed());
  });
});

describe('pinDev', () => {
  const pinAdminOriginal = process.env.PIN_ADMIN;
  afterEach(() => {
    if (pinAdminOriginal === undefined) delete process.env.PIN_ADMIN;
    else process.env.PIN_ADMIN = pinAdminOriginal;
  });

  it('devuelve el PIN de la tabla para cada rol', () => {
    delete process.env.PIN_ADMIN;
    for (const [rol, pin] of Object.entries(PIN_DEV_POR_ROL)) expect(pinDev(rol)).toBe(pin);
  });

  it('PIN_ADMIN pisa solo el del administrador', () => {
    process.env.PIN_ADMIN = '001000';
    expect(pinDev('administrador')).toBe('001000');
    expect(pinDev('auditor')).toBe(PIN_DEV_POR_ROL.auditor);
  });

  it('un rol desconocido es un error, no un PIN inventado', () => {
    expect(() => pinDev('supervisor')).toThrow(/supervisor/);
  });
});
