import { describe, expect, it } from 'vitest';

import { servidorALaVista } from './servidor-a-la-vista';

describe('qué servidor se muestra en el pie del login', () => {
  /** El caso del piloto: el APK compilado contra la PC de la oficina. */
  it('muestra host y puerto, sin el esquema', () => {
    expect(servidorALaVista('http://10.5.21.144:3000')).toBe('10.5.21.144:3000');
  });

  /** El caso del emulador, que es el que más confunde al repartir APKs. */
  it('distingue el alias del emulador', () => {
    expect(servidorALaVista('http://10.0.2.2:3000')).toBe('10.0.2.2:3000');
  });

  /** En la nube el puerto no se escribe, y agregar ":443" sería ruido. */
  it('sin puerto explícito muestra solo el host', () => {
    expect(servidorALaVista('https://inventario.ejemplo.com')).toBe('inventario.ejemplo.com');
  });

  /**
   * La web del Auditor se compila con dirección relativa porque la sirve el
   * mismo backend. Inventar un host ahí sería afirmar algo falso.
   */
  it('con dirección relativa dice que es el mismo servidor de la página', () => {
    expect(servidorALaVista('/')).toBe('mismo servidor de esta página');
    expect(servidorALaVista('')).toBe('mismo servidor de esta página');
    expect(servidorALaVista('   ')).toBe('mismo servidor de esta página');
  });

  /**
   * Una dirección mal escrita se MUESTRA, no se esconde: verla rara es lo que
   * hace notar que el APK se compiló mal.
   */
  it('una dirección inválida se muestra tal cual en vez de tragarse el error', () => {
    expect(servidorALaVista('esto-no-es-una-url')).toBe('esto-no-es-una-url');
  });
});
