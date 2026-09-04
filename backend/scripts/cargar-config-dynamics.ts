/**
 * Carga las credenciales de Dynamics EN LA BASE, desde esta máquina.
 *
 * POR QUÉ EXISTE ESTE SCRIPT, si ya hay una pantalla en el móvil.
 *
 * Porque tipear un `client_secret` de Azure —40+ caracteres sin sentido, con
 * mayúsculas, guiones y símbolos— en el teclado de un teléfono no es
 * incómodo: es una fuente de errores que después se diagnostican como "la
 * integración no anda". Y el error que produce es el peor de todos: Azure
 * responde 401 sin decir cuál de los cuatro campos está mal.
 *
 * Esta es la vía para la carga INICIAL, desde la máquina donde las
 * credenciales ya viven en el `.env`. La pantalla del móvil sigue siendo la
 * vía para CORREGIR un campo puntual más adelante, que es para lo que
 * realmente sirve.
 *
 * ---------------------------------------------------------------------------
 * QUÉ HACE, EN ORDEN
 * ---------------------------------------------------------------------------
 *   1. Carga `backend/.env` (con `process.loadEnvFile`, nativo de Node 20.6+).
 *   2. Verifica que estén las cinco variables `D365_*` y `APP_CIFRADO_CLAVE`.
 *   3. Llama a `guardar()` del service — NO hace el upsert por su cuenta.
 *   4. Vuelve a leer de la base y DESCIFRA, para probar que lo guardado se
 *      puede recuperar. Sin ese paso el script diría "listo" ante un secreto
 *      que después falla al pedir el token.
 *
 * El paso 3 es deliberado: reusar `guardar()` garantiza que este script y la
 * pantalla del móvil hacen EXACTAMENTE lo mismo — mismo cifrado, misma
 * validación zod, mismo registro de auditoría. Un script que hiciera su
 * propio `prisma.configDynamics.upsert()` se desincronizaría en el primer
 * cambio del service, y nadie se enteraría hasta que fallara en producción.
 *
 * ---------------------------------------------------------------------------
 * EL SECRETO NUNCA SE IMPRIME
 * ---------------------------------------------------------------------------
 * Ni acá ni en el log de auditoría. Lo único que se muestra es la huella
 * enmascarada que devuelve `enmascarar()` — dos caracteres de cada punta —
 * que alcanza para confirmar "cargué el que empieza con ab" y no sirve para
 * nada más. La salida de este script se pega en chats: tiene que ser segura
 * de pegar.
 *
 * ---------------------------------------------------------------------------
 * USO
 * ---------------------------------------------------------------------------
 *   npm run config:dynamics              # carga desde las D365_* del .env
 *   npm run config:dynamics -- --estado  # solo muestra qué hay hoy, no toca nada
 *
 * Después de cargar hay que REINICIAR el backend: `d365Config` lee
 * `process.env` una sola vez al importarse, así que un proceso ya levantado
 * sigue con lo viejo en memoria.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { prisma } from '../src/config/database';
import {
  VAR_CLAVE,
  cifradoDisponible,
  descifrar,
  enmascarar,
} from '../src/modules/config-dynamics/config-dynamics.cifrado';
import { guardar, obtener } from '../src/modules/config-dynamics/config-dynamics.service';
import type { ColaboradorAutenticado } from '../src/shared/tipos';

const SOLO_ESTADO = process.argv.includes('--estado');

const ok = (t: string) => console.log(`  [OK]    ${t}`);
const mal = (t: string) => console.log(`  [FALLA] ${t}`);
const nota = (t: string) => console.log(`  [NOTA]  ${t}`);

/**
 * Carga el `.env` del backend. Se hace acá y no se asume heredado del shell
 * porque este script se corre a mano, y en un shell limpio `process.env` no
 * tiene ninguna de las variables que necesitamos.
 */
function cargarEnv(): boolean {
  const ruta = resolve(import.meta.dirname, '..', '.env');
  if (!existsSync(ruta)) {
    mal(`No existe ${ruta}.`);
    return false;
  }
  process.loadEnvFile(ruta);
  ok(`.env cargado desde ${ruta}`);
  return true;
}

/**
 * El actor de la auditoría. Cargar las credenciales del ERP es una acción de
 * administración y tiene que quedar registrada a nombre de alguien: se usa
 * el administrador de menor id, que es el que sobrevive a cualquier reset.
 */
async function administrador(): Promise<ColaboradorAutenticado | null> {
  const fila = await prisma.colaborador.findFirst({
    where: { rol: 'administrador', activo: true },
    orderBy: { id: 'asc' },
    select: { id: true, sucursalId: true, rol: true, nombre: true },
  });
  if (fila === null) return null;
  nota(`La carga queda auditada a nombre de: ${fila.nombre} (id ${fila.id})`);
  return { colaboradorId: fila.id, sucursalId: fila.sucursalId, rol: fila.rol };
}

