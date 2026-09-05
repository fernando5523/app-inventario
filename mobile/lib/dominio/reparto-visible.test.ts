import { describe, expect, it } from 'vitest';
import { asistentesConCentavoExtra, type FilaConMonto } from './reparto-visible';

/**
 * El caso real de la reunión, tal como llega del backend:
 * 11 personas, 4 faltas, fondo S/80 entre 7 asistentes.
 * Cuota base 126.36; el piso del bono es 11.42 y seis llevan 11.43.
 */
const CUOTA = 126.36;
const PISO = 11.42;

const casoReal: FilaConMonto[] = [
  { asistio: true, monto: 114.93 }, // 126.36 − 11.43
  { asistio: true, monto: 114.93 },
  { asistio: true, monto: 114.93 },
  { asistio: true, monto: 114.93 },
  { asistio: true, monto: 114.93 },
  { asistio: true, monto: 114.93 },
  { asistio: true, monto: 114.94 }, // 126.36 − 11.42, el piso
  { asistio: false, monto: 146.36 },
  { asistio: false, monto: 146.36 },
  { asistio: false, monto: 146.36 },
  { asistio: false, monto: 146.36 },
];

describe('asistentesConCentavoExtra', () => {
  it('cuenta los 6 que llevan el centavo en el caso real de la reunión', () => {
    expect(asistentesConCentavoExtra(casoReal, CUOTA, PISO)).toBe(6);
  });

  it('devuelve 0 cuando el reparto dio PAREJO', () => {
    // El caso del mockup: S/60 entre 8 = 7.50 clavado para todos. Ahí la
    // aclaración del centavo no tiene que aparecer -- explicar un centavo que
    // no existe solo confunde.
    const parejo: FilaConMonto[] = Array.from({ length: 8 }, () => ({ asistio: true, monto: 118.86 }));
    expect(asistentesConCentavoExtra(parejo, 126.36, 7.5)).toBe(0);
  });

  it('NO cuenta a los que faltaron, aunque su monto sea distinto', () => {
    // Quien faltó no recibe bono: su monto es cuota + multa, mucho mayor.
    // Si se contara, la pantalla diría que a cuatro personas les tocó un
    // centavo más de un bono que no recibieron.
    const soloFaltas: FilaConMonto[] = [
      { asistio: false, monto: 146.36 },
      { asistio: false, monto: 146.36 },
    ];
    expect(asistentesConCentavoExtra(soloFaltas, CUOTA, PISO)).toBe(0);
  });

  it('no marca diferencias donde no las hay, pese al punto flotante', () => {
    // 126.36 − 114.93 no da exactamente 11.43 en binario. Comparando en soles
    // esto marcaría un centavo fantasma; comparando en centavos enteros, no.
    expect(126.36 - 114.93).not.toBe(11.43);
    const unoSolo: FilaConMonto[] = [{ asistio: true, monto: 114.93 }];
    expect(asistentesConCentavoExtra(unoSolo, 126.36, 11.43)).toBe(0);
  });

  it('con la planilla vacía devuelve 0', () => {
    expect(asistentesConCentavoExtra([], CUOTA, PISO)).toBe(0);
  });

  it('sin fondo que repartir (nadie faltó) no hay centavo que explicar', () => {
    const todosAsistieron: FilaConMonto[] = Array.from({ length: 11 }, () => ({ asistio: true, monto: 126.36 }));
    expect(asistentesConCentavoExtra(todosAsistieron, 126.36, 0)).toBe(0);
  });
});
