/**
 * El formulario de ajustes del mes.
 *
 * De acá sale un monto que BAJA lo que se le descuenta a once personas, así
 * que los bordes importan más que el layout. Y hay uno que es toda la regla:
 * **`0` es un valor válido**, no un campo vacío.
 */

import { describe, expect, it } from 'vitest';
import { textoDeAjustes, validarAjustes } from './ajustes-formulario';

const vacio = { montoNegativos: '', montoEmpresa: '', nota: '' };

describe('validarAjustes', () => {
  /**
   * EL CASO QUE DESTRABA EL MES. `null` en la base significa "nadie miró" y
   * bloquea la liquidación entera; un `0` cargado significa "alguien miró y
   * no había". Rechazar el 0 obligaría a inventar un centavo para poder
   * cerrar el mes.
   */
  it('0 es válido: "no hubo ajustes" también es un dato', () => {
    const r = validarAjustes({ ...vacio, montoNegativos: '0', nota: 'Revisado con Jocelyn: no hubo.' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datos.montoNegativos).toBe(0);
  });

  it('el campo vacío NO es 0: pide que se escriba', () => {
    const r = validarAjustes({ ...vacio, nota: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/escribí 0/i);
  });

  it('acepta coma decimal: en el teclado del teléfono es lo que sale', () => {
    const r = validarAjustes({ ...vacio, montoNegativos: '380,50', nota: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datos.montoNegativos).toBe(380.5);
  });

  it('acepta punto decimal también', () => {
    const r = validarAjustes({ ...vacio, montoNegativos: '380.50', nota: 'x' });
    if (r.ok) expect(r.datos.montoNegativos).toBe(380.5);
  });

  it('"380abc" se rechaza entero, no se guarda 380', () => {
    // `parseFloat` devolvería 380 y se guardaría un monto que nadie escribió.
    const r = validarAjustes({ ...vacio, montoNegativos: '380abc', nota: 'x' });
    expect(r.ok).toBe(false);
  });

  it('un monto negativo se rechaza: son plata A FAVOR del personal', () => {
    const r = validarAjustes({ ...vacio, montoNegativos: '-100', nota: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no pueden ser negativos/i);
  });

  it('sin nota se rechaza: un ajuste sin explicación no se audita después', () => {
    const r = validarAjustes({ ...vacio, montoNegativos: '380' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nota/i);
  });

  it('una nota de puros espacios no cuenta como nota', () => {
    const r = validarAjustes({ ...vacio, montoNegativos: '380', nota: '    ' });
    expect(r.ok).toBe(false);
  });

  it('la nota se manda sin espacios de sobra', () => {
    const r = validarAjustes({ ...vacio, montoNegativos: '380', nota: '  Mermas de agosto.  ' });
    if (r.ok) expect(r.datos.nota).toBe('Mermas de agosto.');
  });

  /**
   * VACÍO ≠ 0 en el monto de empresa, y la diferencia mueve plata: vacío
   * conserva lo que calculó el cierre del conteo desde las categorías de
   * empresa de Dynamics; un 0 escrito lo pisa con cero.
   */
  describe('montoEmpresa: vacío conserva, 0 pisa', () => {
    it('vacío NO viaja: el backend conserva el calculado', () => {
      const r = validarAjustes({ ...vacio, montoNegativos: '380', nota: 'x' });
      if (r.ok) expect(r.datos.montoEmpresa).toBeUndefined();
    });

    it('0 escrito SÍ viaja, y pisa con cero', () => {
      const r = validarAjustes({ montoNegativos: '380', montoEmpresa: '0', nota: 'x' });
      if (r.ok) expect(r.datos.montoEmpresa).toBe(0);
    });

    it('un monto de empresa negativo se rechaza', () => {
      const r = validarAjustes({ montoNegativos: '380', montoEmpresa: '-5', nota: 'x' });
      expect(r.ok).toBe(false);
    });

    it('un monto de empresa no numérico se rechaza', () => {
      const r = validarAjustes({ montoNegativos: '380', montoEmpresa: 'mucho', nota: 'x' });
      expect(r.ok).toBe(false);
    });
  });
});

describe('textoDeAjustes', () => {
  const soles = (n: number) => `S/ ${n.toFixed(2)}`;
  const fecha = () => '05/09/2026 12:00';

  it('sin registrar: dice que bloquea y que 0 también sirve', () => {
    const t = textoDeAjustes(
      { registrado: false, montoNegativos: null, registradoPor: null, registradoEn: null },
      soles,
      fecha,
    );
    expect(t.bloqueaLiquidacion).toBe(true);
    expect(t.detalle).toMatch(/cargá 0/i);
  });

  it('registrado: dice el monto, quién y cuándo', () => {
    const t = textoDeAjustes(
      { registrado: true, montoNegativos: 380, registradoPor: { nombre: 'Nancy Quispe' }, registradoEn: 'x' },
      soles,
      fecha,
    );
    expect(t.bloqueaLiquidacion).toBe(false);
    expect(t.titulo).toContain('380');
    expect(t.detalle).toContain('Nancy Quispe');
    expect(t.detalle).toContain('05/09/2026');
  });

  it('un 0 registrado NO bloquea: es un dato verificado', () => {
    const t = textoDeAjustes(
      { registrado: true, montoNegativos: 0, registradoPor: { nombre: 'Nancy' }, registradoEn: 'x' },
      soles,
      fecha,
    );
    expect(t.bloqueaLiquidacion).toBe(false);
    expect(t.titulo).toContain('0');
  });

  it('registrado en true pero monto null igual bloquea: manda el dato, no el flag', () => {
    const t = textoDeAjustes(
      { registrado: true, montoNegativos: null, registradoPor: null, registradoEn: null },
      soles,
      fecha,
    );
    expect(t.bloqueaLiquidacion).toBe(true);
  });
});
