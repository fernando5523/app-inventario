/**
 * QUE EL BACKEND SIRVA LA WEB Y QUE UN F5 EN UNA SUB-RUTA NO DE 404.
 *
 * ---------------------------------------------------------------------------
 * EL BUG, MEDIDO EN EL NAVEGADOR
 * ---------------------------------------------------------------------------
 * `http://host/auditor/comparativo` escrito a mano devolvia 404. El export de
 * web es UNA sola pagina y el ruteo lo hace expo-router en el cliente; el
 * servidor no sabe que cualquier ruta que no reconoce tiene que devolver ese
 * index.html. En el telefono el problema no existe (no hay barra de
 * direcciones); en la web es lo primero que hace cualquiera: marcar favorito
 * y apretar F5.
 *
 * ---------------------------------------------------------------------------
 * LAS TRES COSAS QUE SE FIJAN ACA, Y POR QUE CADA UNA
 * ---------------------------------------------------------------------------
 * 1. Una ruta de app devuelve el index -> el F5 deja de romper.
 * 2. `/api/loquesea` sigue siendo 404 JSON -> el fallback NO se come la API.
 *    Si se la comiera, el front recibiria una PAGINA donde espera JSON y
 *    fallaria con `Unexpected token '<'`, que no nombra ni la ruta ni el
 *    metodo.
 * 3. Sin carpeta `public/` el backend arranca igual -> es el caso corriente
 *    de `npm run dev` en la maquina, y una carpeta que solo existe dentro del
 *    contenedor no puede ser un error de arranque.
 *
 * Se levanta la app de verdad en un puerto efimero (mismo helper que los
 * `*.routes.test.ts`) porque lo que se prueba es justamente el ORDEN de los
 * middlewares, y eso no se ve mirando el codigo.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { crearApp } from './app';
import { levantar } from '../test-utils/http-test';

const INDICE = '<!DOCTYPE html><html><head><title>Inventario Movil</title></head><body><div id="root"></div></body></html>';

const aBorrar: string[] = [];
let cerrar: (() => Promise<void>) | undefined;

/** Una carpeta como la que deja `expo export --platform web`: index + un bundle. */
function carpetaWebDePrueba(): string {
  const raiz = mkdtempSync(join(tmpdir(), 'web-export-'));
  aBorrar.push(raiz);
  writeFileSync(join(raiz, 'index.html'), INDICE);
  mkdirSync(join(raiz, '_expo'), { recursive: true });
  writeFileSync(join(raiz, '_expo', 'entry.js'), 'console.log(1)');
  return raiz;
}

async function servir(carpetaWeb: string): Promise<string> {
  const { baseUrl, cerrar: apagar } = await levantar(crearApp({ carpetaWeb }));
  cerrar = apagar;
  return baseUrl;
}

afterEach(async () => {
  await cerrar?.();
  cerrar = undefined;
  for (const ruta of aBorrar.splice(0)) rmSync(ruta, { recursive: true, force: true });
});

