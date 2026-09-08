import { describe, expect, it } from 'vitest';
import {
  contarFiltrosActivosModal,
  cumpleFiltro,
  cumpleFiltroModal,
  elegirCampo,
  filtrarHojasModal,
  FILTRO_HOJAS_MODAL_VACIO,
  numerosDeHojas,
  opcionesEnCascada,
  personasDeHojas,
  textoFiltroModalActivo,
  textoMostrando,
} from './filtro-hojas';
import type { Conteo, EstadoHoja, HojaConteo, Producto } from './tipos';

function producto(id: number): Producto {
  return {
    id,
    codigo: String(id).padStart(4, '0'),
    codigoBarras: `775000${id}`,
    descripcion: `Producto ${id}`,
    empaques: [{ nombre: 'Caja', factor: 12 }],
  };
}

function conteoDe(productoId: number): Conteo {
  return {
    productoId,
    empaques: [{ empaqueNombre: 'Caja', cantidad: 1 }],
    sueltas: 0,
    confirmadoPorEscaner: false,
    contadoEn: '2026-09-05T10:00:00.000Z',
  };
}

/** `productos` cuántos tiene, `contados` cuántos de esos tienen conteo. */
function hoja(estado: EstadoHoja, productos: number, contados: number, id = 1, asignados: string[] = []): HojaConteo {
  return {
    id,
    inventarioId: 1,
    numero: String(id).padStart(3, '0'),
    zona: 'Abarrotes',
    gondola: 'A2',
    tamano: 50,
    estado,
    sync: 'local',
    asignados,
    productos: Array.from({ length: productos }, (_, i) => producto(i + 1)),
    conteos: Array.from({ length: contados }, (_, i) => conteoDe(i + 1)),
  };
}

// Formateador determinista: `toLocaleString('es-PE')` depende del ICU del
// runtime (en Node sin ICU completo da "8,000" en vez de "8.000") y el test
// no puede depender de con qué build de Node se corre.
const miles = (n: number): string => String(n);

describe('cumpleFiltro: todas', () => {
  it.each<EstadoHoja>(['pendiente', 'en-proceso', 'finalizada'])('deja pasar una hoja %s', (estado) => {
    expect(cumpleFiltro(hoja(estado, 5, 0), 'todas')).toBe(true);
  });
});

describe('cumpleFiltro: sin-finalizar', () => {
  it('pasa pendiente y en-proceso', () => {
    expect(cumpleFiltro(hoja('pendiente', 5, 0), 'sin-finalizar')).toBe(true);
    expect(cumpleFiltro(hoja('en-proceso', 5, 3), 'sin-finalizar')).toBe(true);
  });

  it('no pasa una finalizada, aunque le falten productos por contar', () => {
    expect(cumpleFiltro(hoja('finalizada', 5, 2), 'sin-finalizar')).toBe(false);
  });
});

describe('cumpleFiltro: finalizadas', () => {
  it('solo pasa la finalizada', () => {
    expect(cumpleFiltro(hoja('finalizada', 5, 5), 'finalizadas')).toBe(true);
    expect(cumpleFiltro(hoja('en-proceso', 5, 5), 'finalizadas')).toBe(false);
  });

  it('una finalizada con productos sin conteo sigue estando acá (es donde se la mira)', () => {
    expect(cumpleFiltro(hoja('finalizada', 5, 1), 'finalizadas')).toBe(true);
  });
});

