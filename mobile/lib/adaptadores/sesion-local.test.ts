/**
 * Dónde vive la sesión en el teléfono: el almacén seguro, y la migración desde
 * la base SQLite sin cifrar de la versión anterior. Ver `sesion-local.ts`.
 *
 * Los dos almacenes son falsos y en memoria: lo que se prueba es la regla de
 * qué se guarda dónde, qué se borra y qué no se pisa.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Sesion } from '../dominio/tipos';

const estado = vi.hoisted(() => ({
  seguro: new Map<string, string>(),
  tablaVieja: false,
  filaVieja: null as { payload: string } | null,
  archivoBorrado: 0,
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (clave: string) => estado.seguro.get(clave) ?? null,
  setItemAsync: async (clave: string, valor: string) => {
    estado.seguro.set(clave, valor);
  },
  deleteItemAsync: async (clave: string) => {
    estado.seguro.delete(clave);
  },
}));

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => ({
    getFirstAsync: async (sql: string) => {
      if (sql.includes('sqlite_master')) return estado.tablaVieja ? { name: 'sesion_activa' } : null;
      return estado.filaVieja;
    },
    closeAsync: async () => {},
  }),
  deleteDatabaseAsync: async () => {
    estado.archivoBorrado += 1;
  },
}));

function sesion(token: string, expiraEnMs: number): Sesion {
  return {
    colaborador: { id: 9003, nombre: 'Contador', dni: '00000001', rol: 'conteo' },
    sucursal: { id: 9002, nombre: 'Market Raymondi', colaboradores: 2 },
    token,
    expiraEn: new Date(Date.now() + expiraEnMs).toISOString(),
  };
}

const UNA_HORA = 60 * 60 * 1000;

/** Módulo nuevo en cada prueba: la migración corre una vez por carga. */
async function cargar() {
  vi.resetModules();
  return import('./sesion-local');
}

beforeEach(() => {
  estado.seguro.clear();
  estado.tablaVieja = false;
  estado.filaVieja = null;
  estado.archivoBorrado = 0;
});

describe('la sesión en el teléfono', () => {
  it('se guarda en el almacén seguro y se lee de ahí', async () => {
    const { guardarSesionLocal, leerSesionLocal } = await cargar();
    const s = sesion('tok-nuevo', UNA_HORA);

    await guardarSesionLocal(s);

    expect(JSON.parse(estado.seguro.get('sesion_activa') ?? 'null')).toEqual(s);
    expect(await leerSesionLocal()).toEqual(s);
  });

  it('una sesión vencida se borra y no se devuelve', async () => {
    const { guardarSesionLocal, leerSesionLocal } = await cargar();
    await guardarSesionLocal(sesion('tok-viejo', -UNA_HORA));

    expect(await leerSesionLocal()).toBeNull();
    expect(estado.seguro.has('sesion_activa')).toBe(false);
  });

  it('cerrar sesión la saca del almacén seguro', async () => {
    const { guardarSesionLocal, borrarSesionLocal, leerSesionLocal } = await cargar();
    await guardarSesionLocal(sesion('tok', UNA_HORA));

    await borrarSesionLocal();

    expect(await leerSesionLocal()).toBeNull();
  });
});

describe('la migración desde la versión anterior', () => {
  it('pasa la sesión de SQLite al almacén seguro y borra el archivo entero', async () => {
    const vieja = sesion('tok-de-sqlite', UNA_HORA);
    estado.tablaVieja = true;
    estado.filaVieja = { payload: JSON.stringify(vieja) };
    const { leerSesionLocal } = await cargar();

    expect(await leerSesionLocal()).toEqual(vieja);
    expect(JSON.parse(estado.seguro.get('sesion_activa') ?? 'null')).toEqual(vieja);
    // El archivo, no la fila: un DELETE deja el token en las páginas libres.
    expect(estado.archivoBorrado).toBe(1);
  });

  it('no pisa una sesión que ya está en el almacén seguro', async () => {
    const nueva = sesion('tok-nuevo', UNA_HORA);
    estado.seguro.set('sesion_activa', JSON.stringify(nueva));
    estado.tablaVieja = true;
    estado.filaVieja = { payload: JSON.stringify(sesion('tok-viejo', UNA_HORA)) };
    const { leerSesionLocal } = await cargar();

    expect(await leerSesionLocal()).toEqual(nueva);
    expect(estado.archivoBorrado).toBe(1);
  });

  it('sin base vieja no hay nada que mover, y corre una sola vez por arranque', async () => {
    const { leerSesionLocal } = await cargar();

    expect(await leerSesionLocal()).toBeNull();
    expect(await leerSesionLocal()).toBeNull();
    expect(estado.archivoBorrado).toBe(1);
  });
});
