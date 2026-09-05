import { describe, expect, it } from 'vitest';
import { Conflicto, Prohibido, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import {
  resolverSucursalConsultable,
  validarAccesoAInventario,
  validarPeriodo,
  validarPuedeAprobar,
  validarPuedeLacrar,
  verificarNoLacrado,
  type EstadoInventario,
} from './historial.permisos';

const admin: ColaboradorAutenticado = { colaboradorId: 1, sucursalId: null, rol: 'administrador' };
const gilmer: ColaboradorAutenticado = { colaboradorId: 12, sucursalId: 1, rol: 'auditor' };
const rosa: ColaboradorAutenticado = { colaboradorId: 30, sucursalId: 1, rol: 'auditor' };
const auditorOtraTienda: ColaboradorAutenticado = { colaboradorId: 40, sucursalId: 2, rol: 'auditor' };
const contador: ColaboradorAutenticado = { colaboradorId: 50, sucursalId: 1, rol: 'conteo' };
const coordinador: ColaboradorAutenticado = { colaboradorId: 60, sucursalId: 1, rol: 'coordinador' };

const inventario = (estado: EstadoInventario, sucursalId = 1): { sucursalId: number; estado: EstadoInventario } => ({
  sucursalId,
  estado,
});

// ---------------------------------------------------------------------------
// Alcance de lectura: conteo ciego
// ---------------------------------------------------------------------------

describe('resolverSucursalConsultable', () => {
  it('el administrador ve todo cuando no filtra', () => {
    expect(resolverSucursalConsultable(admin, undefined)).toBeUndefined();
  });

  it('el administrador puede filtrar por la sucursal que quiera', () => {
    expect(resolverSucursalConsultable(admin, 3)).toBe(3);
  });

  it('el auditor queda recortado a SU sucursal aunque no pida filtro', () => {
    expect(resolverSucursalConsultable(gilmer, undefined)).toBe(1);
  });

  it('el auditor no puede espiar otra tienda pidiendo otro sucursalId', () => {
    // Se ignora el query param en vez de tirar 403: pedir "todas" desde una
    // cuenta de auditor es la UI mandando su filtro por defecto, no un ataque.
    expect(resolverSucursalConsultable(gilmer, 2)).toBe(1);
  });

  it('un contador NO entra al historico: es la regla de conteo ciego', () => {
    expect(() => resolverSucursalConsultable(contador, undefined)).toThrow(Prohibido);
  });

  it('un coordinador tampoco entra al historico', () => {
    expect(() => resolverSucursalConsultable(coordinador, undefined)).toThrow(Prohibido);
  });

  it('un auditor sin sucursal no recibe el historico entero por las dudas', () => {
    const roto: ColaboradorAutenticado = { colaboradorId: 99, sucursalId: null, rol: 'auditor' };
    expect(() => resolverSucursalConsultable(roto, undefined)).toThrow(Prohibido);
  });
});

describe('validarAccesoAInventario', () => {
  it('el administrador entra a cualquier inventario', () => {
    expect(() => validarAccesoAInventario(admin, { sucursalId: 9 })).not.toThrow();
  });

  it('el auditor entra al de su sucursal', () => {
    expect(() => validarAccesoAInventario(gilmer, { sucursalId: 1 })).not.toThrow();
  });

  it('el auditor NO entra al de otra sucursal', () => {
    expect(() => validarAccesoAInventario(gilmer, { sucursalId: 2 })).toThrow(Prohibido);
  });

  it('un contador no entra ni al de su propia sucursal', () => {
    expect(() => validarAccesoAInventario(contador, { sucursalId: 1 })).toThrow(Prohibido);
  });
});

// ---------------------------------------------------------------------------
// Inmutabilidad
// ---------------------------------------------------------------------------

describe('verificarNoLacrado', () => {
  it('deja pasar un inventario en curso o con el conteo cerrado', () => {
    expect(() => verificarNoLacrado({ estado: 'en_curso' }, 'editar')).not.toThrow();
    expect(() => verificarNoLacrado({ estado: 'conteo_cerrado' }, 'editar')).not.toThrow();
  });

  it('bloquea cualquier accion sobre un inventario lacrado', () => {
    expect(() => verificarNoLacrado({ estado: 'lacrado' }, 'editar')).toThrow(Conflicto);
  });

  it('el mensaje explica que el ajuste va al periodo siguiente', () => {
    expect(() => verificarNoLacrado({ estado: 'lacrado' }, 'editar')).toThrow(/periodo siguiente/);
  });

  it('bloquea tambien un inventario anulado', () => {
    expect(() => verificarNoLacrado({ estado: 'anulado' }, 'editar')).toThrow(Conflicto);
  });
});

// ---------------------------------------------------------------------------
// EL CONTROL DE DOS PERSONAS
// ---------------------------------------------------------------------------

describe('validarPuedeAprobar', () => {
  it('un auditor de la sucursal puede firmar un inventario con el conteo cerrado', () => {
    expect(() => validarPuedeAprobar(gilmer, inventario('conteo_cerrado'), [])).not.toThrow();
  });

  it('tambien se puede firmar cuando ya esta liquidado', () => {
    expect(() => validarPuedeAprobar(gilmer, inventario('liquidado'), [])).not.toThrow();
  });

  it('LA MISMA PERSONA NO COMPLETA EL PAR: la segunda firma la da otro', () => {
    // El corazon del control de dos personas. Gilmer ya firmo; si pudiera
    // firmar de nuevo cerraria el mes solo y la doble validacion seria un
    // boton doble.
    expect(() => validarPuedeAprobar(gilmer, inventario('conteo_cerrado'), [{ aprobadorId: gilmer.colaboradorId }])).toThrow(
      Conflicto,
    );
  });

  it('el mensaje le dice que la otra firma va desde otra sesion', () => {
    expect(() =>
      validarPuedeAprobar(gilmer, inventario('conteo_cerrado'), [{ aprobadorId: gilmer.colaboradorId }]),
    ).toThrow(/OTRA persona/);
  });

  it('OTRA persona SI puede dar la segunda firma', () => {
    expect(() =>
      validarPuedeAprobar(rosa, inventario('conteo_cerrado'), [{ aprobadorId: gilmer.colaboradorId }]),
    ).not.toThrow();
  });

  it('no se firma un inventario que todavia se esta contando', () => {
    // Firmar un resultado que todavia puede cambiar no valida nada.
    expect(() => validarPuedeAprobar(gilmer, inventario('en_curso'), [])).toThrow(Conflicto);
  });

  it('no se firma un inventario ya lacrado', () => {
    expect(() => validarPuedeAprobar(gilmer, inventario('lacrado'), [])).toThrow(Conflicto);
  });

  it('no se firma un inventario anulado', () => {
    expect(() => validarPuedeAprobar(gilmer, inventario('anulado'), [])).toThrow(Conflicto);
  });

  it('un auditor de otra tienda no firma este cierre', () => {
    expect(() => validarPuedeAprobar(auditorOtraTienda, inventario('conteo_cerrado', 1), [])).toThrow(Prohibido);
  });

  it('un contador no firma el cierre', () => {
    expect(() => validarPuedeAprobar(contador, inventario('conteo_cerrado'), [])).toThrow(Prohibido);
  });

  it('un coordinador tampoco firma el cierre hoy (ver ROLES_QUE_APRUEBAN_CIERRE)', () => {
    expect(() => validarPuedeAprobar(coordinador, inventario('conteo_cerrado'), [])).toThrow(Prohibido);
  });

  it('el par completo dice que el paso siguiente es LACRAR', () => {
    // No es un error: es que ya se habilito lo que sigue. Decirlo evita que
    // la persona se pregunte que hizo mal.
    expect(() =>
      validarPuedeAprobar(admin, inventario('conteo_cerrado'), [{ aprobadorId: 12 }, { aprobadorId: 30 }]),
    ).toThrow(/listo para lacrar/);
  });

  it('a un coordinador de SU PROPIA tienda no se le echa la culpa a la sucursal', () => {
    // Antes decia "solo podes consultar el historico de tu propia sucursal"
    // — falso: ES su sucursal. El problema es el rol, y mandarlo a mirar la
    // tienda lo deja dando vueltas.
    expect(() => validarPuedeAprobar(coordinador, inventario('conteo_cerrado'), [])).not.toThrow(
      /tu propia sucursal/,
    );
    expect(() => validarPuedeAprobar(coordinador, inventario('conteo_cerrado'), [])).toThrow(
      /auditor y el administrador/,
    );
  });

  it('y a uno de OTRA tienda si se le dice que es la tienda', () => {
    expect(() => validarPuedeAprobar(auditorOtraTienda, inventario('conteo_cerrado'), [])).toThrow(/otra tienda/);
  });

  it('aprobar con el conteo abierto no filtra el enum', () => {
    expect(() => validarPuedeAprobar(admin, inventario('en_curso'), [])).not.toThrow(/en_curso/);
    expect(() => validarPuedeAprobar(admin, inventario('en_curso'), [])).toThrow(/cerrar la ultima ronda/);
  });

  it('no se agrega una tercera firma sobre un par ya completo', () => {
    expect(() =>
      validarPuedeAprobar(admin, inventario('conteo_cerrado'), [{ aprobadorId: 12 }, { aprobadorId: 30 }]),
    ).toThrow(Conflicto);
  });
});

describe('validarPuedeLacrar', () => {
  // `hojasSinFinalizar: []` = todas cerradas. Es la condicion para lacrar, y
  // es DISTINTA de `todoSincronizado`: ver el comentario del tipo.
  const listo = {
    sucursalId: 1,
    estado: 'liquidado' as EstadoInventario,
    yaLacrado: false,
    todoSincronizado: true,
    hojasSinFinalizar: [],
  };
  const dosFirmas = [{ aprobadorId: 12 }, { aprobadorId: 30 }];

  it('con dos firmas de personas distintas se puede lacrar', () => {
    expect(() => validarPuedeLacrar(gilmer, listo, dosFirmas)).not.toThrow();
  });

  it('SIN DOS APROBACIONES NO SE LACRA', () => {
    expect(() => validarPuedeLacrar(gilmer, listo, [{ aprobadorId: 12 }])).toThrow(Conflicto);
  });

  it('sin ninguna aprobacion tampoco', () => {
    expect(() => validarPuedeLacrar(gilmer, listo, [])).toThrow(Conflicto);
  });

  it('dos firmas de LA MISMA persona no valen como par', () => {
    // Cinturon y tiradores: la base ya lo impide con
    // @@unique([inventarioId, aprobadorId]), pero esta es la ultima puerta
    // antes de un cierre irreversible y no confia en que el indice este.
    expect(() => validarPuedeLacrar(gilmer, listo, [{ aprobadorId: 12 }, { aprobadorId: 12 }])).toThrow(Conflicto);
  });

  it('el mensaje dice cuantas firmas distintas hay', () => {
    expect(() => validarPuedeLacrar(gilmer, listo, [{ aprobadorId: 12 }])).toThrow(/hay 1/);
  });

  // -------------------------------------------------------------------------
  // Hojas sin finalizar: el hueco que permitia lacrar un inventario a medio
  // contar. `sync` y `estado` son cosas distintas.
  // -------------------------------------------------------------------------

  it('NO SE LACRA con una hoja pendiente, aunque este todo sincronizado', () => {
    const conPendiente = {
      ...listo,
      todoSincronizado: true,
      hojasSinFinalizar: [{ numero: '007', estado: 'pendiente', asignados: ['Maria Rojas'] }],
    };
    expect(() => validarPuedeLacrar(gilmer, conPendiente, dosFirmas)).toThrow(Conflicto);
  });

  it('tampoco con una hoja en-proceso: sincronizada no es lo mismo que terminada', () => {
    // 12 de 50 items contados y subidos al servidor. El backend la ve al dia;
    // la gondola no.
    const enProceso = {
      ...listo,
      hojasSinFinalizar: [{ numero: '012', estado: 'en-proceso', asignados: ['Ana Perez'] }],
    };
    expect(() => validarPuedeLacrar(gilmer, enProceso, dosFirmas)).toThrow(Conflicto);
  });

  it('el error dice CUANTAS y CUALES, con numero y asignado', () => {
    // Un "no se puede lacrar" pelado obliga a buscar cual de 25 hojas falta.
    const dos = {
      ...listo,
      hojasSinFinalizar: [
        { numero: '007', estado: 'pendiente', asignados: ['Maria Rojas'] },
        { numero: '012', estado: 'en-proceso', asignados: ['Ana Perez', 'Luis Shuan'] },
      ],
    };
    expect(() => validarPuedeLacrar(gilmer, dos, dosFirmas)).toThrow(/2 hojas siguen sin finalizar/);
    expect(() => validarPuedeLacrar(gilmer, dos, dosFirmas)).toThrow(/#007 \(pendiente, Maria Rojas\)/);
    expect(() => validarPuedeLacrar(gilmer, dos, dosFirmas)).toThrow(/#012 \(en-proceso, Ana Perez y Luis Shuan\)/);
  });

  it('una hoja sin asignar tambien se nombra: hay que ir a cerrarla igual', () => {
    const huerfana = { ...listo, hojasSinFinalizar: [{ numero: '003', estado: 'pendiente', asignados: [] }] };
    expect(() => validarPuedeLacrar(gilmer, huerfana, dosFirmas)).toThrow(/#003 \(pendiente, sin asignar\)/);
  });

  it('las hojas sin finalizar se avisan ANTES que la sincronizacion', () => {
    // Una hoja sin cerrar NO se arregla sola esperando la WiFi: hay que ir a
    // la gondola. Es lo primero que la persona tiene que saber.
    const ambas = {
      ...listo,
      todoSincronizado: false,
      hojasSinFinalizar: [{ numero: '007', estado: 'pendiente', asignados: ['Maria Rojas'] }],
    };
    expect(() => validarPuedeLacrar(gilmer, ambas, dosFirmas)).toThrow(/sin finalizar/);
  });

  it('CON TODAS FINALIZADAS si se lacra', () => {
    expect(() => validarPuedeLacrar(gilmer, { ...listo, hojasSinFinalizar: [] }, dosFirmas)).not.toThrow();
  });

  it('un inventario SIN NINGUNA hoja pasa este chequeo, y es a proposito', () => {
    // DECISION: "cero hojas" y "hojas sin terminar" son problemas distintos y
    // este chequeo resuelve el segundo. Bloquear el primero aca seria poner
    // el control de "conto algo?" en el lugar equivocado.
    //
    // Ademas ya esta cubierto: ESTADOS_APROBABLES solo deja lacrar un
    // inventario `conteo_cerrado` o `liquidado`, asi que uno recien creado y
    // vacio (`en_curso`) no llega ni a este punto. Para tener 0 hojas Y estar
    // cerrado, alguien tuvo que cerrar explicitamente un ciclo sin hojas --
    // y eso lo tiene que impedir quien cierra el conteo, no el lacrado.
    expect(() => validarPuedeLacrar(gilmer, listo, dosFirmas)).not.toThrow();
    expect(() =>
      validarPuedeLacrar(gilmer, { ...listo, estado: 'en_curso' as EstadoInventario }, dosFirmas),
    ).toThrow(Conflicto);
  });

  // -------------------------------------------------------------------------
  // El TEXTO del rechazo. Un mensaje que no dice que hacer obliga a adivinar,
  // y la persona esta parada frente al inventario del mes.
  // -------------------------------------------------------------------------

  it('no filtra el enum de la base a la pantalla', () => {
    // "en_curso" es un valor de Postgres, no algo accionable.
    const enCurso = { ...listo, estado: 'en_curso' as EstadoInventario };
    expect(() => validarPuedeLacrar(gilmer, enCurso, dosFirmas)).not.toThrow(/en_curso/);
    expect(() => validarPuedeLacrar(gilmer, enCurso, dosFirmas)).toThrow(/cerrar las 3 rondas/);
  });

  it('el rechazo a un coordinador dice QUIEN si puede, no que sea otra tienda', () => {
    expect(() => validarPuedeLacrar(coordinador, listo, dosFirmas)).not.toThrow(/tu propia sucursal/);
    expect(() => validarPuedeLacrar(coordinador, listo, dosFirmas)).toThrow(/auditor y el administrador/);
  });

  it('un lacrado repetido dice donde entra el ajuste', () => {
    expect(() => validarPuedeLacrar(gilmer, { ...listo, yaLacrado: true }, dosFirmas)).toThrow(/mes siguiente/);
  });

  it('distingue "faltan hojas por finalizar" de "hay hojas sin sincronizar"', () => {
    // Se parecen y piden acciones OPUESTAS: una es ir a la gondola a contar,
    // la otra es conectar el telefono al WiFi. Confundirlas manda a la
    // persona al lugar equivocado.
    const sinFinalizar = {
      ...listo,
      hojasSinFinalizar: [{ numero: '007', estado: 'pendiente', asignados: ['Maria Rojas'] }],
    };
    expect(() => validarPuedeLacrar(gilmer, sinFinalizar, dosFirmas)).toThrow(/sin finalizar/);
    expect(() => validarPuedeLacrar(gilmer, sinFinalizar, dosFirmas)).not.toThrow(/sincroniz/);

    const sinSync = { ...listo, todoSincronizado: false };
    expect(() => validarPuedeLacrar(gilmer, sinSync, dosFirmas)).toThrow(/sincronizar/);
    expect(() => validarPuedeLacrar(gilmer, sinSync, dosFirmas)).not.toThrow(/sin finalizar/);
  });

  it('un inventario ya lacrado no se vuelve a lacrar', () => {
    expect(() => validarPuedeLacrar(gilmer, { ...listo, yaLacrado: true }, dosFirmas)).toThrow(Conflicto);
  });

  it('un inventario todavia en curso no se lacra ni con dos firmas', () => {
    expect(() => validarPuedeLacrar(gilmer, { ...listo, estado: 'en_curso' }, dosFirmas)).toThrow(Conflicto);
  });

  it('un auditor de otra tienda no lacra este inventario', () => {
    expect(() => validarPuedeLacrar(auditorOtraTienda, listo, dosFirmas)).toThrow(Prohibido);
  });

  it('un contador no lacra', () => {
    expect(() => validarPuedeLacrar(contador, listo, dosFirmas)).toThrow(Prohibido);
  });

  it('NO SE LACRA con hojas todavia sin sincronizar', () => {
    // "No se puede lacrar con datos que no llegaron a Dynamics" -- el sello
    // es inmutable, asi que un conteo que no subio a tiempo ya no entra nunca.
    expect(() => validarPuedeLacrar(gilmer, { ...listo, todoSincronizado: false }, dosFirmas)).toThrow(Conflicto);
  });

  it('el mensaje de sincronizacion dice que se puede reintentar, no que fallo algo', () => {
    expect(() => validarPuedeLacrar(gilmer, { ...listo, todoSincronizado: false }, dosFirmas)).toThrow(
      /volvé a intentar/i,
    );
  });

  it('la falta de aprobaciones se reporta ANTES que la sincronizacion', () => {
    // Prioridad deliberada: la sincronizacion se resuelve sola esperando la
    // WiFi; las firmas no. Primero se le dice a la persona lo que SI tiene
    // que ir a hacer.
    expect(() =>
      validarPuedeLacrar(gilmer, { ...listo, todoSincronizado: false }, [{ aprobadorId: 12 }]),
    ).toThrow(/Faltan aprobaciones/);
  });
});

describe('validarPeriodo', () => {
  it('acepta un mes calendario valido', () => {
    expect(() => validarPeriodo(2026, 8)).not.toThrow();
  });

  it('rechaza el mes 0 y el 13', () => {
    expect(() => validarPeriodo(2026, 0)).toThrow(SolicitudInvalida);
    expect(() => validarPeriodo(2026, 13)).toThrow(SolicitudInvalida);
  });

  it('rechaza anios fuera de rango y no enteros', () => {
    expect(() => validarPeriodo(1999, 8)).toThrow(SolicitudInvalida);
    expect(() => validarPeriodo(2026.5, 8)).toThrow(SolicitudInvalida);
  });
});