describe('cumpleFiltro: sin-conteo (el que usa el Coordinador para ir a buscar lo que falta)', () => {
  it('pasa una hoja en proceso con productos sin contar', () => {
    expect(cumpleFiltro(hoja('en-proceso', 5, 2), 'sin-conteo')).toBe(true);
  });

  it('pasa una pendiente sin nada contado', () => {
    expect(cumpleFiltro(hoja('pendiente', 5, 0), 'sin-conteo')).toBe(true);
  });

  it('no pasa una hoja abierta con todo contado', () => {
    expect(cumpleFiltro(hoja('en-proceso', 5, 5), 'sin-conteo')).toBe(false);
  });

  it('NO pasa una finalizada con productos sin conteo: finalizar registra 0 a propósito', () => {
    // Es la regla que decide todo el filtro. `finalizar` graba 0 en los
    // productos que quedaron sin contar, así que en una hoja cerrada "sin
    // conteo" significa "se contó como cero", no "falta contar esto".
    // Mezclarlas devolvería hojas donde ya no hay nada que hacer.
    expect(cumpleFiltro(hoja('finalizada', 5, 2), 'sin-conteo')).toBe(false);
  });

  it('una hoja vacía (sin productos) no cuenta como "con productos sin conteo"', () => {
    expect(cumpleFiltro(hoja('pendiente', 0, 0), 'sin-conteo')).toBe(false);
  });
});

