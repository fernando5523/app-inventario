/**
 * EL CUADRO DE FALTANTE POR PAQUETE, de punta a punta contra el backend vivo.
 *
 * Lo que prueba de verdad y no de palabra:
 *   1. que un faltante de mas de media caja SALGA del descuento al personal;
 *   2. que uno de media caja o menos SE QUEDE en el descuento;
 *   3. que corregir el empaque de compra ALCANCE para mover un item de cuadro,
 *      sin forzar la clase a mano ("asi evitamos estar corregir 1:1");
 *   4. que el faltante neto de la liquidacion BAJE exactamente lo que se fue
 *      al cuadro de paquetes.
 *
 * ARMA SU PROPIA TIENDA Y SU PROPIO INVENTARIO. No toca los de la
 * demostracion (8039 Bolivar, 8040 Sucre) ni ningun otro: si algo de este
 * script falla, no se lleva nada puesto.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO ES 100% HTTP
 * ---------------------------------------------------------------------------
 * `CatalogoItem.empaqueCompra` es el SNAPSHOT del ERP: lo escribe
 * `d365-catalogo.service.ts` al traer el catalogo de Dynamics, y no hay
 * endpoint que lo setee -- a proposito, porque es un dato del ERP y no una
 * decision de la app. Sin Dynamics configurado, la unica forma de tener items
 * con un empaque conocido es sembrarlos.
 *
 * Asi que el catalogo se siembra por Prisma y TODO LO DEMAS va por HTTP: el
 * login, las hojas, los conteos, el cierre, la matriz de auditoria, la
 * correccion del empaque y la liquidacion. La parte que se verifica es la que
 * va por la API.
 */
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { pinDev } from './_pin-dev.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const DEJAR = process.argv.includes('--dejar');
const prisma = new PrismaClient();

let fallas = 0;
const ok = (t: string): void => console.log('  [OK]    ' + t);
const mal = (t: string): void => {
  console.log('  [FALLA] ' + t);
  fallas += 1;
};
const info = (t: string): void => console.log('  [INFO]  ' + t);

interface Respuesta {
  status: number;
  datos: any;
  texto: string;
}

async function api(
  metodo: string,
  ruta: string,
  { token, body }: { token?: string; body?: unknown } = {},
): Promise<Respuesta> {
  const r = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const texto = await r.text();
  let datos: any = null;
  try {
    datos = texto === '' ? null : JSON.parse(texto);
  } catch {
    /* sin json */
  }
  return { status: r.status, datos, texto };
}

/**
 * EL PIN, SIN TANTEAR. Mismo patron que `verificar-clasificacion-3vias.mjs`,
 * copiado a proposito en vez de reinventado.
 *
 * La base SEMBRADA usa el PIN por rol (`_pin-dev.mjs`) y la de la
 * DEMOSTRACION VIVA usa otro. Se prueba UNA sola vez y el que funciona se
 * recuerda: el backend limita los ingresos a 8 intentos cada 15 minutos POR
 * COLABORADOR, y un login fallido cuenta. Probar PINes en cadena quema el cupo
 * y deja al colaborador bloqueado un cuarto de hora -- ya le paso a min-4.
 *
 * `PIN_PRUEBA=xxxxxx` lo fija de entrada y evita el tanteo por completo. Es la
 * forma recomendada de correr este script.
 */
let pinQueFunciono: string | null = process.env.PIN_PRUEBA ?? null;

async function entrar(id: number, rol: 'administrador' | 'auditor' | 'coordinador' | 'conteo'): Promise<any> {
  const candidatos = pinQueFunciono !== null ? [pinQueFunciono] : [pinDev(rol), '000020'];
  let ultimo: Respuesta | null = null;
  for (const pin of candidatos) {
    const r = await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: id, pin } });
    if (r.status === 200) {
      pinQueFunciono = pin;
      return r.datos;
    }
    // 429 = limitador. Seguir probando solo lo empeora, y el backend ya dice
    // cuanto falta.
    if (r.status === 429) {
      throw new Error(
        `El backend limitó los ingresos del colaborador ${id} ` +
          `(${r.datos?.detalles?.reintentarEnSegundos ?? '?'}s). Esperá ese rato, o corré con ` +
          'PIN_PRUEBA=<pin> para no gastar intentos tanteando.',
      );
    }
    ultimo = r;
  }
  throw new Error(
    `No se pudo ingresar como ${id} (${rol}): ${ultimo?.status} ${JSON.stringify(ultimo?.datos)}. ` +
      'Corré con PIN_PRUEBA=<pin> si esta base tiene un PIN propio.',
  );
}

