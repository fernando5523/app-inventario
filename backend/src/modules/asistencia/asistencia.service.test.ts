/**
 * Lo que se escribe acá se cobra: la multa por inasistencia sale de estas
 * marcas y se descuenta del sueldo. Los tests cuidan las tres formas de
 * equivocarse que cuestan plata -- marcar a quien no corresponde, marcar un
 * día corrido por el huso horario, y tocar la asistencia después del cierre.
 *
 * Prisma mockeado, sin base (igual que el resto de la suite).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  inventario: { findUnique: vi.fn() },
  colaborador: { findMany: vi.fn(), findFirst: vi.fn() },
  asistenciaInventario: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  justificacionAsistencia: { findMany: vi.fn(), createMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../config/database', () => ({ prisma: prismaMock }));

const registrarAuditoriaMock = vi.hoisted(() => vi.fn());
vi.mock('../../shared/auditoria', () => ({ registrarAuditoria: registrarAuditoriaMock }));

import { Conflicto, NoEncontrado, Prohibido, SolicitudInvalida } from '../../shared/errores';
import type { ColaboradorAutenticado } from '../../shared/tipos';
import { borrar, justificar, listar, marcar, quitarJustificacion } from './asistencia.service';

const BOLIVAR = 1;
const INVENTARIO = 8021;

const oscar: ColaboradorAutenticado = { colaboradorId: 101, sucursalId: BOLIVAR, rol: 'coordinador' };
const gilmer: ColaboradorAutenticado = { colaboradorId: 103, sucursalId: null, rol: 'auditor' };
const deSucre: ColaboradorAutenticado = { colaboradorId: 201, sucursalId: 2, rol: 'coordinador' };

const SILVIA = { id: 102, nombre: 'Silvia Huerta', rol: 'conteo' as const };
const DELIA = { id: 104, nombre: 'Delia Ramos', rol: 'conteo' as const };

function fila(colaboradorId: number, dia: string, hora = '13:45:12') {
  return {
    colaboradorId,
    // Así devuelve Prisma una columna `@db.Date`: medianoche UTC.
    dia: new Date(`${dia}T00:00:00.000Z`),
    registradoEn: new Date(`${dia}T${hora}.000Z`),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.inventario.findUnique.mockResolvedValue({ id: INVENTARIO, sucursalId: BOLIVAR, estado: 'en_curso' });
  prismaMock.asistenciaInventario.findMany.mockResolvedValue([]);
  prismaMock.justificacionAsistencia.findMany.mockResolvedValue([]);
  prismaMock.justificacionAsistencia.createMany.mockResolvedValue({ count: 1 });
  prismaMock.justificacionAsistencia.findUnique.mockResolvedValue(null);
  prismaMock.justificacionAsistencia.delete.mockResolvedValue({});
  prismaMock.asistenciaInventario.createMany.mockResolvedValue({ count: 1 });
  prismaMock.asistenciaInventario.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.colaborador.findMany.mockResolvedValue([SILVIA, DELIA]);
  prismaMock.colaborador.findFirst.mockResolvedValue(SILVIA);
});

describe('listar', () => {
  it('un inventario que no existe es 404, no una lista vacía', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue(null);
    await expect(listar(oscar, INVENTARIO)).rejects.toThrow(NoEncontrado);
  });

  it('el coordinador de otra tienda no ve esta lista', async () => {
    await expect(listar(deSucre, INVENTARIO)).rejects.toThrow(Prohibido);
  });

  it('una lista vacía es una lista vacía, no un error: el día 1 nadie marcó todavía', async () => {
    const asistencia = await listar(oscar, INVENTARIO);
    expect(asistencia).toEqual({ dias: [], marcas: [], justificaciones: [], personal: [SILVIA, DELIA] });
  });

  /**
   * `dias` son los días DISTINTOS con al menos una marca -- la duración del
   * inventario (`dominio/asistencia.ts#diasDelInventario`). Dos personas el
   * mismo día son UN día, no dos: si se contaran las marcas, un inventario de
   * 3 días con 11 personas "duraría" 33 y la multa de quien faltó un día se
   * multiplicaría por diez.
   */
  it('dias son los días distintos, ordenados, no la cantidad de marcas', async () => {
    prismaMock.asistenciaInventario.findMany.mockResolvedValue([
      fila(SILVIA.id, '2026-09-16'),
      fila(DELIA.id, '2026-09-16'),
      fila(SILVIA.id, '2026-09-17'),
      fila(SILVIA.id, '2026-09-18'),
    ]);
    const { dias } = await listar(oscar, INVENTARIO);
    expect(dias).toEqual(['2026-09-16', '2026-09-17', '2026-09-18']);
  });

  /**
   * EL DIA NO SE PUEDE CORRER. Prisma devuelve la columna `@db.Date` como
   * medianoche UTC; formatearla en hora local (Lima, UTC−5) daría el día
   * anterior. Todas las marcas se moverían un día atrás y podrían duplicar los
   * días del inventario -- alguien pagaría multa por un día que no existió.
   */
  it('el día sale tal cual se guardó, sin correrse por el huso horario', async () => {
    prismaMock.asistenciaInventario.findMany.mockResolvedValue([fila(SILVIA.id, '2026-09-18', '02:30:00')]);
    const { marcas } = await listar(oscar, INVENTARIO);
    expect(marcas).toEqual([
      { colaboradorId: SILVIA.id, dia: '2026-09-18', registradoEn: '2026-09-18T02:30:00.000Z' },
    ]);
  });

  /**
   * El personal incluye a quien YA TIENE una marca aunque lo hayan dado de
   * baja a mitad de mes: sin eso la pantalla recibiría una marca de un id que
   * no está en la lista y no tendría con qué escribir el nombre.
   */
  it('pide al personal activo de la tienda MAS cualquiera que ya tenga una marca', async () => {
    prismaMock.asistenciaInventario.findMany.mockResolvedValue([fila(DELIA.id, '2026-09-16')]);
    await listar(oscar, INVENTARIO);
    expect(prismaMock.colaborador.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { sucursalId: BOLIVAR, activo: true, rol: { in: ['coordinador', 'conteo'] } },
            { id: { in: [DELIA.id] } },
          ],
        },
      }),
    );
  });
});

