/**
 * PIN de desarrollo de los colaboradores SEMBRADOS, para los scripts de
 * verificacion que inician sesion contra el backend vivo.
 *
 * ES ESPEJO de `prisma/seed.ts#PIN_DEV_POR_ROL`: los mismos cuatro valores,
 * fijos por rol y no derivados del id (ver backend/README.md, seccion "PIN de
 * desarrollo").
 *
 * POR QUE ESTA DUPLICADO en vez de importarse de seed.ts: estos scripts corren
 * con `node` plano, que no carga un .ts; y aunque lo cargara, seed.ts no es un
 * modulo de constantes -- al importarlo ejecuta `main()` y escribe en la base.
 * Para que la copia no se desalinee sin que nadie lo note,
 * `_pin-dev.test.mjs` lee seed.ts como TEXTO y compara los valores.
 *
 * El administrador es la excepcion: una base sembrada antes de que existiera
 * PIN_DEV_POR_ROL lo conserva con "001000" (el `update` del seed no le toca el
 * pinHash), asi que la variable de entorno PIN_ADMIN pisa el valor de la tabla:
 *
 *   PIN_ADMIN=001000 node scripts/verificar-auditoria-api.mjs
 */

export const PIN_DEV_POR_ROL = Object.freeze({
  coordinador: '000020',
  conteo: '000020',
  auditor: '000020',
  administrador: '000020',
});

/**
 * PIN con el que entra un colaborador sembrado de ese rol.
 *
 * Un rol desconocido es un error del script y no se tolera: mandar un PIN
 * inventado suma un intento a la cuenta, y el backend limita los intentos por
 * colaboradorId (8 cada 15 minutos, ver sesion.routes.ts#limitadorIngreso).
 */
export function pinDev(rol) {
  if (rol === 'administrador' && process.env.PIN_ADMIN) return process.env.PIN_ADMIN;
  if (!Object.hasOwn(PIN_DEV_POR_ROL, rol)) {
    throw new Error(
      `pinDev: no hay PIN de desarrollo para el rol "${rol}". Roles validos: ${Object.keys(PIN_DEV_POR_ROL).join(', ')}.`,
    );
  }
  return PIN_DEV_POR_ROL[rol];
}