async function mostrarEstado(titulo: string): Promise<void> {
  const e = await obtener();
  console.log(`\n${titulo}`);
  console.log(`  origen ............... ${e.origen}`);
  console.log(`  tenantId ............. ${e.tenantId || '(vacío)'}`);
  console.log(`  clientId ............. ${e.clientId || '(vacío)'}`);
  console.log(`  urlBase .............. ${e.urlBase || '(vacío)'}`);
  console.log(`  secretoConfigurado ... ${e.secretoConfigurado}`);
  console.log(`  puedeGuardarSecreto .. ${e.puedeGuardarSecreto}`);
  console.log(`  actualizadoEn ........ ${e.actualizadoEn ?? '(nunca)'}`);
}

async function main(): Promise<number> {
  console.log('\n=== Cargar credenciales de Dynamics en la base ===\n');

  if (!cargarEnv()) return 1;

  await mostrarEstado('Estado ANTES:');
  if (SOLO_ESTADO) {
    console.log('\n(--estado: no se tocó nada)\n');
    return 0;
  }

  console.log('\nVerificando lo que hace falta:');

  // La clave de cifrado primero: sin ella `guardar()` tira 503 y no tiene
  // sentido haber llegado hasta acá para enterarse al final.
  if (!cifradoDisponible()) {
    mal(`Falta ${VAR_CLAVE} en el .env — sin ella el secreto no se puede cifrar, y un secreto`);
    console.log('          que no se puede proteger no se guarda. Generá una y agregala al .env:');
    console.log('\n            node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'hex\'))"');
    console.log(`\n            ${VAR_CLAVE}=<lo que salga>\n`);
    console.log('          OJO: esa clave no se cambia después. Si cambia, el secreto ya guardado');
    console.log('          en la base deja de descifrarse y hay que volver a cargarlo.\n');
    return 1;
  }
  ok(`${VAR_CLAVE} presente`);

  const tenantId = process.env.D365_TENANT_ID ?? '';
  const clientId = process.env.D365_CLIENT_ID ?? '';
  const clientSecret = process.env.D365_CLIENT_SECRET ?? '';
  const urlBase = process.env.D365_BASE_URL ?? '';
  const dataAreaId = process.env.D365_DATA_AREA_ID ?? '';

  const faltantes = (
    [
      ['D365_TENANT_ID', tenantId],
      ['D365_CLIENT_ID', clientId],
      ['D365_CLIENT_SECRET', clientSecret],
      ['D365_BASE_URL', urlBase],
    ] as const
  )
    .filter(([, v]) => v === '')
    .map(([n]) => n);

  if (faltantes.length > 0) {
    mal(`Faltan variables en el .env: ${faltantes.join(', ')}`);
    return 1;
  }
  ok(`D365_TENANT_ID ....... ${tenantId}`);
  ok(`D365_CLIENT_ID ....... ${clientId}`);
  ok(`D365_BASE_URL ........ ${urlBase}`);
  ok(`D365_DATA_AREA_ID .... ${dataAreaId || '(vacío — se usará el del entorno)'}`);
  // Lo único que se dice del secreto, acá y en cualquier otro lado.
  ok(`D365_CLIENT_SECRET ... ${enmascarar(clientSecret)}`);

  const actor = await administrador();
  if (actor === null) {
    mal('No hay ningún administrador activo en la base para auditar la carga.');
    nota('Corré `npm run prisma:seed` primero.');
    return 1;
  }

  console.log('\nGuardando…');
  await guardar(actor, {
    tenantId,
    clientId,
    urlBase,
    ...(dataAreaId !== '' ? { dataAreaId } : {}),
    clientSecret,
  });
  ok('Fila guardada (por el mismo service que usa la pantalla del móvil)');

  // Verificación de ida y vuelta. Que el guardado no tire excepción no prueba
  // que lo guardado se pueda recuperar: eso se prueba descifrando.
  console.log('\nVerificando que lo guardado se pueda recuperar:');
  const fila = await prisma.configDynamics.findUnique({ where: { id: 1 } });
  if (fila === null || fila.clientSecretCifrado === null) {
    mal('La fila no quedó en la base.');
    return 1;
  }
  if (descifrar(fila.clientSecretCifrado) !== clientSecret) {
    mal('El secreto descifrado NO coincide con el original. No usar: algo está mal con la clave.');
    return 1;
  }
  ok('El secreto se descifra y coincide con el original');

  await mostrarEstado('Estado DESPUÉS:');

  console.log('\n  Reiniciá el backend para que tome la configuración nueva:');
  console.log('  `d365Config` lee process.env una sola vez al importarse.\n');
  return 0;
}

main()
  .then(async (codigo) => {
    await prisma.$disconnect();
    process.exit(codigo);
  })
  .catch(async (e: unknown) => {
    console.error('\n[ERROR]', e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(1);
  });
