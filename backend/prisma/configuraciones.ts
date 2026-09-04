/**
 * Los valores con los que arranca `Configuracion`.
 *
 * Vive aparte del seed porque lo leen DOS lugares: `seed.ts` (base nueva,
 * con datos de demo) y `sembrar-configuraciones.ts` (base con datos reales,
 * solo agrega las que faltan). Duplicar la lista significaba que agregar una
 * clave en uno y olvidarla en el otro pasara sin que nadie se entere -- y el
 * sintoma seria una clave que existe en desarrollo y no en produccion.
 */

import { ALMACENES_INICIALES } from '../src/modules/d365/d365.almacenes-inventario';

/**
 * Defaults sugeridos, no reglas duras -- el auditor los puede cambiar
 * desde /api/config (ver backend/README.md). UMBRAL_MEDIA_UNIDAD_PAQUETE
 * = 0.5 es la "mitad" que menciona Oscar en la reunion (docs/pantallas.md,
 * pregunta 1): 0.5 = mitad exacta del paquete.
 */
export const CONFIGURACIONES = [
  {
    clave: 'TAMANO_HOJA_DEFECTO',
    valor: '50',
    tipo: 'entero' as const,
    descripcion: 'Cantidad de items por hoja que se preselecciona al crear hojas de conteo (20, 30 o 50).',
  },
  {
    clave: 'ALMACENES_INVENTARIO',
    valor: ALMACENES_INICIALES.join(','),
    tipo: 'texto' as const,
    descripcion:
      'Almacenes de Dynamics que entran al inventario fisico, separados por coma. El tenant tiene 70 y la mayoria son de Transito o Cuarentena, que no se cuentan. Se agrega uno cuando abre una tienda nueva.',
  },
  {
    clave: 'CANTIDAD_CONTEOS_CICLO',
    valor: '3',
    tipo: 'entero' as const,
    descripcion: 'Cantidad de pasadas de conteo del ciclo antes de pasar a auditoria (hoy: 3).',
  },
  {
    clave: 'UMBRAL_MEDIA_UNIDAD_PAQUETE',
    valor: '0.5',
    tipo: 'decimal' as const,
    descripcion:
      'Fraccion del paquete (0-1) a partir de la cual un faltante/sobrante se descuenta por paquete completo en vez de por unidad suelta. Default sugerido, el auditor lo ajusta caso por caso (docs/pantallas.md, pregunta 1).',
  },
];
