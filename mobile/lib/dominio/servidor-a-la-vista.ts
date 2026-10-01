/**
 * ---------------------------------------------------------------------------
 * CONTRA QUÉ SERVIDOR ESTÁ HABLANDO ESTA COPIA DE LA APP
 * ---------------------------------------------------------------------------
 * Pregunta del usuario con la app ya instalada en su teléfono: *"¿cómo sé a
 * qué servidor está conectado?"*. Hasta ahora, de ninguna forma -- el pie del
 * login solo mostraba la versión.
 *
 * Y no es curiosidad: la dirección se **congela al compilar el APK**
 * (`EXPO_PUBLIC_API_URL`, ver `lib/adaptadores/_http.ts`), así que dos
 * teléfonos con el mismo número de versión pueden estar hablando con dos
 * servidores distintos y verse idénticos. En un piloto donde conviven el
 * backend de una PC de la oficina y, más adelante, el de la nube, alguien que
 * reporta *"no me trae datos"* no se puede ayudar sin saber contra qué está
 * pegando. El número de versión no alcanza para distinguirlos.
 *
 * ---------------------------------------------------------------------------
 * EL HOST, NO LA URL ENTERA
 * ---------------------------------------------------------------------------
 * Al Contador parado en la góndola no le sirve `http://`; le sirve poder leer
 * en voz alta lo que ve cuando llama por teléfono. Se muestra
 * `10.5.21.144:3000` y no `http://10.5.21.144:3000`.
 *
 * ---------------------------------------------------------------------------
 * "MISMO SERVIDOR" CUANDO LA WEB LA SIRVE EL PROPIO BACKEND
 * ---------------------------------------------------------------------------
 * La web del Auditor se compila con la dirección RELATIVA (`/`), porque la
 * entrega el mismo servidor que responde la API. Ahí `urlBase()` devuelve
 * vacío, y mostrar un host inventado sería peor que no mostrar nada: se dice
 * que es el mismo de la página, que es exactamente lo que pasa.
 */

/** Lo que se pinta al lado de la versión. Nunca vacío: siempre dice algo. */
export function servidorALaVista(base: string): string {
  const limpia = base.trim();
  if (limpia === '' || limpia === '/') return 'mismo servidor de esta página';

  // `URL` está en Hermes y en el navegador. Si la dirección viniera mal
  // escrita, se muestra TAL CUAL en vez de tragarse el error: una dirección
  // rara a la vista es justamente lo que hace falta para darse cuenta de que
  // el APK se compiló mal.
  try {
    const url = new URL(limpia);
    return url.port === '' ? url.hostname : `${url.hostname}:${url.port}`;
  } catch {
    return limpia;
  }
}
