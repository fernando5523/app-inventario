import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { errorMiddleware } from '../middleware/error.middleware';
import { asistenciaRouter } from '../modules/asistencia';
import { auditoriaRouter } from '../modules/auditoria';
import { clasificacionRouter } from '../modules/clasificacion';
import { configRouter } from '../modules/config';
import { configDynamicsRouter } from '../modules/config-dynamics';
import { hojasRouter } from '../modules/hojas';
import { d365Router } from '../modules/d365';
import { historialRouter } from '../modules/historial';
import { liquidacionRouter, reporteGerenciaRouter } from '../modules/liquidacion';
import { navegacionRouter } from '../modules/navegacion';
import { sesionRouter } from '../modules/sesion';
import { tiendasRouter } from '../modules/tiendas';
import { usuariosRouter } from '../modules/usuarios';
import { inventariosRouter, sucursalesInventariosRouter } from '../modules/inventarios';

/**
 * ---------------------------------------------------------------------------
 * LA WEB DEL AUDITOR LA SIRVE ESTE MISMO BACKEND
 * ---------------------------------------------------------------------------
 * `mobile/` se exporta tambien a web (`expo export --platform web`) y el
 * resultado viaja DENTRO de la imagen, en `public/`, al lado de `dist/`. Asi
 * hay UNA sola cosa que desplegar en Azure en vez de dos, y la web habla con
 * su propio origen: sin CORS, sin una URL de API que configurar por ambiente,
 * y sin que recrear el recurso se lleve puesta la configuracion.
 *
 * La ruta se arma desde `__dirname` y no desde `process.cwd()` a proposito:
 * compilado, `__dirname` es `/app/dist/config` y sube a `/app/public`; con
 * `tsx` en la maquina es `backend/src/config` y sube a `backend/public`. Los
 * dos dan "al lado de dist", que es lo que se quiso decir. `cwd()` depende de
 * DESDE DONDE se lanzo el proceso, y ahi el mismo binario serviria una
 * carpeta distinta segun quien lo arranque.
 */
const CARPETA_WEB = join(__dirname, '..', '..', 'public');

/**
 * LO MINIMO QUE HAY QUE AFLOJARLE A HELMET PARA QUE LA WEB CARGUE.
 *
 * Con la CSP de fabrica (`script-src 'self'`) el bundle CARGA y la pantalla
 * de PIN se dibuja, asi que el 99% de helmet queda intacto -- pero
 * `expo-sqlite` en web es WebAssembly (`wa-sqlite.wasm`, 621 KB, viaja en el
 * export), y Chrome mide compilar WASM contra `script-src`. Medido en el
 * navegador el 2026-09-24, cargando la web servida por este backend:
 *
 *   WebAssembly.instantiate(): Compiling or instantiating WebAssembly module
 *   violates the following Content Security policy directive because
 *   'unsafe-eval' is not an allowed source of script in the following
 *   Content Security Policy directive: "script-src 'self'".
 *
 * Y la copia local de las hojas -- lo que sostiene el conteo sin señal -- vive
 * justamente en esa base SQLite.
 *
 * SE AGREGA `'wasm-unsafe-eval'` Y NO `'unsafe-eval'`, que es lo que sugiere
 * el mensaje de Chrome: el token acotado habilita SOLO compilar WebAssembly;
 * `'unsafe-eval'` habilitaria ademas `eval()` y `new Function()` sobre
 * cualquier string, que es la puerta clasica del XSS. La diferencia importa:
 * el mensaje de error nombra al grande, y copiarlo tal cual seria abrir de
 * mas por comodidad.
 *
 * ---------------------------------------------------------------------------
 * Y SE SACA `upgrade-insecure-requests`, QUE VIENE PRENDIDA
 * ---------------------------------------------------------------------------
 * Esa directiva le dice al navegador que pida TODO por https, aunque la
 * pagina haya llegado por http. Medido el 2026-09-24 sirviendo esta misma
 * app desde una IP de la red (no `localhost`, que el navegador exceptua):
 *
 *   documento  http://10.5.21.144:4100/auditor/comparativo   -> 200
 *   bundle     https://10.5.21.144:4100/_expo/.../entry.js   -> 503
 *
 * O sea: la pagina entra, el JavaScript no, y queda una pantalla en blanco
 * sin ningun error a la vista. Este backend habla HTTP sin cifrar (ver el
 * comentario de HOST en src/index.ts) y hoy se accede por IP en la WiFi de
 * la tienda: la directiva no protege nada ahi, solo rompe.
 *
 * Donde SI hay https -- Azure Web App, que es el destino -- no se pierde
 * nada: todos los pedidos ya salen por https porque la pagina llego por
 * https. El dia que este backend tenga TLS propio y se quiera forzar el
 * upgrade, se vuelve a prender aca.
 *
 * `useDefaults: true`: se toca SOLO lo anterior. Todo lo demas
 * (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`,
 * `style-src` con el `'unsafe-inline'` que necesita el reset de
 * react-native-web...) queda como lo pone helmet.
 *
 * Se aplica solo cuando HAY web servida: corriendo `npm run dev` sin
 * `public/`, este backend es puro API y no tiene por que aflojar nada.
 */
