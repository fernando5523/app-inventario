import * as DocumentPicker from 'expo-document-picker';

import type { ArchivoElegido } from './leer-archivo';

export type { ArchivoElegido };

/**
 * Elegir un .xlsx y leerlo, en el NAVEGADOR.
 *
 * En el teléfono esto es el selector + `expo-file-system`: el archivo se copia
 * a la caché de la app y se lee de disco. Acá nada de eso existe ni hace falta
 * -- el selector del navegador ya entrega un `File` del DOM, con sus bytes a un
 * `arrayBuffer()` de distancia.
 *
 * ESTE ARCHIVO ES EL ARREGLO DE UN BUG REAL: la pantalla de ajustes negativos
 * llamaba a `new File(uri).bytes()` de `expo-file-system`, que en la web no
 * existe. El Auditor elegía el Excel de Jocelyn desde su PC y la pantalla le
 * contestaba "No se pudo leer el archivo" -- un mensaje que acusa al archivo de
 * un problema que era nuestro, y que manda a pedirle otra copia a alguien que
 * mandó la buena.
 *
 * `asset.file` es opcional en el tipo de `expo-document-picker` porque solo
 * existe en web. Se chequea igual, en vez de un `!`: si algún día el selector
 * cambia y no lo trae, hay que enterarse acá y no dos capas más arriba con un
 * archivo vacío que el backend rechaza por "no es un Excel".
 */
export async function elegirArchivoXlsx(): Promise<ArchivoElegido | null> {
  const resultado = await DocumentPicker.getDocumentAsync({
    // El tipo se deja ABIERTO a propósito: el diálogo del navegador filtra por
    // extensión y algunos sistemas devuelven el .xlsx con un MIME genérico
    // (`application/octet-stream`) o vacío. Filtrar duro acá dejaba archivos
    // buenos sin poder elegirse; quien valida de verdad que sea el Excel de
    // Jocelyn es el backend, que lo abre y revisa sus once columnas.
    type: '*/*',
    multiple: false,
  });
  if (resultado.canceled) return null;

  const asset = resultado.assets[0];
  if (asset?.file === undefined) {
    throw new Error('El navegador no entregó el archivo elegido. Vuelve a intentarlo.');
  }

  return { nombre: asset.name, bytes: new Uint8Array(await asset.file.arrayBuffer()) };
}
