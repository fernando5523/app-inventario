/**
 * Lo único que este adaptador no puede hacer es dejar la app sin home. Estos
 * tests cubren cada forma en que la configuración puede no llegar —sin señal,
 * backend caído, respuesta con la forma equivocada— y afirman que en todas se
 * cae en el mapa compilado.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const pedirMock = vi.hoisted(() => vi.fn());
vi.mock('./_http', () => ({ pedir: pedirMock }));

/**
 * `tabs.ts` importa `lucide-react-native` directo, que no parsea bajo vitest
 * (sintaxis Flow). Se mockea con factory ANTES de importar — mismo patrón que
 * `BandaSync.test.ts` y `sincronizador.test.ts`. Los iconos quedan como
 * strings, que es todo lo que estos tests necesitan: lo que se verifica es
 * que a cada tab le llegue EL icono de su `name`, no cuál dibuja.
 */
vi.mock('lucide-react-native', () => ({
  BarChart3: 'BarChart3',
  ClipboardList: 'ClipboardList',
  Home: 'Home',
  Layers: 'Layers',
  LayoutGrid: 'LayoutGrid',
  Settings: 'Settings',
  ShieldCheck: 'ShieldCheck',
  Store: 'Store',
  Users: 'Users',
}));

import { ACCESOS_POR_ROL } from '../../components/navegacion/accesos';
import { TABS_POR_ROL } from '../../components/navegacion/tabs';
import { navegacionDeRespaldo, traerNavegacion, traerNavegacionSiSePuede } from './navegacion-api';

beforeEach(() => vi.clearAllMocks());

describe('traerNavegacion: el camino feliz', () => {
  it('usa lo que manda el servidor, en el orden que lo manda', async () => {
    pedirMock.mockResolvedValue({
      rol: 'conteo',
      accesos: [{ ruta: '/conteo/mi-cuenta', titulo: 'Mi cuenta', sub: 'Cambiar tu PIN' }],
      tabs: [{ name: 'contar', etiqueta: 'Contar' }],
    });

    const nav = await traerNavegacion('conteo');
    expect(nav.esRespaldo).toBe(false);
    expect(nav.accesos.map((a) => a.ruta)).toEqual(['/conteo/mi-cuenta']);
    expect(nav.tabs.map((t) => t.name)).toEqual(['contar']);
  });

  it('le pega el icono a cada tab desde el mapa compilado: no viaja por HTTP', async () => {
    pedirMock.mockResolvedValue({
      rol: 'conteo',
      accesos: [{ ruta: '/conteo/mis-hojas', titulo: 'Mis hojas', sub: '' }],
      tabs: [{ name: 'contar', etiqueta: 'Contar' }],
    });

    const nav = await traerNavegacion('conteo');
    expect(nav.tabs[0]?.icono).toBe(TABS_POR_ROL.conteo.find((t) => t.name === 'contar')?.icono);
  });

  it('descarta un tab cuyo icono no conoce, en vez de romper la barra', async () => {
    pedirMock.mockResolvedValue({
      rol: 'conteo',
      accesos: [{ ruta: '/conteo/mis-hojas', titulo: 'Mis hojas', sub: '' }],
      tabs: [{ name: 'contar', etiqueta: 'Contar' }, { name: 'pantalla-nueva', etiqueta: 'Nueva' }],
    });

    const nav = await traerNavegacion('conteo');
    expect(nav.tabs.map((t) => t.name)).toEqual(['contar']);
  });
});

/**
 * EL RESPALDO. Cada uno de estos casos es una persona parada en la góndola
 * con la app abierta: si alguno devolviera un home vacío, esa persona no
 * puede empezar a contar y el inventario es de un día.
 */