describe('textoMostrando', () => {
  it('con un subconjunto dice "X de Y"', () => {
    expect(textoMostrando(7, 25, miles)).toBe('Mostrando 7 de 25 hojas');
  });

  it('cuando se ven todas NO dice "25 de 25": eso invita a buscar qué se oculta', () => {
    expect(textoMostrando(25, 25, miles)).toBe('Mostrando 25 hojas');
  });

  it('singular cuando hay una sola hoja', () => {
    expect(textoMostrando(1, 1, miles)).toBe('Mostrando 1 hoja');
  });

  it('cero visibles sobre un total: sigue diciendo de cuántas', () => {
    expect(textoMostrando(0, 25, miles)).toBe('Mostrando 0 de 25 hojas');
  });

  it('sin hojas: "Mostrando 0 hojas", en plural', () => {
    expect(textoMostrando(0, 0, miles)).toBe('Mostrando 0 hojas');
  });

  it('usa el formateador que le pasan, no uno propio', () => {
    expect(textoMostrando(1200, 3703, (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'))).toBe(
      'Mostrando 1.200 de 3.703 hojas',
    );
  });
});

describe('personasDeHojas', () => {
  it('distintas, en el orden en que aparecen, sin repetir', () => {
    const hojas = [
      hoja('pendiente', 5, 0, 1, ['Elena Príncipe']),
      hoja('pendiente', 5, 0, 2, ['Marcos Ruiz', 'Elena Príncipe']),
      hoja('pendiente', 5, 0, 3, []),
    ];
    expect(personasDeHojas(hojas)).toEqual(['Elena Príncipe', 'Marcos Ruiz']);
  });

  it('sin hojas: lista vacía', () => {
    expect(personasDeHojas([])).toEqual([]);
  });
});

describe('numerosDeHojas', () => {
  it('tal cual vienen, en el orden de la lista', () => {
    const hojas = [hoja('pendiente', 5, 0, 3), hoja('pendiente', 5, 0, 1)];
    expect(numerosDeHojas(hojas)).toEqual(['003', '001']);
  });
});

describe('cumpleFiltroModal / filtrarHojasModal: los tres criterios del modal, combinados con Y', () => {
  const hojas = [
    hoja('pendiente', 5, 0, 1, ['Elena Príncipe']), // sin finalizar, le faltan 5
    hoja('en-proceso', 5, 5, 2, ['Marcos Ruiz']), // sin finalizar, no le falta ninguno
    hoja('finalizada', 5, 3, 3, ['Elena Príncipe', 'Marcos Ruiz']), // cerrada, con 2 en cero
    hoja('finalizada', 5, 5, 4, []), // cerrada y completa, sin asignar
  ];

  it('vacío (FILTRO_HOJAS_MODAL_VACIO): pasan todas', () => {
    expect(filtrarHojasModal(hojas, FILTRO_HOJAS_MODAL_VACIO).map((h) => h.id)).toEqual([1, 2, 3, 4]);
  });

  it('solo persona: cualquier hoja donde esa persona sea uno de los dos asignados', () => {
    expect(filtrarHojasModal(hojas, { ...FILTRO_HOJAS_MODAL_VACIO, persona: 'Elena Príncipe' }).map((h) => h.id)).toEqual([1, 3]);
  });

  it('solo estado: misma regla que cumpleFiltro', () => {
    expect(filtrarHojasModal(hojas, { ...FILTRO_HOJAS_MODAL_VACIO, estado: 'sin-conteo' }).map((h) => h.id)).toEqual([1]);
  });

  it('solo número: coincidencia exacta', () => {
    expect(filtrarHojasModal(hojas, { ...FILTRO_HOJAS_MODAL_VACIO, numero: '002' }).map((h) => h.id)).toEqual([2]);
  });

  it('combinados con Y: persona Y estado a la vez', () => {
    expect(
      filtrarHojasModal(hojas, { persona: 'Elena Príncipe', estado: 'finalizadas', numero: null }).map((h) => h.id),
    ).toEqual([3]);
  });

  it('sin coincidencias: lista vacía, no rompe', () => {
    expect(filtrarHojasModal(hojas, { ...FILTRO_HOJAS_MODAL_VACIO, persona: 'Nadie' }).map((h) => h.id)).toEqual([]);
  });
});

describe('contarFiltrosActivosModal', () => {
  it('vacío: 0', () => {
    expect(contarFiltrosActivosModal(FILTRO_HOJAS_MODAL_VACIO)).toBe(0);
  });

  it('cuenta cada campo puesto, `estado` distinto de "todas" incluido', () => {
    expect(contarFiltrosActivosModal({ persona: 'Elena Príncipe', estado: 'finalizadas', numero: '003' })).toBe(3);
    expect(contarFiltrosActivosModal({ persona: null, estado: 'sin-conteo', numero: null })).toBe(1);
  });
});

describe('textoFiltroModalActivo', () => {
  it('sin nada activo: null', () => {
    expect(textoFiltroModalActivo(FILTRO_HOJAS_MODAL_VACIO)).toBeNull();
  });

  it('combina las partes activas en el orden persona · estado · número', () => {
    expect(textoFiltroModalActivo({ persona: 'Elena Príncipe', estado: 'finalizadas', numero: '003' })).toBe(
      'Elena Príncipe · Finalizadas · Hoja #003',
    );
  });

  it('solo el número puesto', () => {
    expect(textoFiltroModalActivo({ persona: null, estado: 'todas', numero: '007' })).toBe('Hoja #007');
  });
});

// Fixture del modal en cascada -- Elena solo aparece en hojas sin finalizar
// (una con productos sin contar), Marcos solo en la finalizada, y la última
// queda sin asignar. Así cada campo demuestra una reducción distinta, mismo
// espíritu que el fixture HOJA de filtro-productos.test.ts (af4810f).
const HOJAS_MODAL = [
  hoja('pendiente', 5, 0, 1, ['Elena Príncipe']), // 001, sin-finalizar + sin-conteo
  hoja('en-proceso', 5, 5, 2, ['Elena Príncipe']), // 002, sin-finalizar, todo contado
  hoja('finalizada', 5, 5, 3, ['Marcos Ruiz']), // 003, finalizada
  hoja('finalizada', 5, 5, 4, []), // 004, finalizada, sin asignar
];

describe('opcionesEnCascada: cada selector se recorta con lo que ya eligieron los otros dos', () => {
  it('sin nada elegido: las tres listas completas', () => {
    const op = opcionesEnCascada(HOJAS_MODAL, FILTRO_HOJAS_MODAL_VACIO);
    expect(op.persona).toEqual(['Elena Príncipe', 'Marcos Ruiz']);
    expect(op.estado).toEqual(['sin-finalizar', 'sin-conteo', 'finalizadas']);
    expect(op.numero).toEqual(['001', '002', '003', '004']);
  });

  it('elegir persona reduce estado y número a los de sus hojas', () => {
    const op = opcionesEnCascada(HOJAS_MODAL, { ...FILTRO_HOJAS_MODAL_VACIO, persona: 'Elena Príncipe' });
    expect(op.estado).toEqual(['sin-finalizar', 'sin-conteo']);
    expect(op.numero).toEqual(['001', '002']);
  });

  it('persona NO se recorta a sí misma -- si no, quedaría viendo una sola opción: la que ya tiene puesta', () => {
    const op = opcionesEnCascada(HOJAS_MODAL, { ...FILTRO_HOJAS_MODAL_VACIO, persona: 'Elena Príncipe' });
    expect(op.persona).toEqual(['Elena Príncipe', 'Marcos Ruiz']);
  });

  it('elegir estado reduce persona y número a los de esas hojas', () => {
    const op = opcionesEnCascada(HOJAS_MODAL, { ...FILTRO_HOJAS_MODAL_VACIO, estado: 'finalizadas' });
    // La 004 está finalizada pero sin asignar -- no aporta ningún nombre.
    expect(op.persona).toEqual(['Marcos Ruiz']);
    expect(op.numero).toEqual(['003', '004']);
  });

  it('persona + estado juntos: número queda en uno solo', () => {
    const op = opcionesEnCascada(HOJAS_MODAL, { persona: 'Elena Príncipe', estado: 'sin-conteo', numero: null });
    expect(op.numero).toEqual(['001']);
  });

  it('"Limpiar todo" (FILTRO_HOJAS_MODAL_VACIO) vuelve a las opciones completas', () => {
    expect(opcionesEnCascada(HOJAS_MODAL, FILTRO_HOJAS_MODAL_VACIO)).toEqual({
      persona: ['Elena Príncipe', 'Marcos Ruiz'],
      estado: ['sin-finalizar', 'sin-conteo', 'finalizadas'],
      numero: ['001', '002', '003', '004'],
    });
  });
});

describe('elegirCampo: un valor que deja de tener sentido con el cambio se limpia solo', () => {
  it('cambiar el estado descarta la persona que ya no pertenece a él', () => {
    const conPersona = { ...FILTRO_HOJAS_MODAL_VACIO, persona: 'Elena Príncipe' };
    expect(elegirCampo(HOJAS_MODAL, conPersona, 'estado', 'finalizadas')).toEqual({
      persona: null,
      estado: 'finalizadas',
      numero: null,
    });
  });

  it('cambiar el estado descarta también el número, si tampoco corresponde', () => {
    const completo = { persona: 'Elena Príncipe', estado: 'todas' as const, numero: '001' };
    expect(elegirCampo(HOJAS_MODAL, completo, 'estado', 'finalizadas')).toEqual({
      persona: null,
      estado: 'finalizadas',
      numero: null,
    });
  });

  it('un valor que sigue siendo compatible no se toca', () => {
    const conPersona = { ...FILTRO_HOJAS_MODAL_VACIO, persona: 'Elena Príncipe' };
    expect(elegirCampo(HOJAS_MODAL, conPersona, 'estado', 'sin-finalizar')).toEqual({
      persona: 'Elena Príncipe',
      estado: 'sin-finalizar',
      numero: null,
    });
  });

  it('elegir un estado no toca un número que sigue siendo la misma hoja', () => {
    const conNumeroYPersona = { persona: 'Elena Príncipe', estado: 'todas' as const, numero: '001' };
    expect(elegirCampo(HOJAS_MODAL, conNumeroYPersona, 'estado', 'sin-conteo')).toEqual({
      persona: 'Elena Príncipe',
      estado: 'sin-conteo',
      numero: '001',
    });
  });

  it('limpiar UN campo (valor vacío) nunca borra los otros', () => {
    const completo = { persona: 'Marcos Ruiz', estado: 'finalizadas' as const, numero: '003' };
    expect(elegirCampo(HOJAS_MODAL, completo, 'persona', null)).toEqual({
      persona: null,
      estado: 'finalizadas',
      numero: '003',
    });
  });

  it('limpiar el estado (valor "todas") tampoco borra los otros', () => {
    const completo = { persona: 'Marcos Ruiz', estado: 'finalizadas' as const, numero: '003' };
    expect(elegirCampo(HOJAS_MODAL, completo, 'estado', 'todas')).toEqual({
      persona: 'Marcos Ruiz',
      estado: 'todas',
      numero: '003',
    });
  });
});
