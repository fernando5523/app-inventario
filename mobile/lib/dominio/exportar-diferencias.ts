/**
 * El nombre del archivo .xlsx de faltantes/sobrantes -- pedido del cliente:
 * identifica tienda + período + inventario, SIN espacios ni acentos, porque
 * es lo que se manda por WhatsApp y un nombre con "í"/" " puede llegar
 * recodificado distinto según el cliente de mensajería del otro lado.
 *
 * Mismo criterio (y mismo formato de salida) que el backend
 * (historial.exportar.ts#nombreArchivoExportDiferencias). Se recalcula acá
 * en vez de leer el header `Content-Disposition` de la respuesta: los tres
 * datos que hacen falta ya están en pantalla (DetalleInventarioHistorico),
 * así que el puerto no necesita devolver más que los bytes.
 */
export function nombreArchivoDiferencias(sucursal: string, periodoAnio: number, periodoMes: number, inventarioId: number): string {
  const slugSucursal =
    sucursal
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sucursal';
  const periodo = `${periodoAnio}-${String(periodoMes).padStart(2, '0')}`;
  return `diferencias-${slugSucursal}-${periodo}-inv${inventarioId}.xlsx`;
}
