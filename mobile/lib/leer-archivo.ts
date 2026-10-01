import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

/**
 * Elegir un .xlsx y leerlo, en el TELÉFONO.
 *
 * El selector copia el archivo a la caché de la app (`copyToCacheDirectory`) y
 * de ahí se lee con `expo-file-system`. Ese paso hace falta porque el URI que
 * devuelve el selector de Android suele ser un `content://` de otra app, que no
 * se puede abrir directo.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ ESTO ES UN ARCHIVO PROPIO Y NO DOS LÍNEAS EN LA PANTALLA
 * ---------------------------------------------------------------------------
 * `File` de `expo-file-system` NO EXISTE EN LA WEB. La pantalla de ajustes
 * negativos lo llamaba directo, así que en el navegador la importación moría
 * con "No se pudo leer el archivo" -- el Auditor elegía el Excel de Jocelyn en
 * su PC y la pantalla le decía que el archivo estaba mal. En el navegador el
 * propio selector ya devuelve un `File` del DOM, que se lee sin tocar disco.
 *
 * Es el mismo desencuentro que ya separó `descargar-archivo.ts` de su `.web.ts`
 * y `sesion-local.ts` del suyo: Metro elige por plataforma y quien llama no se
 * entera.
 */
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ArchivoElegido {
  nombre: string;
  bytes: Uint8Array;
}

/**
 * `null` = la persona canceló, que NO es un error y no se avisa como tal.
 * Cualquier otra falla se lanza: leer un archivo que se eligió y no se puede
 * abrir sí es algo que hay que decir.
 */
export async function elegirArchivoXlsx(): Promise<ArchivoElegido | null> {
  const resultado = await DocumentPicker.getDocumentAsync({ type: TIPO_XLSX, copyToCacheDirectory: true });
  if (resultado.canceled) return null;

  const asset = resultado.assets[0]!;
  return { nombre: asset.name, bytes: await new File(asset.uri).bytes() };
}
