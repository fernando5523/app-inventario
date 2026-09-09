import { crearApp } from './config/app';
import { instalarRegistroDeCaidas, registrarCaida } from './config/registro-caidas';

// ANTES que nada: que un fallo de arranque (o cualquier crash posterior) deje
// rastro en logs/crash.log en vez de morir en silencio. Ver registro-caidas.ts.
instalarRegistroDeCaidas();

const PUERTO = process.env.PORT ? Number(process.env.PORT) : 3000;

/**
 * En que interfaz escucha el servidor.
 *
 * `0.0.0.0` = todas las interfaces de red, no solo la loopback. Es lo que
 * hace falta para que un TELEFONO de la red alcance al backend: escuchando
 * solo en `127.0.0.1`, el servidor existe unicamente para esta maquina y
 * cualquier pedido de afuera muere sin llegar (no da error de la app: da
 * timeout, que es peor de diagnosticar).
 *
 * Se deja configurable porque el valor correcto depende de donde corra:
 *   - desarrollo con telefonos en la misma red → `0.0.0.0` (el default)
 *   - detras de un reverse proxy en el mismo host → `HOST=127.0.0.1`, para
 *     que el puerto NO quede expuesto a la red y solo entre por el proxy.
 *
 * OJO con lo que implica el default: con `0.0.0.0` el backend queda visible
 * para cualquiera en la misma WiFi, y hoy habla HTTP sin cifrar. Es
 * aceptable en la red de desarrollo; el dia que esto salga a la tienda tiene
 * que ir detras de HTTPS, no expuesto asi.
 */
const HOST = process.env.HOST ?? '0.0.0.0';

const servidor = crearApp().listen(PUERTO, HOST, () => {
  console.log(`Backend de app-inventario escuchando en ${HOST}:${PUERTO}`);
  if (HOST === '0.0.0.0') {
    console.log('  Accesible desde la red local. Para restringirlo: HOST=127.0.0.1');
  }
});

// Sin este handler, un error al escuchar (típicamente EADDRINUSE: el puerto ya
// tomado por un backend anterior que no cerró) se propaga como excepción no
// capturada y el proceso muere ANTES de imprimir "escuchando", sin rastro. Ahora
// deja el motivo y termina igual (mismo resultado que antes, con evidencia).
servidor.on('error', (err: NodeJS.ErrnoException) => {
  const motivo =
    err.code === 'EADDRINUSE'
      ? `El puerto ${PUERTO} ya está en uso — ¿quedó un backend anterior sin cerrar? (EADDRINUSE)`
      : `${err.code ?? 'ERROR'}: ${err.message}`;
  registrarCaida('ERROR_AL_ESCUCHAR', motivo);
  process.exit(1);
});