/** Un PIN nuevo para los colaboradores que crea este script: cupo limpio. */
const entrarConPin = async (id: number, pin: string): Promise<any> =>
  (await api('POST', '/api/sesion/ingresar', { body: { colaboradorId: id, pin } })).datos;

/**
 * TODA ESCRITURA SE CHEQUEA. Un script de verificacion que canta [OK] sin
 * mirar la respuesta es peor que no tenerlo: da por bueno un escenario que
 * nunca se armo, y despues las aserciones fallan por una razon que no tiene
 * nada que ver con lo que se queria probar. Paso exactamente eso en la primera
 * corrida de este script -- decia "los 3 items contados" con 0 conteos en la
 * base.
 */
function exigir(r: Respuesta, que: string): any {
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`${que}: ${r.status} ${JSON.stringify(r.datos ?? r.texto).slice(0, 300)}`);
  }
  return r.datos;
}

/** `cerca(a, b)`: los montos son soles con 2 decimales. */
const cerca = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/** El primer auditor activo de la base, para no clavar un id que no existe. */
async function primerAuditor(): Promise<number> {
  const a = await prisma.colaborador.findFirst({
    where: { rol: 'auditor', activo: true },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (a === null) throw new Error('Esta base no tiene ningún auditor activo: el script no puede verificar la matriz.');
  return a.id;
}

const S = Date.now().toString().slice(-6);
const PIN = S;

/**
 * LOS TRES CASOS, elegidos para que cada uno pruebe una cosa distinta.
 * Stock 100 en los tres; lo que cambia es cuanto se cuenta y el empaque.
 */
const CASOS = [
  // 23 de 6 = 3.83 > 0.5  ->  PAQUETE. Es el ejemplo textual de Gilmer.
  { codigo: `PQ-${S}-A`, descripcion: 'GRANDE EMPAQUE 6', empaqueCompra: 6, simbolo: 'Emp.6', contado: 77, precio: 10, esperado: 'paquete' },
  // 2 de 6 = 0.33 <= 0.5  ->  UNIDAD (descuento al personal).
  { codigo: `PQ-${S}-B`, descripcion: 'CHICO EMPAQUE 6', empaqueCompra: 6, simbolo: 'Emp.6', contado: 98, precio: 10, esperado: 'unidad' },
  // 21 con empaque 1 (el ERP lo trae mal)  ->  UNIDAD, hasta que se corrija.
  // Es el caso DORITOS: PurchaseUnitSymbol 'U'.
  { codigo: `PQ-${S}-C`, descripcion: 'DISPLAY MAL TRAIDO', empaqueCompra: 1, simbolo: 'U', contado: 79, precio: 10, esperado: 'unidad' },
] as const;

async function main(): Promise<void> {
  console.log('== ESCENARIO ==');
  // EL PIN DEL ADMIN NO SE ADIVINA. `pinDev` es el del seed, pero una base a
  // la que le cambiaron los PIN (o sembrada antes de `PIN_DEV_POR_ROL`) no lo
  // tiene -- por eso el README documenta `PIN_ADMIN`. Si ninguno entra, el
  // script lo dice y para: probar PINes a ciegas contra una base real es lo
  // ultimo que queremos que haga un script.
  /**
   * EL TOKEN DEL ADMIN SE PUEDE PASAR HECHO, y conviene al iterar.
   *
   * El backend limita los ingresos a 8 cada 15 minutos POR COLABORADOR, y el
   * administrador es uno solo: cada corrida de este script le gasta un intento,
   * asi que depurarlo bloquea la cuenta en media docena de vueltas. Con
   * `ADMIN_TOKEN` el script no inicia sesion y el cupo no se toca.
   *
   *   ADMIN_TOKEN=$(curl -s -X POST localhost:3000/api/sesion/ingresar \
   *     -H 'Content-Type: application/json' \
   *     -d '{"colaboradorId":1000,"pin":"..."}' | jq -r .token)
   */
  const admin =
    process.env.ADMIN_TOKEN !== undefined
      ? { token: process.env.ADMIN_TOKEN }
      : await entrar(Number(process.env.ADMIN_ID ?? 1000), 'administrador');

  const tienda = (
    await api('POST', '/api/tiendas', {
      token: admin.token,
      // El almacen tiene que EXISTIR en Dynamics: el backend valida contra la
      // lista real y rechaza uno inventado. Se reusa el de Luzuriaga, como los
      // demas scripts de verificacion -- la tienda es nueva igual, y el
      // inventario que se abre es suyo.
      body: { nombre: `Market Paquete ${S}`, almacenId: process.env.ALMACEN_ID ?? 'MD01_LUZ' },
    })
  ).datos;
  if (!Number.isInteger(tienda?.id)) {
    throw new Error(`No se pudo crear la tienda de prueba: ${JSON.stringify(tienda)}`);
  }
  info(`tienda ${tienda.id} "${tienda.nombre}"`);

  const gente: Record<string, any> = {};
  for (const [clave, rol] of [
    ['coord', 'coordinador'],
    ['cont', 'conteo'],
  ] as const) {
    gente[clave] = (
      await api('POST', '/api/usuarios', {
        token: admin.token,
        body: {
          nombre: `${rol} pq ${S}`,
          dni: `${S}${Object.keys(gente).length}`.slice(-8),
          rol,
          sucursalId: tienda.id,
          pin: PIN,
        },
      })
    ).datos;
  }
  // Estos dos los crea el script con `PIN`, asi que tienen cupo limpio.
  const sCoord = await entrarConPin(gente.coord.id, PIN);
  const sCont = await entrarConPin(gente.cont.id, PIN);
  // EL AUDITOR SE BUSCA, no se hardcodea: el id 5 es el de la base sembrada de
  // cero, y en una base real es otro (acá son 1067 y 1071). Un id fijo hace
  // que el script falle en la base del cliente por una razón que no tiene nada
  // que ver con lo que prueba.
  const idAuditor = Number(process.env.AUDITOR_ID ?? 0) || (await primerAuditor());
  const auditor = await entrar(idAuditor, 'auditor');
  info(`auditor ${idAuditor}`);

  // El inventario se abre POR LA API, con el catalogo de EJEMPLO: `modo:
  // 'ejemplo'` no necesita Dynamics configurado. Sus items vienen SIN stock del
  // ERP, asi que quedan en veredicto `sin_erp` y NO ensucian los cuadros -- los
  // unicos que cuentan son los tres que siembra este script.
  const snap = (
    await api('POST', '/api/d365/snapshot', {
      token: sCoord.token,
      body: { sucursalId: tienda.id, modo: 'ejemplo' },
    })
  ).datos;
  const inventarioId: number = snap?.inventarioId;
  if (!Number.isInteger(inventarioId)) {
    throw new Error(`El snapshot no devolvió un inventario: ${JSON.stringify(snap)}`);
  }
  const inv = { id: inventarioId };
  info(`inventario ${inv.id} (catálogo de ejemplo, ${snap.items ?? '?'} ítems sin stock)`);

  // EL CATALOGO, por Prisma: `empaqueCompra` es el snapshot del ERP y no hay
  // endpoint que lo setee (ver la cabecera).
  await prisma.catalogoItem.createMany({
    data: CASOS.map((c) => ({
      inventarioId: inv.id,
      codigo: c.codigo,
      // `codigoBarras` es obligatorio en el snapshot: el escaner busca por el.
      // Se usa el mismo codigo, que alcanza para este escenario.
      codigoBarras: c.codigo,
      descripcion: c.descripcion,
      stockErp: 100,
      precioVenta: c.precio,
      esEmpresa: false,
      clase: c.empaqueCompra > 1 ? ('paquete' as const) : ('unidad' as const),
      empaqueCompra: c.empaqueCompra,
      empaqueCompraSimbolo: c.simbolo,
    })),
  });
  info(`catálogo sembrado: ${CASOS.length} ítems`);

  console.log('\n== CONTEO ==');
  const hojas = exigir(
    await api('POST', `/api/inventarios/${inv.id}/hojas`, { token: sCoord.token, body: { tamano: 50 } }),
    'crear las hojas',
  );
  const hoja = hojas[0];
  exigir(
    await api('POST', `/api/inventarios/${inv.id}/hojas/asignar`, {
      token: sCoord.token,
      body: { colaboradorIds: [gente.cont.id] },
    }),
    'asignar las hojas',
  );

  const mias = (await api('GET', `/api/hojas?alcance=mias&inventarioId=${inv.id}&ronda=1`, { token: sCont.token }))
    .datos;
  const productos = mias?.[0]?.productos ?? [];
  if (productos.length === 0) throw new Error(`La hoja llegó sin productos: ${JSON.stringify(mias)?.slice(0, 300)}`);
  // SE CUENTAN TODOS, no solo los tres: el backend no deja finalizar una hoja
  // con productos sin contar ("si no había nada, se carga 0 a mano" -- decisión
  // del cliente). Los del catálogo de ejemplo van en 0 y no ensucian nada: no
  // tienen stock del ERP, así que quedan en veredicto `sin_erp` y fuera de los
  // tres cuadros.
  for (const p of productos) {
    const caso = CASOS.find((c) => c.codigo === p.codigo) ?? { codigo: p.codigo, contado: 0 };
    exigir(
      await api('PUT', `/api/hojas/${hoja.id}/conteos/${p.id}`, {
        token: sCont.token,
        // `contadoEn` es obligatorio: es CUANDO lo conto el operario en el
        // telefono, no cuando llego al servidor (ver hojas.schema.ts).
        body: { empaques: [], sueltas: caso.contado, contadoEn: new Date().toISOString() },
      }),
      `guardar el conteo de ${caso.codigo}`,
    );
  }
  for (const c of CASOS) {
    if (!productos.some((p: any) => p.codigo === c.codigo)) mal(`el producto ${c.codigo} no llegó a la hoja`);
  }
  exigir(await api('POST', `/api/hojas/${hoja.id}/finalizar`, { token: sCont.token }), 'finalizar la hoja');
  ok('los 3 ítems contados y la hoja finalizada');

  console.log('\n== CIERRE Y MATRIZ ==');
  exigir(await api('POST', `/api/inventarios/${inv.id}/rondas/1/cerrar`, { token: sCoord.token }), 'cerrar la ronda 1');
  const matriz = (await api('GET', `/api/auditoria/inventarios/${inv.id}/matriz?filtro=todos`, { token: auditor.token })).datos;
  if (matriz?.resumen?.porClase === undefined) {
    mal('la matriz no trae `resumen.porClase` -- el cuadro de paquetes no llegó a la API');
    return;
  }
  const porClase = matriz.resumen.porClase;
  info(`unidad ${porClase.unidad.valorFaltante} | paquete ${porClase.paquete.valorFaltante}`);

  // (1) y (2): 23 x 10 = 230 fuera del descuento; 2 x 10 = 20 y 21 x 10 = 210
  // adentro (el tercero todavía tiene el empaque mal).
  if (cerca(porClase.paquete.valorFaltante, 230)) ok('el faltante de 23/6 SALIÓ del descuento (S/230 al cuadro de paquetes)');
  else mal(`se esperaba S/230 en el cuadro de paquetes, llegó ${porClase.paquete.valorFaltante}`);

  if (cerca(porClase.unidad.valorFaltante, 230)) ok('el de 2/6 y el del empaque mal traído SE QUEDARON en el descuento (S/230)');
  else mal(`se esperaba S/230 en el cuadro de unidad, llegó ${porClase.unidad.valorFaltante}`);

  console.log('\n== LA CORRECCIÓN DEL EMPAQUE (el caso DORITOS) ==');
  const antes = porClase.paquete.valorFaltante;
  exigir(
    // El codigo va en la RUTA, no en el cuerpo: la clasificacion es un recurso
    // con identidad propia por codigo (`PUT /api/clasificacion/:codigo`).
    await api('PUT', `/api/clasificacion/${CASOS[2].codigo}`, {
      token: auditor.token,
      // SIN `clase`: el punto de la verificación es justamente que corregir el
      // empaque ALCANCE, sin forzar el cuadro a mano. El schema es `.strict()`,
      // así que mandar `esEmpresa` (el campo viejo) da 400 -- a propósito.
      body: { empaqueCompraCorregido: 12, nota: `verificación ${S}` },
    }),
    'corregir el empaque de compra',
  );
  const matriz2 = (await api('GET', `/api/auditoria/inventarios/${inv.id}/matriz?filtro=todos`, { token: auditor.token })).datos;
  const despues = matriz2?.resumen?.porClase?.paquete?.valorFaltante ?? 0;

  // (3): corregir el empaque a 12 hace 21/12 = 1.75 > 0.5 -> se va a paquetes.
  // SIN forzar la clase: el cuerpo de arriba no manda `clase`.
  if (cerca(despues - antes, 210)) ok('corregir el empaque movió el ítem al cuadro de paquetes, SIN forzar la clase');
  else mal(`se esperaba que el cuadro de paquetes subiera S/210, subió ${(despues - antes).toFixed(2)}`);

  if (cerca(matriz2.resumen.porClase.unidad.valorFaltante, 20)) ok('y salió del descuento al personal: quedan solo los S/20 del ítem chico');
  else mal(`se esperaba S/20 en unidad, llegó ${matriz2.resumen.porClase.unidad.valorFaltante}`);

  // (4): el faltante DESCONTABLE es exactamente el cuadro `unidad`.
  if (cerca(matriz2.resumen.valorFaltanteDescontable, 20)) ok('el faltante descontable coincide con el cuadro `unidad`');
  else mal(`descontable ${matriz2.resumen.valorFaltanteDescontable}, se esperaba 20`);

  console.log('\n== EL EXCEL CONTRA LA PANTALLA ==');
  /**
   * EL ARCHIVO Y EL PANEL TIENEN QUE DECIR EL MISMO NUMERO. Si el Excel dice
   * una cosa y la app otra, la discusion con el cliente esta perdida antes de
   * empezar -- y este archivo es justo el que el va a poner al lado del suyo.
   *
   * Se descarga por HTTP, se abre el .xlsx que salio y se comparan sus totales
   * contra el resumen del MISMO endpoint que alimenta la pantalla.
   */
  const r = await fetch(`${BASE}/api/historial/inventarios/${inv.id}/cuadros/exportar`, {
    headers: { Authorization: `Bearer ${auditor.token}` },
  });
  if (!r.ok) {
    mal(`la exportación devolvió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  } else {
    const nombre = r.headers.get('content-disposition') ?? '';
    if (/filename="[a-z0-9-]+-\d{4}-\d{2}-inv\d+\.xlsx"/.test(nombre)) {
      ok(`el archivo viene con nombre distinguible: ${nombre.replace(/.*filename="|"/g, '')}`);
    } else {
      mal(`el nombre del archivo no sigue el patrón esperado: ${nombre}`);
    }

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await r.arrayBuffer()) as never);

    /**
     * El total de un bloque: la ultima celda numerica de la columna E entre
     * este titulo y el siguiente. Los titulos viven en la columna B.
     */
    const totalDelBloque = (hojaNombre: string, titulo: string): number => {
      const h = libro.getWorksheet(hojaNombre);
      if (h === undefined) return NaN;
      const TITULOS = ['PRODUCTOS FALTANTES UNICOS', 'FALTANTE POR PAQUETE', 'SOBRANTE POR PAQUETE'];
      let dentro = false;
      let total = NaN;
      h.eachRow((fila) => {
        const b = String(fila.getCell(2).value ?? '');
        if (TITULOS.includes(b)) {
          dentro = b === titulo;
          return;
        }
        if (!dentro) return;
        const e = fila.getCell(5).value;
        if (typeof e === 'number') total = e;
      });
      return total;
    };

    // Los faltantes del cuadro UNICO del archivo contra `porClase.unidad` del
    // endpoint. En el Excel van negativos (es un faltante); el resumen los
    // reporta en positivo.
    const enExcel = Math.abs(totalDelBloque('FALTANTES', 'PRODUCTOS FALTANTES UNICOS'));
    const enPantalla = matriz2.resumen.porClase.unidad.valorFaltante;
    if (cerca(enExcel, enPantalla)) ok(`el Excel y la pantalla coinciden en el cuadro único: S/${enPantalla}`);
    else mal(`el Excel dice S/${enExcel} en faltantes únicos y la pantalla S/${enPantalla}`);

    const paqExcel = Math.abs(totalDelBloque('FALTANTES', 'FALTANTE POR PAQUETE'));
    const paqPantalla = matriz2.resumen.porClase.paquete.valorFaltante;
    if (cerca(paqExcel, paqPantalla)) ok(`y en el cuadro por paquete: S/${paqPantalla}`);
    else mal(`el Excel dice S/${paqExcel} por paquete y la pantalla S/${paqPantalla}`);
  }

  console.log('\n== LIMPIEZA ==');
  if (DEJAR) {
    info(`--dejar: quedan la tienda ${tienda.id} y el inventario ${inv.id} para mirarlos a mano`);
  } else {
    // Solo lo que creó ESTE script, por id. Nunca un `deleteMany` abierto.
    await prisma.clasificacionProducto.deleteMany({ where: { codigo: { in: CASOS.map((c) => c.codigo) } } });
    info('clasificaciones de prueba borradas (la tienda y el inventario quedan: borrarlos a mano si molestan)');
  }

  console.log(`\n== RESULTADO: ${fallas === 0 ? 'TODO OK' : `${fallas} FALLA(S)`} ==`);
  if (fallas > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error('\n[ERROR]', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