describe('con la web exportada en public/', () => {
  it('una ruta de app devuelve el index, no un 404', async () => {
    const base = await servir(carpetaWebDePrueba());
    const r = await fetch(`${base}/auditor/comparativo`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    expect(await r.text()).toContain('<div id="root">');
  });

  /** Una ruta anidada y otra con punto: las dos son rutas de la app, no archivos. */
  it('vale para cualquier profundidad de ruta', async () => {
    const base = await servir(carpetaWebDePrueba());
    for (const ruta of ['/', '/coordinador/armar', '/conteo/contar/12', '/auditor/liquidacion']) {
      const r = await fetch(`${base}${ruta}`);
      expect(`${ruta} -> ${r.status}`).toBe(`${ruta} -> 200`);
      expect(await r.text()).toContain('id="root"');
    }
  });

  it('los archivos de verdad se sirven tal cual, no el index', async () => {
    const base = await servir(carpetaWebDePrueba());
    const r = await fetch(`${base}/_expo/entry.js`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('console.log(1)');
  });

  /**
   * LA QUE IMPORTA: el fallback no puede comerse la API. Sin esto, el front
   * recibe HTML donde espera JSON y el error que ve quien depura es
   * `Unexpected token '<'`, que no dice ni la ruta ni el metodo.
   */
  it('una ruta de API que no existe sigue siendo 404 JSON', async () => {
    const base = await servir(carpetaWebDePrueba());
    const r = await fetch(`${base}/api/loquesea`);
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('application/json');
    const cuerpo = (await r.json()) as { error: string };
    expect(cuerpo.error).toContain('/api/loquesea');
    expect(cuerpo.error).not.toContain('<');
  });

  it('y tampoco con un metodo que no sea GET', async () => {
    const base = await servir(carpetaWebDePrueba());
    const r = await fetch(`${base}/api/loquesea`, { method: 'POST' });
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('application/json');
  });

  /**
   * Bajo un prefijo que SI tiene router, el 401 de sesion llega antes que
   * este 404 -- y esta bien: a quien no se identifico no se le cuenta que
   * rutas existen. Lo que importa para el bug es que tampoco ahi salga HTML.
   */
  it('bajo un prefijo con router, el corte de sesion tambien responde JSON', async () => {
    const base = await servir(carpetaWebDePrueba());
    const r = await fetch(`${base}/api/inventarios/1/loquesea`, { method: 'POST' });
    expect(r.status).toBe(401);
    expect(r.headers.get('content-type')).toContain('application/json');
  });

  /**
   * Un POST a una ruta que no es de la API tampoco puede devolver la pagina:
   * el fallback es solo GET. Devolver el index ante un POST le diria a quien
   * lo mande que existe un endpoint que no existe.
   */
  it('el fallback es solo para GET', async () => {
    const base = await servir(carpetaWebDePrueba());
    const r = await fetch(`${base}/auditor/comparativo`, { method: 'POST' });
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain('id="root"');
  });

  it('/salud sigue siendo JSON y no se lo lleva el fallback', async () => {
    const base = await servir(carpetaWebDePrueba());
    const r = await fetch(`${base}/salud`);
    expect(await r.json()).toEqual({ ok: true });
  });
});

describe('sin carpeta public/ (el caso de `npm run dev`)', () => {
  it('el backend arranca igual y la API responde', async () => {
    const base = await servir(join(tmpdir(), 'no-existe-esta-carpeta-de-web'));
    const r = await fetch(`${base}/salud`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it('una ruta de app da 404 y NO un 500 por un index que no esta', async () => {
    const base = await servir(join(tmpdir(), 'no-existe-esta-carpeta-de-web'));
    const r = await fetch(`${base}/auditor/comparativo`);
    expect(r.status).toBe(404);
  });

  /** Una carpeta que existe pero esta vacia (un COPY que no copio nada) cuenta como "sin web". */
  it('una carpeta vacia tampoco monta el fallback', async () => {
    const vacia = mkdtempSync(join(tmpdir(), 'web-vacia-'));
    aBorrar.push(vacia);
    const base = await servir(vacia);
    expect((await fetch(`${base}/auditor/comparativo`)).status).toBe(404);
  });

  it('la API que no existe sigue dando 404 JSON', async () => {
    const base = await servir(join(tmpdir(), 'no-existe-esta-carpeta-de-web'));
    const r = await fetch(`${base}/api/loquesea`);
    expect(r.status).toBe(404);
    expect(r.headers.get('content-type')).toContain('application/json');
  });
});

/**
 * LA CSP, QUE ES LO QUE DEJA CARGAR (O NO) EL BUNDLE.
 *
 * Los dos valores de abajo salen de medir en Chrome contra este mismo
 * backend, no de leer documentacion -- ver el comentario de
 * `OPCIONES_HELMET_CON_WEB` en app.ts. Se fijan con un test porque los dos
 * fallan MUDOS: uno deja la pantalla en blanco y el otro rompe solo la parte
 * que usa la base local.
 */
describe('la CSP cuando se sirve la web', () => {
  it('deja compilar WebAssembly (expo-sqlite en web) sin habilitar eval()', async () => {
    const base = await servir(carpetaWebDePrueba());
    const csp = (await fetch(`${base}/auditor/comparativo`)).headers.get('content-security-policy') ?? '';
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval';");
    expect(csp).not.toContain("script-src 'self' 'unsafe-eval'");
  });

  it('no fuerza https, que sobre http deja la pagina sin su bundle', async () => {
    const base = await servir(carpetaWebDePrueba());
    const csp = (await fetch(`${base}/auditor/comparativo`)).headers.get('content-security-policy') ?? '';
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('sin web servida, helmet queda de fabrica: no se afloja nada', async () => {
    const base = await servir(join(tmpdir(), 'no-existe-esta-carpeta-de-web'));
    const csp = (await fetch(`${base}/salud`)).headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'wasm-unsafe-eval'");
    expect(csp).toContain('upgrade-insecure-requests');
  });
});