describe('traerNavegacion: cuando la configuración no llega', () => {
  it('sin señal (el pedido falla), devuelve el mapa compilado', async () => {
    pedirMock.mockRejectedValue(new Error('Network request failed'));
    const nav = await traerNavegacion('coordinador');
    expect(nav.esRespaldo).toBe(true);
    expect(nav.accesos).toEqual(ACCESOS_POR_ROL.coordinador);
    expect(nav.tabs).toEqual(TABS_POR_ROL.coordinador);
  });

  it('respuesta con la forma equivocada (un proxy que devuelve HTML), respaldo', async () => {
    pedirMock.mockResolvedValue('<html>502 Bad Gateway</html>');
    expect((await traerNavegacion('auditor')).esRespaldo).toBe(true);
  });

  it('respuesta sin los campos esperados, respaldo', async () => {
    pedirMock.mockResolvedValue({ rol: 'auditor' });
    expect((await traerNavegacion('auditor')).esRespaldo).toBe(true);
  });

  it('null, respaldo', async () => {
    pedirMock.mockResolvedValue(null);
    expect((await traerNavegacion('administrador')).esRespaldo).toBe(true);
  });

  /**
   * El caso más incómodo: el servidor contesta bien, pero con TODO apagado.
   * Es una configuración válida desde el backend y aun así deja a la persona
   * sin por dónde entrar. Se trata como "no llegó".
   */
  it('una configuración que deja el home VACÍO no se aplica: respaldo', async () => {
    pedirMock.mockResolvedValue({ rol: 'conteo', accesos: [], tabs: [] });
    const nav = await traerNavegacion('conteo');
    expect(nav.esRespaldo).toBe(true);
    expect(nav.accesos.length).toBeGreaterThan(0);
  });

  it('con accesos pero sin un solo tab, tampoco: la barra vacía no es usable', async () => {
    pedirMock.mockResolvedValue({
      rol: 'conteo',
      accesos: [{ ruta: '/conteo/mis-hojas', titulo: 'Mis hojas', sub: '' }],
      tabs: [],
    });
    expect((await traerNavegacion('conteo')).esRespaldo).toBe(true);
  });

  it('NUNCA lanza: la pantalla no se puede caer por esto', async () => {
    pedirMock.mockRejectedValue(new Error('lo que sea'));
    await expect(traerNavegacion('conteo')).resolves.toBeDefined();
  });
});

describe('navegacionDeRespaldo', () => {
  it('es exactamente el mapa compilado, para los cuatro roles', () => {
    for (const rol of ['administrador', 'coordinador', 'conteo', 'auditor'] as const) {
      const nav = navegacionDeRespaldo(rol);
      expect(nav.accesos).toEqual(ACCESOS_POR_ROL[rol]);
      expect(nav.tabs).toEqual(TABS_POR_ROL[rol]);
      expect(nav.esRespaldo).toBe(true);
    }
  });
});

/**
 * LAS DOS LECTURAS, Y POR QUE ANTE EL MISMO ERROR TIENEN RESPUESTAS OPUESTAS.
 *
 * `traerNavegacion` es para el ARRANQUE: sin nada en memoria, el respaldo es
 * lo mejor que se puede ofrecer.
 *
 * `traerNavegacionSiSePuede` es para el REFRESCO: ya hay una configuración
 * buena, y caer al mapa de fábrica la pisaría -- si el Administrador apagó un
 * acceso, volver a la app sin señal lo haría reaparecer. Devuelve `null` para
 * que quien refresca no toque nada.
 */
describe('traerNavegacionSiSePuede: dice cuándo NO se pudo', () => {
  it('con una respuesta buena devuelve la configuración', async () => {
    pedirMock.mockResolvedValue({
      rol: 'conteo',
      accesos: [{ ruta: '/conteo/mis-hojas', titulo: 'Mis hojas', sub: '' }],
      tabs: [{ name: 'contar', etiqueta: 'Contar' }],
    });

    const nav = await traerNavegacionSiSePuede('conteo');
    expect(nav?.esRespaldo).toBe(false);
    expect(nav?.accesos.map((a) => a.ruta)).toEqual(['/conteo/mis-hojas']);
  });

  it('sin señal devuelve NULL, no el mapa compilado', async () => {
    // La diferencia que sostiene todo: con el respaldo acá, un refresco sin
    // red pisaría la configuración buena con la de fábrica.
    pedirMock.mockRejectedValue(new Error('Network request failed'));
    expect(await traerNavegacionSiSePuede('coordinador')).toBeNull();
  });

  it('una respuesta con la forma equivocada también es null', async () => {
    pedirMock.mockResolvedValue('<html>502</html>');
    expect(await traerNavegacionSiSePuede('auditor')).toBeNull();
  });

  it('una configuración que deja el home vacío es null: no se puede aplicar', async () => {
    pedirMock.mockResolvedValue({ rol: 'conteo', accesos: [], tabs: [] });
    expect(await traerNavegacionSiSePuede('conteo')).toBeNull();
  });

  it('y `traerNavegacion` sigue cayendo al respaldo en los mismos casos', async () => {
    // El arranque no cambió: esto es lo que evita el home en blanco.
    pedirMock.mockRejectedValue(new Error('Network request failed'));
    const nav = await traerNavegacion('coordinador');
    expect(nav.esRespaldo).toBe(true);
    expect(nav.accesos).toEqual(ACCESOS_POR_ROL.coordinador);
  });
});
