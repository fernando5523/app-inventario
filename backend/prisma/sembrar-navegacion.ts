/**
 * SIEMBRA LA NAVEGACION con lo que hoy esta hardcodeado en el movil.
 *
 * ---------------------------------------------------------------------------
 * LA MITAD DEL PEDIDO QUE MAS FACIL SE INCUMPLE
 * ---------------------------------------------------------------------------
 * El cliente pidio poder manejar los accesos por rol "pero DEJAR LOS ROLES QUE
 * YA TENEMOS Y SUS ACCESOS". O sea: el dia 1 despues del cambio, los cuatro
 * roles tienen que ver EXACTAMENTE lo mismo que veian antes. Un seed que
 * cambie aunque sea un renglon -- o el orden de dos -- incumple el pedido sin
 * que nadie lo note hasta que alguien abre la app y le falta una tarjeta.
 *
 * Por eso la fuente es `navegacion.catalogo.ts`, que es el port literal de
 * `mobile/components/navegacion/{accesos,tabs}.ts`, y hay un test que compara
 * los dos archivos para que no se separen.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENTE, Y RESPETA LO QUE EL ADMINISTRADOR YA TOCO
 * ---------------------------------------------------------------------------
 * Correrlo de nuevo NO pisa la configuracion existente: solo AGREGA los
 * elementos que falten (los que aparecieron en una version nueva de la app).
 * Si pisara, cada despliegue desharia el trabajo del Administrador -- y el
 * lunes siguiente alguien se encontraria el home que habia acomodado vuelto a
 * la fabrica, sin explicacion.
 *
 * El elemento nuevo entra AL FINAL y VISIBLE: al final porque nadie decidio
 * donde va, y visible porque una pantalla nueva que nace apagada es una
 * funcionalidad que se entrega y nadie encuentra.
 *
 *   npx tsx prisma/sembrar-navegacion.ts
 */
import { PrismaClient, type Rol, type TipoNavegacion } from '@prisma/client';
import { ACCESOS_CATALOGO, TABS_CATALOGO } from '../src/modules/navegacion/navegacion.catalogo';

const prisma = new PrismaClient();

/** Lo que la siembra quiere que exista, aplanado: una fila por elemento. */
export function filasDeLaSiembra(): Array<{ rol: Rol; tipo: TipoNavegacion; clave: string; orden: number }> {
  const filas: Array<{ rol: Rol; tipo: TipoNavegacion; clave: string; orden: number }> = [];

  for (const [rol, accesos] of Object.entries(ACCESOS_CATALOGO) as Array<[Rol, typeof ACCESOS_CATALOGO[Rol]]>) {
    // El ORDEN es la posicion en el catalogo, que es el orden de hoy en la
    // app. Se numera desde 1 y de a uno: el espacio entre numeros no
    // significa nada (ver el comentario de `orden` en el schema).
    accesos.forEach((acceso, i) => filas.push({ rol, tipo: 'acceso', clave: acceso.ruta, orden: i + 1 }));
  }
  for (const [rol, tabs] of Object.entries(TABS_CATALOGO) as Array<[Rol, typeof TABS_CATALOGO[Rol]]>) {
    tabs.forEach((tab, i) => filas.push({ rol, tipo: 'tab', clave: tab.name, orden: i + 1 }));
  }

  return filas;
}

export async function sembrarNavegacion(cliente: PrismaClient = prisma): Promise<{ creadas: number; existentes: number }> {
  const filas = filasDeLaSiembra();
  const existentes = await cliente.configuracionNavegacion.findMany({ select: { rol: true, tipo: true, clave: true, orden: true } });

  const yaEsta = new Set(existentes.map((f) => `${f.rol}:${f.tipo}:${f.clave}`));
  /**
   * EL ORDEN MAS ALTO QUE YA EXISTE por (rol, tipo).
   *
   * El elemento nuevo NO puede entrar con el indice del catalogo, y este es el
   * bug que eso causaba: si una version nueva de la app agrega una pantalla EN
   * EL MEDIO del catalogo -- "Accesos y menus" entre "Configuracion" e
   * "Historial" --, su indice (4) ya lo tiene otra fila. Quedan dos filas con
   * orden 4 y cual va primero pasa a depender de como las devuelva Postgres.
   *
   * Entra DESPUES de todo lo que ya existe, que ademas es lo correcto: nadie
   * decidio donde va. El Administrador la mueve a donde quiera, y ahi si queda
   * un orden que alguien eligio.
   */
  const ultimoOrden = new Map<string, number>();
  for (const f of existentes) {
    const grupo = `${f.rol}:${f.tipo}`;
    ultimoOrden.set(grupo, Math.max(ultimoOrden.get(grupo) ?? 0, f.orden));
  }

  let creadas = 0;
  for (const fila of filas) {
    if (yaEsta.has(`${fila.rol}:${fila.tipo}:${fila.clave}`)) continue;

    const grupo = `${fila.rol}:${fila.tipo}`;
    // Sin filas de ese grupo (instalacion nueva), el orden del catalogo: es
    // exactamente lo que hoy esta hardcodeado en la app.
    const orden = ultimoOrden.has(grupo) ? ultimoOrden.get(grupo)! + 1 : fila.orden;
    ultimoOrden.set(grupo, orden);

    await cliente.configuracionNavegacion.create({ data: { ...fila, orden } });
    creadas += 1;
  }

  return { creadas, existentes: filas.length - creadas };
}

async function main(): Promise<void> {
  const { creadas, existentes } = await sembrarNavegacion();
  console.log(`Navegacion sembrada: ${creadas} fila(s) nueva(s), ${existentes} ya estaban (no se pisan).`);
}

if (/sembrar-navegacion\.[tj]s$/.test(process.argv[1] ?? '')) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (e: unknown) => {
      console.error('[ERROR]', e instanceof Error ? e.message : e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
