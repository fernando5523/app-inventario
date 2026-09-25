import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Bajar un archivo generado por el backend, en el TELÉFONO.
 *
 * No hay "carpeta de descargas" que se pueda abrir después: el archivo se
 * escribe en la caché de la app y se entrega al selector nativo de compartir,
 * que es como una planilla sale del teléfono hacia el correo o WhatsApp.
 *
 * La web tiene su propia versión (`descargar-archivo.web.ts`): ahí alcanza con
 * un enlace y la carpeta de descargas del navegador. Metro elige cuál según la
 * plataforma y quien llama no se entera.
 */
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function descargarArchivo(
  bytes: ArrayBuffer,
  nombreArchivo: string,
  tipo: string = TIPO_XLSX,
): Promise<void> {
  const puedeCompartir = await Sharing.isAvailableAsync();
  if (!puedeCompartir) {
    throw new Error('Este dispositivo no tiene disponible el selector para compartir archivos.');
  }

  const archivo = new File(Paths.cache, nombreArchivo);
  // Si quedó el de una descarga anterior con el mismo nombre, se reemplaza:
  // dos planillas del mismo inventario son la misma planilla.
  if (archivo.exists) archivo.delete();
  archivo.write(new Uint8Array(bytes));

  await Sharing.shareAsync(archivo.uri, { mimeType: tipo, UTI: 'org.openxmlformats.spreadsheetml.sheet' });
}
