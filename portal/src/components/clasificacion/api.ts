import api from '../../services/api'
import type { Clasificacion, ExcepcionAGuardar, PaginaDeProductos } from './tipos'

/**
 * Las tres llamadas de "Clasificación de productos".
 *
 * VIVEN ACÁ Y NO EN `services/api.ts` porque ese archivo es zona compartida:
 * hay otros agentes escribiendo en el portal. Reusan la MISMA instancia de
 * axios (su token, su timeout y su 401 → login), que es lo único que no se
 * puede duplicar sin partir la sesión en dos.
 *
 * Las tres son SOLO DEL AUDITOR, ni siquiera del administrador: el router lo
 * exige (`clasificacion.routes.ts`) porque esta decisión mueve plata en la
 * liquidación. Para otro rol el servidor contesta 403, y la pantalla lo dice
 * con el mensaje del servidor en vez de una lista vacía.
 */

/**
 * `GET /api/clasificacion` — una página del catálogo (~11.800 códigos).
 *
 * LA BÚSQUEDA ES DEL SERVIDOR, no del navegador: pega contra código,
 * descripción Y categoría sobre el catálogo entero. Filtrar en el cliente
 * sobre las 40 filas que hay en memoria contestaría sobre la página, no sobre
 * el catálogo, y un "Sin resultados" sería falso.
 *
 * `total` es la cantidad de códigos DISTINTOS que matchean en el servidor, no
 * los que se trajeron: es lo que permite decir "Mostrando 40 de 11.800" sin
 * mentir.
 */
async function buscar(filtro: {
  q?: string
  soloClasificados: boolean
  limite: number
  desplazamiento: number
}): Promise<PaginaDeProductos> {
  const { data } = await api.get<PaginaDeProductos>('/clasificacion', {
    params: {
      ...(filtro.q === undefined || filtro.q === '' ? {} : { q: filtro.q }),
      // Se manda solo cuando es `true`: el schema lo valida como el texto
      // 'true'/'false' y su default ya es `false`.
      ...(filtro.soloClasificados ? { soloClasificados: 'true' } : {}),
      limite: filtro.limite,
      desplazamiento: filtro.desplazamiento,
    },
  })
  return data
}

/**
 * `PUT /api/clasificacion/:codigo` — guarda (o reemplaza) la excepción.
 *
 * ES UN PUT, no un PATCH: el cuerpo declara la excepción ENTERA, así que la
 * pantalla manda SIEMPRE las dos cosas que tiene cargadas. Un
 * `empaqueCompraCorregido: null` explícito es el deshacer, y omitirlo borraría
 * la corrección anterior sin que nadie lo haya pedido.
 *
 * NO VIAJA `esEmpresa`: lo deriva el servidor de `clase`, y por eso las dos
 * nunca pueden discrepar. El schema es `.strict()`, así que mandarlo sería un
 * 400, no algo que se ignore en silencio.
 */
async function clasificar(codigo: string, cuerpo: ExcepcionAGuardar): Promise<Clasificacion> {
  const { data } = await api.put<Clasificacion>(`/clasificacion/${encodeURIComponent(codigo)}`, cuerpo)
  return data
}

/**
 * `DELETE /api/clasificacion/:codigo` — QUITA LA EXCEPCIÓN DEL AUDITOR.
 *
 * NO BORRA EL PRODUCTO ni ningún dato del catálogo: borra la fila de
 * excepción, y sin excepción vuelve a mandar Dynamics. Es el deshacer de esta
 * pantalla. La historia no se pierde: queda qué se quitó, con su valor
 * anterior, quién y cuándo, en el registro de auditoría.
 *
 * El servidor contesta 204 sin cuerpo.
 */
async function desclasificar(codigo: string): Promise<void> {
  await api.delete(`/clasificacion/${encodeURIComponent(codigo)}`)
}

export const clasificacionApi = { buscar, clasificar, desclasificar }
