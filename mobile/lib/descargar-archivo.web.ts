/**
 * Bajar un archivo generado por el backend, en el NAVEGADOR.
 *
 * En el teléfono esto es `expo-file-system` + el selector nativo de compartir:
 * se escribe el archivo en la caché y se abre la hoja de "compartir con...".
 * En una PC eso no existe ni hace falta: el navegador tiene su propia carpeta
 * de descargas y un gesto que todo el mundo conoce.
 *
 * `URL.revokeObjectURL` no es opcional: sin eso, cada planilla bajada se queda
 * en memoria hasta que se recargue la pestaña, y el Auditor baja una por
 * tienda. Se revoca con un respiro para que el navegador alcance a empezar la
 * descarga -- revocar en el mismo tick la cancela en algunos navegadores.
 */
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function descargarArchivo(bytes: ArrayBuffer, nombreArchivo: string, tipo: string = TIPO_XLSX): void {
  const blob = new Blob([bytes], { type: tipo });
  const url = URL.createObjectURL(blob);

  const enlace = document.createElement('a');
  enlace.href = url;
  // El NOMBRE lo manda el servidor (`Content-Disposition`): dice de qué tienda
  // y de qué período es la planilla. Sin esto el navegador la guarda como
  // "descarga.xlsx" y en la carpeta quedan cinco iguales.
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