const OPCIONES_HELMET_CON_WEB: Parameters<typeof helmet>[0] = {
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      upgradeInsecureRequests: null,
    },
  },
};

export interface OpcionesApp {
  /** Solo para los tests: la carpeta de la web exportada. Por defecto, `public/` al lado de `dist/`. */
  carpetaWeb?: string;
}

export function crearApp(opciones: OpcionesApp = {}): Express {
  const app = express();
  const carpetaWeb = opciones.carpetaWeb ?? CARPETA_WEB;

  /**
   * SI NO HAY WEB EXPORTADA, NO SE MONTA NADA Y ESTE BACKEND ES EL DE SIEMPRE.
   *
   * Es el caso corriente de `npm run dev` en la maquina: ahi el front corre
   * en Metro, no hay `public/`, y una carpeta ausente no puede ser un error
   * de arranque -- seria romperle el dia a todo el equipo por un archivo que
   * solo existe dentro del contenedor.
   *
   * Se mira el `index.html` y no solo la carpeta: una carpeta vacia (un COPY
   * que no copio nada) dejaria el fallback montado devolviendo 500 en cada
   * ruta, que es peor que el 404 que se vino a arreglar.
   */
  const indexWeb = join(carpetaWeb, 'index.html');
  const hayWeb = existsSync(indexWeb);

  app.use(helmet(hayWeb ? OPCIONES_HELMET_CON_WEB : undefined));
  app.use(cors());
  app.use(express.json());

  app.get('/salud', (_req, res) => res.json({ ok: true }));

  app.use('/api/sesion', sesionRouter);
  app.use('/api/usuarios', usuariosRouter);
  app.use('/api/tiendas', tiendasRouter);
  app.use('/api/config', configRouter);
  app.use('/api/navegacion', navegacionRouter);
  app.use('/api/hojas', hojasRouter);
  // Pasos 2 y 3 del wizard del Coordinador. Van juntos y en dos monturas
  // porque `activo` cuelga de /api/sucursales/:id, no de /api/inventarios.
  app.use('/api/inventarios', inventariosRouter);
  app.use('/api/sucursales', sucursalesInventariosRouter);
  // La lista de asistencia cuelga del MISMO prefijo que inventariosRouter, en
  // un router propio (mismo criterio que liquidacion.reporte-gerencia.routes.ts:
  // otro tema, otro archivo, dos personas sin pisarse). Por eso su rol va por
  // ruta y no a nivel del router -- ver asistencia.routes.ts.
  app.use('/api/inventarios', asistenciaRouter);
  app.use('/api/d365', d365Router);
  app.use('/api/historial', historialRouter);
  app.use('/api/auditoria', auditoriaRouter);
  app.use('/api/clasificacion', clasificacionRouter);
  app.use('/api/liquidacion', liquidacionRouter);
  app.use('/api/liquidacion', reporteGerenciaRouter);
  app.use('/api/config-dynamics', configDynamicsRouter);

  /**
   * UNA RUTA DE API QUE NO EXISTE RESPONDE JSON, NUNCA HTML.
   *
   * Va DESPUES de todos los routers de `/api` y ANTES del fallback de la web,
   * y por eso tiene que existir: sin el, `/api/loquesea` caeria en el `*` de
   * abajo y el front recibiria una PAGINA donde esperaba JSON. El sintoma es
   * `Unexpected token '<'` en el parseo, que no nombra ni la ruta ni el
   * metodo -- una hora de depuracion para un 404.
   *
   * No es solo una precaucion para el fallback nuevo: hasta hoy un
   * `/api/loquesea` devolvia el 404 de fabrica de Express, que TAMBIEN es
   * HTML (`<!DOCTYPE html>... Cannot GET /api/loquesea`). O sea que la trampa
   * ya estaba puesta; esto la saca.
   */
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `No existe la ruta ${req.method} ${req.baseUrl}${req.path}.` });
  });

  /**
   * EL FALLBACK DE LA SPA: cualquier ruta desconocida devuelve el index.
   *
   * El export de web es UNA sola pagina y el ruteo lo hace expo-router en el
   * navegador. Sin esto, `/auditor/comparativo` escrito a mano -- o un F5
   * estando ahi, o un favorito -- pega contra el servidor, que no conoce esa
   * ruta y contesta 404. En el telefono el problema no existe porque no hay
   * barra de direcciones; en la web es lo primero que hace cualquiera.
   *
   * Solo GET (y HEAD, que Express resuelve con la misma ruta): un POST a una
   * ruta que no existe tiene que seguir siendo 404, no una pagina.
   */
  if (hayWeb) {
    app.use(express.static(carpetaWeb));
    app.get('*', (_req, res) => res.sendFile(indexWeb));
  }

  // Siempre al final: error.middleware.ts traduce lo que tiren las capas anteriores.
  app.use(errorMiddleware);

  return app;
}
