import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Rol } from '../../lib/dominio/tipos';
import { ACCESOS_POR_ROL } from './accesos';

const rutas = (rol: Rol): (string | undefined)[] => ACCESOS_POR_ROL[rol].map((a) => a.ruta);
const llevaALiquidacion = (ruta: string | undefined): boolean => ruta?.includes('liquidacion') ?? false;

/**
 * DECISIÓN DEL CLIENTE (2026-09-11): la liquidación pasa del Coordinador al
 * Auditor -- "el Coordinador deja de ver la liquidacion y ejecutarlo, ahora lo
 * realiza el auditor". El backend ya le responde 403 al coordinador
 * (liquidacion.permisos.ts): una tarjeta que lleva a una pantalla que solo
 * puede fallar es peor que no tenerla.
 */
describe('ACCESOS_POR_ROL: Liquidación y nómina', () => {
  it('el Coordinador ya NO la tiene', () => {
    expect(rutas('coordinador').some(llevaALiquidacion)).toBe(false);
  });

  it('el Auditor SÍ, en su propio grupo de rutas', () => {
    expect(rutas('auditor')).toContain('/auditor/liquidacion');
  });

  it('el Administrador tampoco: es técnico, no participa del proceso de inventario', () => {
    expect(rutas('administrador').some(llevaALiquidacion)).toBe(false);
  });

  it('en el Auditor va ANTES que el lacrado: se liquida primero, se lacra después', () => {
    const delAuditor = rutas('auditor');
    expect(delAuditor.indexOf('/auditor/liquidacion')).toBeLessThan(delAuditor.indexOf('/auditor/lacrado'));
  });
});

/**
 * Cada acceso tiene que abrir una pantalla que EXISTE. Mover un archivo de
 * app/<rol>/ sin tocar acá deja una tarjeta que lleva a "Unmatched route", y
 * ningún otro test lo ve: expo-router resuelve la ruta recién cuando alguien
 * la toca en el teléfono.
 */
describe('ACCESOS_POR_ROL: cada ruta tiene su pantalla', () => {
  // `fileURLToPath(import.meta.url)` y no `new URL(...)`: con lib DOM y los
  // tipos de node juntos, los dos `URL` no son el mismo tipo para tsc.
  const carpetaApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app');
  const conRuta = Object.values(ACCESOS_POR_ROL)
    .flat()
    .flatMap((a) => (a.ruta === undefined ? [] : [[a.ruta, a.titulo] as const]));

  it.each(conRuta)('%s (%s)', (ruta) => {
    expect(fs.existsSync(path.join(carpetaApp, `${ruta}.tsx`))).toBe(true);
  });
});
