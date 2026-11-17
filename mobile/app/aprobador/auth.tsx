import { Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import type { JSX } from 'react';

// Destino del redirect de Microsoft (inventario://aprobador/auth). La sesión
// del navegador la cierra expo-web-browser; esta ruta existe para que el deep
// link no caiga en "ruta no encontrada" y vuelva al ingreso, que completa el
// canje del código.
WebBrowser.maybeCompleteAuthSession();

export default function RetornoMicrosoft(): JSX.Element {
  return <Redirect href="/aprobador" />;
}