describe('marcar', () => {
  it('guarda el día a medianoche UTC y deja constancia de quién lo marcó', async () => {
    await marcar(oscar, INVENTARIO, SILVIA.id, '2026-09-18');
    expect(prismaMock.asistenciaInventario.createMany).toHaveBeenCalledWith({
      data: {
        inventarioId: INVENTARIO,
        colaboradorId: SILVIA.id,
        dia: new Date('2026-09-18T00:00:00.000Z'),
        registradoPorId: oscar.colaboradorId,
      },
      skipDuplicates: true,
    });
  });

  it('creada=true y queda en el log de auditoría', async () => {
    const { creada } = await marcar(oscar, INVENTARIO, SILVIA.id, '2026-09-18');
    expect(creada).toBe(true);
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: oscar.colaboradorId,
        accion: 'inventario.asistencia_marcada',
        entidadId: INVENTARIO,
        detalle: { colaboradorId: SILVIA.id, persona: SILVIA.nombre, dia: '2026-09-18' },
      }),
    );
  });

  /**
   * IDEMPOTENTE: el doble toque en la pantalla no falla ni duplica -- lo corta
   * el `@@unique` vía `skipDuplicates`. Y no se audita: un log que dice "marcó
   * asistencia" cuando no pasó nada es ruido al investigar un reclamo.
   */
  it('marcar dos veces lo mismo no falla, devuelve creada=false y no audita', async () => {
    prismaMock.asistenciaInventario.createMany.mockResolvedValue({ count: 0 });
    const { creada } = await marcar(oscar, INVENTARIO, SILVIA.id, '2026-09-18');
    expect(creada).toBe(false);
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  /**
   * Una marca a alguien que no es personal activo de esta tienda no es una
   * fila de más: los días del inventario son los días distintos con alguna
   * marca, así que un día que nadie trabajó le suma una tarifa de multa a los
   * once que sí fueron.
   */
  it('rechaza a quien no es personal activo de esta tienda, y no escribe nada', async () => {
    prismaMock.colaborador.findFirst.mockResolvedValue(null);
    await expect(marcar(oscar, INVENTARIO, 999, '2026-09-18')).rejects.toThrow(SolicitudInvalida);
    expect(prismaMock.asistenciaInventario.createMany).not.toHaveBeenCalled();
  });

  it('exige activo, sucursal del inventario y rol de tienda', async () => {
    await marcar(oscar, INVENTARIO, SILVIA.id, '2026-09-18');
    expect(prismaMock.colaborador.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: SILVIA.id,
          activo: true,
          sucursalId: BOLIVAR,
          rol: { in: ['coordinador', 'conteo'] },
        },
      }),
    );
  });

  /**
   * Con el conteo cerrado, `ResultadoInventario.diasDelInventario` ya quedó
   * congelado: una marca posterior caería en un día que ese número no cuenta y
   * la planilla dejaría de coincidir con el detalle que la respalda.
   */
  it('con el conteo cerrado, 409 y no escribe nada', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: INVENTARIO, sucursalId: BOLIVAR, estado: 'conteo_cerrado' });
    await expect(marcar(oscar, INVENTARIO, SILVIA.id, '2026-09-18')).rejects.toThrow(Conflicto);
    expect(prismaMock.asistenciaInventario.createMany).not.toHaveBeenCalled();
  });

  it('el coordinador de otra tienda no marca acá', async () => {
    await expect(marcar(deSucre, INVENTARIO, SILVIA.id, '2026-09-18')).rejects.toThrow(Prohibido);
    expect(prismaMock.asistenciaInventario.createMany).not.toHaveBeenCalled();
  });
});

