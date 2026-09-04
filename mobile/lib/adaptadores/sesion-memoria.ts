/**
 * Adaptador en memoria de RepositorioSesion.
 *
 * Es a propósito que viva en memoria: el backend existe pero todavía no se
 * conectó. La pantalla de login habla solo con el puerto (RepositorioSesion),
 * nunca con este archivo directamente — cuando se enchufe HTTP, se cambia
 * este archivo por uno nuevo y no se toca una sola línea de la pantalla.
 *
 * Los datos (sucursales, colaboradores, roles) son los mismos de
 * mobile/design/login.html, la maqueta ya validada por el cliente — no son
 * inventados para este adaptador.
 */

import type { Colaborador, Sesion, Sucursal } from '../dominio/tipos';
import type { RepositorioSesion } from '../puertos/repositorios';

const SUCURSALES: Sucursal[] = [
  { id: 1, nombre: 'Market Central Luzuriaga', colaboradores: 11 },
  { id: 2, nombre: 'Market Carhuaz', colaboradores: 6 },
  { id: 3, nombre: 'Market Bolívar', colaboradores: 7 },
  { id: 4, nombre: 'Market Sucre', colaboradores: 5 },
];

/**
 * Mismo id/nombre/dni que backend/prisma/seed.ts#ADMINISTRADOR — misma
 * persona vista desde las dos fuentes (mobile en memoria y el seed real
 * del backend), no dos administradores inventados por separado. El DNI
 * de 8 dígitos (no 4, como el resto del padrón mobile) es a propósito:
 * el seed del backend ya lo eligió así porque "un DNI real peruano tiene
 * 8" (backend/README.md) — se sigue esa convención acá en vez de crear
 * una tercera.
 */
const ADMINISTRADORES: Colaborador[] = [{ id: 1000, nombre: 'Admin Sistema', dni: '00000001', rol: 'administrador' }];

/** id = sucursalId * 100 + posición en el padrón (1-indexado). */
const COLABORADORES: Record<number, Colaborador[]> = {
  1: [
    { id: 101, nombre: 'José Tarazona', dni: '1256', rol: 'coordinador' },
    { id: 102, nombre: 'María Rojas', dni: '8890', rol: 'conteo' },
    { id: 103, nombre: 'Gilmer Quispe', dni: '3421', rol: 'auditor' },
    { id: 104, nombre: 'Elena Príncipe', dni: '7714', rol: 'conteo' },
    { id: 105, nombre: 'Walter Norabuena', dni: '2038', rol: 'conteo' },
    { id: 106, nombre: 'Rosa Melgarejo', dni: '5567', rol: 'auditor' },
    { id: 107, nombre: 'Luis Shuan', dni: '9102', rol: 'conteo' },
    { id: 108, nombre: 'Carla Depaz', dni: '4483', rol: 'conteo' },
    { id: 109, nombre: 'Manuel Chávez', dni: '6017', rol: 'conteo' },
    { id: 110, nombre: 'Yeni Sotelo', dni: '3390', rol: 'conteo' },
    { id: 111, nombre: 'Hugo Vergaray', dni: '8845', rol: 'conteo' },
  ],
  2: [
    { id: 201, nombre: 'Ana Villanueva', dni: '4410', rol: 'coordinador' },
    { id: 202, nombre: 'Pedro Cochachin', dni: '6689', rol: 'conteo' },
    { id: 203, nombre: 'Nilda Ramírez', dni: '1174', rol: 'auditor' },
    { id: 204, nombre: 'Julio Espinoza', dni: '5528', rol: 'conteo' },
    { id: 205, nombre: 'Betty Salazar', dni: '9063', rol: 'conteo' },
    { id: 206, nombre: 'Raúl Colonia', dni: '2295', rol: 'conteo' },
  ],
  3: [
    { id: 301, nombre: 'Óscar Maguiña', dni: '3391', rol: 'coordinador' },
    { id: 302, nombre: 'Silvia Huerta', dni: '8021', rol: 'conteo' },
    { id: 303, nombre: 'Jorge Alvarado', dni: '5543', rol: 'auditor' },
    { id: 304, nombre: 'Delia Ocaña', dni: '7716', rol: 'conteo' },
    { id: 305, nombre: 'Marco Zarzosa', dni: '1108', rol: 'conteo' },
    { id: 306, nombre: 'Pilar Antúnez', dni: '6634', rol: 'conteo' },
    { id: 307, nombre: 'Iván Loli', dni: '2280', rol: 'conteo' },
  ],
  4: [
    { id: 401, nombre: 'Carmen Solís', dni: '2287', rol: 'coordinador' },
    { id: 402, nombre: 'Iván Castromonte', dni: '6650', rol: 'conteo' },
    { id: 403, nombre: 'Teresa Bailón', dni: '4419', rol: 'auditor' },
    { id: 404, nombre: 'Fredy Minaya', dni: '9971', rol: 'conteo' },
    { id: 405, nombre: 'Nancy Chinchay', dni: '3302', rol: 'conteo' },
  ],
};

const LARGO_PIN = 6;
const DURACION_SESION_MS = 12 * 60 * 60 * 1000; // 12 horas

function buscarColaborador(colaboradorId: number): { colaborador: Colaborador; sucursal: Sucursal | null } | null {
  const administrador = ADMINISTRADORES.find((a) => a.id === colaboradorId);
  // sucursal: null de verdad (no una "sucursal de sistema" inventada) —
  // mismo contrato que sesion.service.ts#SesionDto del backend.
  if (administrador) return { colaborador: administrador, sucursal: null };
  for (const sucursal of SUCURSALES) {
    const colaborador = COLABORADORES[sucursal.id]?.find((c) => c.id === colaboradorId);
    if (colaborador) return { colaborador, sucursal };
  }
  return null;
}

let sesionActual: Sesion | null = null;

export const sesionMemoria: RepositorioSesion = {
  async sucursales() {
    return SUCURSALES;
  },

  async colaboradores(sucursalId) {
    // El Administrador no cuelga de ninguna sucursal, así que "elegí
    // primero la sucursal" no puede dejarlo invisible — aparece en la
    // lista de personas de LAS 4, sin importar cuál se eligió (decisión
    // 2026-09-03; ver ingresar() para cómo se resuelve su sesión.sucursal
    // real independientemente de cuál se haya elegido acá).
    return [...(COLABORADORES[sucursalId] ?? []), ...ADMINISTRADORES];
  },

  async ingresar(colaboradorId, pin) {
    const encontrado = buscarColaborador(colaboradorId);
    if (!encontrado) throw new Error('Colaborador no encontrado.');
    if (pin.length !== LARGO_PIN) throw new Error(`El PIN debe tener ${LARGO_PIN} dígitos.`);
    // No hay backend todavía: el PIN vive en la base de datos de la app
    // (decisión del cliente), pero esa base no existe aún — este adaptador
    // acepta cualquier PIN de 6 dígitos. La validación real llega con el
    // adaptador HTTP.
    const sesion: Sesion = {
      colaborador: encontrado.colaborador,
      sucursal: encontrado.sucursal,
      token: `demo-${encontrado.colaborador.id}-${Date.now()}`,
      expiraEn: new Date(Date.now() + DURACION_SESION_MS).toISOString(),
    };
    sesionActual = sesion;
    return sesion;
  },

  async sesionActiva() {
    return sesionActual;
  },

  async cerrar() {
    sesionActual = null;
  },
};
