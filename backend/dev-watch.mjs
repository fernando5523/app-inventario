/**
 * Supervisor de desarrollo del backend.
 *
 * USO:  npm run dev:watch        (equivalente:  node dev-watch.mjs)
 *
 * Es un arranque APARTE de `npm run dev` (que sigue siendo `tsx watch`) — no lo
 * reemplaza. Hace UNA cosa: corre el backend con recarga al guardar Y, si el
 * proceso se cae SOLO (cosa que `tsx watch` no reinicia, solo espera al próximo
 * cambio), deja escrito POR QUÉ en logs/crash.log y lo vuelve a levantar.
 *
 * Qué escribe en logs/crash.log cuando el proceso muere solo: una línea con
 * timestamp y el motivo (código de salida y/o señal). La EXCEPCIÓN en sí la
 * escribe el propio backend en el mismo archivo (config/registro-caidas.ts), así
 * que crash.log queda con las dos caras: la excepción y el "murió, reinicio".
 *
 * La salida normal (recompilación, errores de compilación de tsx, logs del
 * backend) NO se toca: el hijo hereda stdout/stderr y sale tal cual; el
 * supervisor solo agrega sus propias líneas "[dev-watch] ...".
 */

import { spawn } from 'node:child_process';
import { appendFileSync, watch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ENTRADA = resolve(AQUI, 'src/index.ts');
const DIR_VIGILADO = resolve(AQUI, 'src');
const CRASH_LOG = resolve(AQUI, 'logs/crash.log');
/** Espera antes de reintentar tras una caída: evita el busy-loop si el error es
 * de compilación y persiste (un guardado nuevo reinicia antes igual). */
const BACKOFF_MS = 1000;
/** Junta varios guardados seguidos (varios agentes a la vez) en un reinicio. */
const DEBOUNCE_MS = 150;

let hijo = null;
let reiniciandoPorCambio = false;
let tempCambio = null;
let tempBackoff = null;

/** Una línea a stdout (para dev.log) y a crash.log (rastro en disco). */
function anotar(texto) {
  const linea = `${new Date().toISOString()} [dev-watch] ${texto}\n`;
  try {
    appendFileSync(CRASH_LOG, linea);
  } catch {
    /* si no hay dónde anotar, queda al menos por stdout */
  }
  process.stdout.write(linea);
}

function arrancar() {
  clearTimeout(tempBackoff);
  hijo = spawn(process.execPath, ['--import', 'tsx', ENTRADA], { stdio: 'inherit', cwd: AQUI });
  const esteHijo = hijo;
  hijo.on('exit', (code, signal) => {
    if (esteHijo !== hijo) return; // ya fue reemplazado; ignorar su exit tardío
    hijo = null;
    if (reiniciandoPorCambio) {
      // Lo matamos nosotros por un cambio de archivo: no es una caída.
      reiniciandoPorCambio = false;
      arrancar();
      return;
    }
    // Murió por su cuenta: dejar el motivo y reintentar tras el backoff.
    anotar(`el proceso murió SOLO — ${signal ? `señal ${signal}` : `code=${code}`}. Reinicio en ${BACKOFF_MS}ms.`);
    tempBackoff = setTimeout(arrancar, BACKOFF_MS);
  });
}

function reiniciarPorCambio(archivo) {
  clearTimeout(tempCambio);
  tempCambio = setTimeout(() => {
    process.stdout.write(`[dev-watch] cambio en ${archivo} — reiniciando\n`);
    if (hijo) {
      reiniciandoPorCambio = true;
      hijo.kill('SIGTERM'); // index.ts sale limpio y libera :3000 (config/registro-caidas.ts)
    } else {
      arrancar();
    }
  }, DEBOUNCE_MS);
}

watch(DIR_VIGILADO, { recursive: true }, (_evento, archivo) => {
  if (archivo && /\.(ts|mjs|js|json)$/.test(archivo.toString())) reiniciarPorCambio(archivo.toString());
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    if (hijo) hijo.kill('SIGTERM');
    process.exit(0);
  });
}

process.stdout.write('[dev-watch] backend con recarga al guardar y reinicio-en-caída. Ctrl+C para salir.\n');
arrancar();
