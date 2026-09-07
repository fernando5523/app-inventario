/**
 * Verificación de SOLO LECTURA de los índices de rendimiento.
 *
 * No escribe nada: dos SELECT sobre catálogos del sistema (information_schema
 * y pg_indexes). Sirve para confirmar, después de una migración, que los
 * índices existen de verdad en la base y no solo en el schema.
 *
 * Ver backend/docs/rendimiento-db.md para por qué existe cada uno.
 *
 *   node scripts/verificar-indices.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Los cinco que agregó la migración `indices_rendimiento`. */
const ESPERADOS = [
  ['conteos', 'conteos_producto_id_idx'],
  ['hojas_conteo', 'hojas_conteo_asignado_a_id_idx'],
  ['hojas_conteo', 'hojas_conteo_asignado_a_2_id_idx'],
  ['liquidaciones_colaborador', 'liquidaciones_colaborador_colaborador_id_idx'],
  ['sesiones_token', 'sesiones_token_colaborador_id_idx'],
];

const defaults = await prisma.$queryRaw`
  SELECT column_name, column_default
  FROM information_schema.columns
  WHERE table_name = 'inventarios'
    AND column_name IN ('periodo_anio', 'periodo_mes')
  ORDER BY column_name
`;
console.log('--- defaults de inventarios (control del ALTER de Prisma) ---');
for (const d of defaults) console.log(`  ${d.column_name} = ${d.column_default}`);

const filas = await prisma.$queryRaw`
  SELECT tablename, indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename IN ('conteos', 'hojas_conteo', 'liquidaciones_colaborador', 'sesiones_token')
  ORDER BY tablename, indexname
`;

console.log('\n--- indices en las 4 tablas afectadas ---');
for (const f of filas) console.log(`  [${f.tablename}] ${f.indexname}`);

console.log('\n--- los 5 esperados ---');
let faltan = 0;
for (const [tabla, nombre] of ESPERADOS) {
  const hay = filas.some((f) => f.tablename === tabla && f.indexname === nombre);
  if (!hay) faltan++;
  console.log(`  ${hay ? 'OK   ' : 'FALTA'} ${nombre}`);
}

console.log(faltan === 0 ? '\nLos 5 indices existen.' : `\nFALTAN ${faltan}.`);
await prisma.$disconnect();
process.exit(faltan === 0 ? 0 : 1);
