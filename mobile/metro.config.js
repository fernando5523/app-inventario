const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * `.wasm` COMO ASSET, para que el bundle WEB compile.
 *
 * `expo-sqlite` en web resuelve a una implementación con WebAssembly
 * (wa-sqlite) que importa su propio `.wasm`. Metro no conoce esa extensión por
 * defecto y el bundle de web moría con:
 *
 *   Unable to resolve module ./wa-sqlite/wa-sqlite.wasm
 *
 * En Android e iOS esto no pasaba nunca: ahí `expo-sqlite` usa el SQLite
 * nativo y ese archivo no entra al grafo.
 *
 * SQLITE NO LO USA EL AUDITOR -- es la caché de hojas de quien cuenta, que
 * trabaja sin señal en la góndola. Llega al bundle web de arrastre, porque
 * `lib/contenedor.ts` arma TODOS los repositorios en un solo módulo. Se
 * habilita la extensión en vez de cortar esa dependencia porque es una línea
 * contra una refactorización del contenedor entero, y porque el día que la web
 * quiera caché local va a hacer falta igual.
 */
config.resolver.assetExts.push('wasm');

module.exports = config;