describe('borrar', () => {
  it('borra SOLO la marca de esa persona ESE día, no su asistencia entera', async () => {
    await borrar(oscar, INVENTARIO, SILVIA.id, '2026-09-18');
    expect(prismaMock.asistenciaInventario.deleteMany).toHaveBeenCalledWith({
      where: {
        inventarioId: INVENTARIO,
        colaboradorId: SILVIA.id,
        dia: new Date('2026-09-18T00:00:00.000Z'),
      },
    });
  });

  it('queda en el log de auditoría: sacar una marca le pone multa a alguien', async () => {
    await borrar(oscar, INVENTARIO, SILVIA.id, '2026-09-18');
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'inventario.asistencia_borrada',
        detalle: { colaboradorId: SILVIA.id, dia: '2026-09-18' },
      }),
    );
  });

  it('borrar algo que ya no está devuelve el estado actual y no audita', async () => {
    prismaMock.asistenciaInventario.deleteMany.mockResolvedValue({ count: 0 });
    await expect(borrar(oscar, INVENTARIO, SILVIA.id, '2026-09-18')).resolves.toEqual(
      expect.objectContaining({ dias: [], marcas: [] }),
    );
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it('con el conteo cerrado, 409: la asistencia quedó firme', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: INVENTARIO, sucursalId: BOLIVAR, estado: 'liquidado' });
    await expect(borrar(oscar, INVENTARIO, SILVIA.id, '2026-09-18')).rejects.toThrow(Conflicto);
    expect(prismaMock.asistenciaInventario.deleteMany).not.toHaveBeenCalled();
  });
});

/**
 * JUSTIFICAR UNA FALTA. Lo que se escribe acá le BAJA el descuento a una
 * persona y le cambia el bono a todas las demás -- el fondo de multas se
 * reparte entre otra cantidad de gente. Es plata en las dos direcciones.
 */
