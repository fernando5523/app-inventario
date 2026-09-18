/**
 * Candado sobre `sincronizar-secuencias.ts`, el archivo que evita el P2002
 * (500 al crear una tienda o un usuario desde la app) despues de sembrar.
 *
 * NO TOCA LA BASE: prueba la consulta como TEXTO -- que escape los nombres de
 * tabla y que tome el GREATEST -- y las funciones contra un cliente falso.
 *
 * Vive en prisma/ y no en src/ porque tsconfig.json solo compila los .ts de
 * src/, asi que tsc no lo mira, y vitest lo encuentra igual con su patron por
 * defecto. Es el mismo criterio de scripts/_pin-dev.test.mjs.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SQL_SINCRONIZAR,
  describirSincronizacion,
  sincronizarSecuencias,
  sincronizarSecuenciasYAvisar,
  type SecuenciaSincronizada,
} from './sincronizar-secuencias';

/** Cliente de mentira: anota con que lo llamaron y devuelve filas fijas. */
function clienteFalso(filas: Array<{ tabla: string; valor: bigint }>) {
  const llamadas: Array<{ sql: string; valores: unknown[] }> = [];
  return {
    llamadas,
    $queryRawUnsafe(sql: string, ...valores: unknown[]): Promise<unknown> {
      llamadas.push({ sql, valores });
      return Promise.resolve(filas);
    },
  };
}

describe('SQL_SINCRONIZAR — la consulta, sin base de datos', () => {
  it('escapa los nombres de tabla dentro de Postgres, no los concatena', () => {
    // Si alguien reemplaza esto por concatenacion en TypeScript, el escape se
    // pierde. El nombre sale de pg_tables y lo escapa `format('%I')`.
    expect(SQL_SINCRONIZAR).toContain("format('%I.%I', t.schemaname, t.tablename)");
    expect(SQL_SINCRONIZAR).toContain("format('SELECT COALESCE(MAX(id), 0) AS maximo FROM %I.%I', c.esquema, c.tabla)");
    expect(SQL_SINCRONIZAR).toContain('pg_get_serial_sequence(');
  });

  it('no interpola NADA desde TypeScript: es una constante', () => {
    expect(SQL_SINCRONIZAR).not.toContain('${');
  });

  it('nunca baja un contador: setval sobre el GREATEST del MAX(id) y el ultimo valor', () => {
    // El GREATEST es el corazon del asunto. Sin el, borrar las filas mas
    // nuevas devolveria la secuencia hacia atras y repartiria ids que ya
    // estuvieron en uso.
    expect(SQL_SINCRONIZAR).toContain('GREATEST(maximo, COALESCE(ultimo, 0))');
    expect(SQL_SINCRONIZAR).toContain('setval(secuencia, GREATEST(maximo, COALESCE(ultimo, 0)), true)');
    expect(SQL_SINCRONIZAR).toContain('pg_sequence_last_value(');
  });

  it('saltea la tabla vacia cuya secuencia nunca se uso (setval en 0 seria un error)', () => {
    expect(SQL_SINCRONIZAR).toContain('WHERE maximo > 0 OR ultimo IS NOT NULL');
  });

  it('mira solo el esquema public y solo tablas con secuencia en `id`', () => {
    expect(SQL_SINCRONIZAR).toContain("t.schemaname = 'public'");
    expect(SQL_SINCRONIZAR).toContain('WHERE secuencia IS NOT NULL');
  });

  it('materializa los CTE: sin eso el planificador evalua el MAX(id) sobre tablas sin id serial', () => {
    // `_prisma_migrations` tiene un id de texto y `config_dynamics` no tiene
    // secuencia: si el filtro no corre primero, la consulta entera revienta.
    expect(SQL_SINCRONIZAR.match(/AS MATERIALIZED/g)).toHaveLength(3);
  });
});

describe('sincronizarSecuencias', () => {
  it('corre UNA sola consulta y no le pasa ni un valor de afuera', async () => {
    const cliente = clienteFalso([]);
    await sincronizarSecuencias(cliente);
    expect(cliente.llamadas).toHaveLength(1);
    expect(cliente.llamadas[0]?.sql).toBe(SQL_SINCRONIZAR);
    expect(cliente.llamadas[0]?.valores).toEqual([]);
  });

  it('convierte el BIGINT de Postgres a number, para que el log no diga "1011n"', async () => {
    const cliente = clienteFalso([
      { tabla: 'sucursales', valor: 9n },
      { tabla: 'colaboradores', valor: 1011n },
    ]);
    expect(await sincronizarSecuencias(cliente)).toEqual([
      { tabla: 'sucursales', valor: 9 },
      { tabla: 'colaboradores', valor: 1011 },
    ]);
  });
});

describe('describirSincronizacion — la linea del log', () => {
  const filas = (cuantas: number): SecuenciaSincronizada[] =>
    Array.from({ length: cuantas }, (_, i) => ({ tabla: `t${i}`, valor: i }));

  it('concuerda en singular y en plural', () => {
    expect(describirSincronizacion(filas(1))).toContain('1 tabla sincronizada');
    expect(describirSincronizacion(filas(22))).toContain('22 tablas sincronizadas');
  });

  it('dice para que sirve, no solo que corrio', () => {
    expect(describirSincronizacion(filas(22))).toMatch(/no choca con los ids de la semilla/);
  });
});

describe('sincronizarSecuenciasYAvisar', () => {
  it('deja exactamente una linea en el log y devuelve las filas', async () => {
    const lineas: string[] = [];
    const filas = await sincronizarSecuenciasYAvisar(clienteFalso([{ tabla: 'sucursales', valor: 9n }]), (l) =>
      lineas.push(l),
    );
    expect(lineas).toHaveLength(1);
    expect(filas).toEqual([{ tabla: 'sucursales', valor: 9 }]);
  });
});

describe('las semillas que insertan con id EXPLICITO llaman al helper', () => {
  // Las semillas se leen como TEXTO y nunca se importan: importarlas ejecuta
  // `main()` y escribe en la base. Mismo criterio que scripts/_pin-dev.test.mjs.
  const SEMILLAS = ['seed.ts', 'seed-historial.ts', 'seed-auditoria.ts'];

  for (const semilla of SEMILLAS) {
    it(`${semilla} sincroniza las secuencias al terminar`, () => {
      const texto = readFileSync(fileURLToPath(new URL(`./${semilla}`, import.meta.url)), 'utf8');
      // Si falla, alguien saco la llamada: esa semilla vuelve a dejar la base
      // con las secuencias atrasadas y el primer alta desde la app da 500.
      expect(texto).toMatch(/from '\.\/sincronizar-secuencias'/);
      expect(texto).toMatch(/await sincronizarSecuenciasYAvisar\(prisma\)/);
    });
  }
});
