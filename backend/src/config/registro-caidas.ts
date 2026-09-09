/**
 * Registro de caídas del proceso — para que un crash DEJE RASTRO, no silencio.
 *
 * El problema que resuelve: `tsx watch` no reinicia un proceso que se murió
 * SOLO (imprime "Rerunning..." y espera al próximo cambio de archivo), así que
 * un crash deja el backend caído; y como el entrypoint no tenía ningún handler
 * de proceso, el motivo se perdía. dev.log cortaba en "Rerunning..." sin decir
 * por qué.
 *
 * Por eso el rastro se escribe SINCRÓNICO y a un ARCHIVO PROPIO (logs/crash.log):
 *   - Síncrono, porque el proceso puede morir en el mismo tick: un log async no
 *     alcanza a vaciarse.
 *   - Archivo propio, porque el redirect que arma dev.log hoy captura stdout
 *     pero no necesariamente stderr — donde va el stack de un crash. A un
 *     archivo que escribimos nosotros no lo pierde ningún redirect.
 * Además se escribe a stdout, que dev.log SÍ captura, para verlo también ahí.
 *
 * NO cambia el comportamiento del backend en runtime más allá del logging:
 * donde el proceso ya moría (excepción no capturada, error al escuchar) sigue
 * muriendo, ahora con rastro; una promesa rechazada sin manejar solo se registra
 * (no se fuerza la salida, para no alterar si hoy tumba o no al proceso).
 */

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * logs/crash.log, resuelto contra ESTE archivo (src/config/), independiente del
 * cwd. `__dirname` y no `import.meta.url` porque el backend compila como
 * CommonJS (tsconfig module=CommonJS) y ahí corre como CJS.
 */
const ARCHIVO_CAIDAS = resolve(__dirname, '../../logs/crash.log');

/** Una línea de rastro, con timestamp ISO. Pura: se testea sin tocar disco. */
export function formatearCaida(tipo: string, detalle: string, ahora: Date = new Date()): string {
  return `${ahora.toISOString()} [caida] ${tipo} — ${detalle}\n`;
}

function detalleDeError(valor: unknown): string {
  // `stack` ya empieza con "name: message", así que se usa tal cual y no se
  // repite el encabezado aparte.
  if (valor instanceof Error) {
    return valor.stack ?? `${valor.name}: ${valor.message}`;
  }
  return typeof valor === 'string' ? valor : JSON.stringify(valor);
}

/**
 * Escribe una línea de rastro. Best-effort y sin re-lanzar: si hasta el
 * append falla, no hay dónde anotar que no se pudo anotar — que al menos salga
 * por consola.
 */
export function registrarCaida(tipo: string, detalle: string): void {
  const linea = formatearCaida(tipo, detalle);
  try {
    appendFileSync(ARCHIVO_CAIDAS, linea);
  } catch {
    /* sin disco donde anotar; queda el intento por stdout */
  }
  try {
    process.stdout.write(linea);
  } catch {
    /* stdout puede estar cerrado durante 'exit' */
  }
}

/**
 * Instala los handlers de proceso. Llamar UNA vez, lo antes posible en el
 * arranque (antes de crear la app), para atajar también un fallo de arranque.
 * El `error` del servidor HTTP (EADDRINUSE, etc.) se engancha aparte, en el
 * entrypoint, porque necesita la instancia del server.
 */
export function instalarRegistroDeCaidas(): void {
  process.on('uncaughtException', (err) => {
    registrarCaida('EXCEPCION_NO_CAPTURADA', detalleDeError(err));
    // El proceso ya moría con una excepción no capturada; se preserva ese
    // comportamiento (exit 1), ahora con rastro en disco.
    process.exit(1);
  });

  process.on('unhandledRejection', (motivo) => {
    registrarCaida('PROMESA_RECHAZADA_SIN_MANEJAR', detalleDeError(motivo));
  });

  // Señales con las que el watcher (tsx) mata al hijo para reiniciarlo. Se
  // registra el final vía el handler de 'exit' (el código lo dice: 143=SIGTERM,
  // 130=SIGINT). Es CLAVE seguir terminando: un handler que no saliera dejaría
  // el proceso vivo aferrado al puerto 3000, y el próximo arranque no podría
  // bindear — que es, muy probablemente, la caída sin rastro que buscamos.
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));

  // Última línea, SIEMPRE: el código de salida de cualquier final. Un
  // "SALIDA code=143" tras un cambio es un reinicio normal del watcher; un
  // "SALIDA code=1" sin "escuchando" después es una caída de verdad.
  process.on('exit', (codigo) => {
    registrarCaida('SALIDA', `code=${codigo}`);
  });
}