describe('justificar', () => {
  it('guarda el día a medianoche UTC, con el motivo y quién lo firmó', async () => {
    await justificar(gilmer, INVENTARIO, DELIA.id, '2026-09-18', 'Licencia médica');
    expect(prismaMock.justificacionAsistencia.createMany).toHaveBeenCalledWith({
      data: {
        inventarioId: INVENTARIO,
        colaboradorId: DELIA.id,
        dia: new Date('2026-09-18T00:00:00.000Z'),
        motivo: 'Licencia médica',
        justificadoPorId: gilmer.colaboradorId,
      },
      skipDuplicates: true,
    });
  });

  it('queda en el log: quién, a quién, qué día y por qué', async () => {
    // Los cuatro datos del pedido del cliente. El motivo va al log ADEMÁS de
    // a la fila: la fila se puede dar de baja, el log no.
    prismaMock.colaborador.findFirst.mockResolvedValue(DELIA);

    const { creada } = await justificar(gilmer, INVENTARIO, DELIA.id, '2026-09-18', 'Licencia médica');

    expect(creada).toBe(true);
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: gilmer.colaboradorId,
        accion: 'inventario.falta_justificada',
        entidadId: INVENTARIO,
        detalle: {
          colaboradorId: DELIA.id,
          // El nombre de la persona perdonada, no el de cualquiera: el log
          // tiene que poder leerse sin ir a buscar el id a otra tabla.
          persona: DELIA.nombre,
          dia: '2026-09-18',
          motivo: 'Licencia médica',
        },
      }),
    );
  });

  it('justificar dos veces lo mismo no falla, no duplica y no audita', async () => {
    // Idempotente por el @@unique, igual que `marcar`. Sin esto, dos perdones
    // del mismo día descontarían DOS días de multa por una sola falta.
    prismaMock.justificacionAsistencia.createMany.mockResolvedValue({ count: 0 });
    const { creada } = await justificar(gilmer, INVENTARIO, DELIA.id, '2026-09-18', 'otra vez');
    expect(creada).toBe(false);
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it('el coordinador NO puede: quien pasa lista no perdona faltas', async () => {
    await expect(justificar(oscar, INVENTARIO, DELIA.id, '2026-09-18', 'porque sí')).rejects.toThrow(Prohibido);
    expect(prismaMock.justificacionAsistencia.createMany).not.toHaveBeenCalled();
  });

  it('con la planilla ya liquidada es 409: ese descuento ya salió en un recibo', async () => {
    prismaMock.inventario.findUnique.mockResolvedValue({ id: INVENTARIO, sucursalId: BOLIVAR, estado: 'liquidado' });
    await expect(justificar(gilmer, INVENTARIO, DELIA.id, '2026-09-18', 'tarde')).rejects.toThrow(Conflicto);
    expect(prismaMock.justificacionAsistencia.createMany).not.toHaveBeenCalled();
  });

  /**
   * NO se exige `activo`, a diferencia de `marcar`: a alguien dado de baja a
   * mitad de mes se le liquida igual el inventario que trabajó, así que
   * también se le tiene que poder perdonar una falta de esos días.
   */
  it('no exige que la persona siga activa: a quien se fue se le liquida igual', async () => {
    await justificar(gilmer, INVENTARIO, DELIA.id, '2026-09-18', 'Licencia');
    expect(prismaMock.colaborador.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: DELIA.id, sucursalId: BOLIVAR, rol: { in: ['coordinador', 'conteo'] } },
      }),
    );
  });

  it('rechaza a quien no es personal de esta tienda, y no escribe nada', async () => {
    // Perdonarle una falta a alguien que no entra a la planilla es una fila
    // que no le cambia la multa a nadie y que después nadie entiende.
    prismaMock.colaborador.findFirst.mockResolvedValue(null);
    await expect(justificar(gilmer, INVENTARIO, 9999, '2026-09-18', 'Licencia')).rejects.toThrow(SolicitudInvalida);
    expect(prismaMock.justificacionAsistencia.createMany).not.toHaveBeenCalled();
  });
});

describe('quitarJustificacion', () => {
  it('da de baja el perdón de ESE día y deja en el log qué se levantó', async () => {
    prismaMock.justificacionAsistencia.findUnique.mockResolvedValue({
      motivo: 'Licencia médica',
      justificadoPorId: 777,
    });

    await quitarJustificacion(gilmer, INVENTARIO, DELIA.id, '2026-09-18');

    expect(prismaMock.justificacionAsistencia.delete).toHaveBeenCalledWith({
      where: {
        inventarioId_colaboradorId_dia: {
          inventarioId: INVENTARIO,
          colaboradorId: DELIA.id,
          dia: new Date('2026-09-18T00:00:00.000Z'),
        },
      },
    });
    // El motivo ORIGINAL y quién lo había firmado: es la información que hace
    // falta cuando alguien pregunta por qué le volvieron a descontar. Y quien
    // da de baja puede no ser el mismo auditor que firmó el perdón.
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: gilmer.colaboradorId,
        accion: 'inventario.justificacion_quitada',
        detalle: {
          colaboradorId: DELIA.id,
          dia: '2026-09-18',
          motivo: 'Licencia médica',
          justificadoPorId: 777,
        },
      }),
    );
  });

  it('dar de baja algo que ya no está no es un 404 ni audita: es idempotente', async () => {
    prismaMock.justificacionAsistencia.findUnique.mockResolvedValue(null);
    await expect(quitarJustificacion(gilmer, INVENTARIO, DELIA.id, '2026-09-18')).resolves.toBeDefined();
    expect(prismaMock.justificacionAsistencia.delete).not.toHaveBeenCalled();
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it('el coordinador tampoco da de baja un perdón', async () => {
    await expect(quitarJustificacion(oscar, INVENTARIO, DELIA.id, '2026-09-18')).rejects.toThrow(Prohibido);
  });
});

describe('listar con justificaciones', () => {
  it('las devuelve APARTE de las marcas, con su motivo', async () => {
    prismaMock.justificacionAsistencia.findMany.mockResolvedValue([
      {
        colaboradorId: DELIA.id,
        dia: new Date('2026-09-17T00:00:00.000Z'),
        motivo: 'Licencia médica',
        justificadoEn: new Date('2026-09-19T10:00:00.000Z'),
        justificadoPorId: gilmer.colaboradorId,
      },
    ]);

    const { justificaciones } = await listar(oscar, INVENTARIO);
    expect(justificaciones).toEqual([
      {
        colaboradorId: DELIA.id,
        dia: '2026-09-17',
        motivo: 'Licencia médica',
        justificadoEn: '2026-09-19T10:00:00.000Z',
        justificadoPorId: gilmer.colaboradorId,
      },
    ]);
  });

  /**
   * EL DIA JUSTIFICADO NO ES UN DIA DEL INVENTARIO. Un día que nadie trabajó
   * no se convierte en jornada porque a alguien le perdonen la falta -- y si
   * entrara en `dias`, cada perdón le sumaría un día al denominador y una
   * tarifa de multa a TODOS los demás. Sería lo contrario de lo que el perdón
   * intenta hacer.
   */
  it('una justificación NO agrega un día al inventario', async () => {
    prismaMock.asistenciaInventario.findMany.mockResolvedValue([fila(SILVIA.id, '2026-09-16')]);
    prismaMock.justificacionAsistencia.findMany.mockResolvedValue([
      {
        colaboradorId: DELIA.id,
        dia: new Date('2026-09-17T00:00:00.000Z'),
        motivo: 'Licencia',
        justificadoEn: new Date('2026-09-19T10:00:00.000Z'),
        justificadoPorId: gilmer.colaboradorId,
      },
    ]);

    const { dias } = await listar(oscar, INVENTARIO);
    expect(dias).toEqual(['2026-09-16']);
  });

  it('el personal incluye a quien sólo tiene un perdón, para poder escribir su nombre', async () => {
    prismaMock.justificacionAsistencia.findMany.mockResolvedValue([
      {
        colaboradorId: DELIA.id,
        dia: new Date('2026-09-17T00:00:00.000Z'),
        motivo: 'Licencia',
        justificadoEn: new Date('2026-09-19T10:00:00.000Z'),
        justificadoPorId: gilmer.colaboradorId,
      },
    ]);

    await listar(oscar, INVENTARIO);
    expect(prismaMock.colaborador.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { sucursalId: BOLIVAR, activo: true, rol: { in: ['coordinador', 'conteo'] } },
            { id: { in: [DELIA.id] } },
          ],
        },
      }),
    );
  });
});
