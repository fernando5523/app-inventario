# Imagen del BACKEND de app-inventario, para Azure Web App for Containers.
#
# ---------------------------------------------------------------------------
# POR QUE VIVE EN LA RAIZ Y NO EN backend/
# ---------------------------------------------------------------------------
# Estuvo en `backend/Dockerfile` y el pipeline de despliegue no lo pudo
# construir: arma el contexto en la RAIZ del repositorio, donde no hay ningun
# `package.json`, y el primer COPY moria con
#
#   COPY failed: file not found in build context: stat package.json
#
# Se podria haber cambiado el contexto del pipeline; se movio el Dockerfile en
# su lugar porque es lo que no depende de como esté configurado el pipeline de
# turno.
#
# ---------------------------------------------------------------------------
# LA IMAGEN TRAE TAMBIEN LA WEB DEL AUDITOR
# ---------------------------------------------------------------------------
# `mobile/` ya no queda afuera: una etapa aparte corre
# `expo export --platform web` y el resultado se copia a `public/`, que el
# backend sirve (ver backend/src/config/app.ts). Asi se despliega UNA sola
# cosa en Azure en vez de dos, y la web habla con su propio origen.
#
# El precio es el tiempo de construccion: la etapa nueva instala las
# dependencias de mobile/ (que son muchas mas que las del backend) y bundlea
# ~3,7 MB de JavaScript. Se paga a proposito: la alternativa era desplegar el
# front por separado y mantener sincronizadas dos URLs y dos versiones.
#
#   docker build -t inventario-backend .
#
# ---------------------------------------------------------------------------
# NODE 22 Y NO LA 26
# ---------------------------------------------------------------------------
# En la maquina de desarrollo corre Node 26, pero la imagen se fija en 22 LTS:
# es lo que ofrece Azure y lo que va a tener soporte durante el piloto. Fijarla
# ACA y no dejarla al azar es lo que evita el clasico "en mi maquina anda".
#
# `slim` y no `alpine`: Prisma necesita OpenSSL y en alpine (musl) hay que
# pelearse con los binarios del engine. En slim (glibc) el engine por defecto
# funciona sin configurar `binaryTargets`.
FROM node:22-slim AS build

WORKDIR /app

# OpenSSL: Prisma lo pide para generar y para conectarse. La imagen slim no
# lo trae completo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Primero SOLO los manifiestos: mientras no cambien, Docker reusa la capa de
# node_modules y el build tarda segundos en vez de minutos.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# El schema ANTES del resto del codigo: `prisma generate` solo depende de el.
COPY backend/prisma ./prisma
RUN npx prisma generate

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ---------------------------------------------------------------------------
# LA WEB: el mismo codigo de la app, exportado para el navegador.
# ---------------------------------------------------------------------------
# Etapa propia y no pegada a la del backend para que Docker pueda cachearlas
# por separado: tocar `backend/src` no obliga a reinstalar node_modules de
# mobile/ ni a re-bundlear la web, que es lo caro.
FROM node:22-slim AS web

WORKDIR /app

COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# LA URL DE LA API: RELATIVA, NO UN HOST
# ---------------------------------------------------------------------------
# `urlBase()` (mobile/lib/adaptadores/_http.ts) compone `${base}${ruta}`, y
# con `EXPO_PUBLIC_API_URL=/` la base queda en cadena vacia: cada pedido sale
# como `/api/...`, o sea CONTRA EL MISMO ORIGEN que sirvio la pagina.
#
# Eso es justo lo que hace falta acá, donde el backend sirve las dos cosas:
# funciona con cualquier hostname, sobrevive a recrear el recurso en Azure y
# no hay una URL que configurar por ambiente. Verificado en el bundle
# generado: `function n(){return "/".replace(/\/+$/,'')}` y
# `fetch(`${n()}${o}`)`.
#
# Se deja como ARG y no clavado por si algun dia la web se sirve desde otro
# lado (un CDN, otro dominio): ahi se construye con la URL absoluta del
# backend. El default es el caso de esta imagen.
#
# OJO: el valor entra al bundle en tiempo de BUILD. Cambiarlo en Azure como
# variable de entorno no hace nada -- hay que reconstruir la imagen.
ARG EXPO_PUBLIC_API_URL=/
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL

COPY mobile/ ./
RUN npx expo export --platform web --output-dir web-build

# ---------------------------------------------------------------------------
# Imagen final: solo lo que hace falta para CORRER.
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# `--omit=dev` deja fuera TypeScript, vitest y tsx. Y despues se vuelve a
# instalar `prisma` a mano: el CLI es dependencia de desarrollo pero hace falta
# en runtime para `migrate deploy` al arrancar. Sin esto el contenedor levanta
# contra una base sin migrar y falla en la primera consulta, que es el peor
# momento para enterarse.
# La version del CLI es EXACTAMENTE la que resolvio el lockfile para
# `@prisma/client` (5.22.0, no el `^5.20.0` del package.json): con versiones
# distintas el CLI avisa que el cliente generado no le corresponde, y esa
# advertencia aparece en el arranque de cada contenedor.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev \
  && npm install --no-save prisma@5.22.0

# El cliente generado en la etapa de build: no se regenera acá.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist

# La web exportada, al lado de `dist/`: es exactamente donde la busca
# `CARPETA_WEB` en src/config/app.ts (`__dirname/../../public`, o sea
# /app/dist/config -> /app/public). Si este COPY se cae o se saca, el backend
# NO falla al arrancar: se queda sin servir web y sigue siendo la API de
# siempre -- a proposito, para que un problema de front no tire el backend.
COPY --from=web /app/web-build ./public

# Las migraciones y el seed de las 10 tiendas viajan: el seed se corre a mano
# una sola vez (`npx prisma db seed`), las migraciones las aplica el arranque.
COPY backend/prisma ./prisma

# El puerto es el que inyecta Azure (`PORT`). El 3000 es solo el default de
# `src/index.ts` cuando la variable no esta -- por ejemplo corriendo la imagen
# a mano en la laptop. En Azure hay que configurar WEBSITES_PORT=3000, el mismo
# numero que se expone acá, si no el front-end no sabe a donde mandar el
# trafico y responde 502.
EXPOSE 3000

# NO root: si alguien se escapa del proceso, no es administrador del
# contenedor. La imagen de Node ya trae el usuario `node`.
USER node

# ---------------------------------------------------------------------------
# LAS MIGRACIONES ANTES DE ESCUCHAR, Y ESO NO ES NEGOCIABLE
# ---------------------------------------------------------------------------
# `migrate deploy` (no `migrate dev`) es el comando de produccion: aplica lo
# pendiente y nunca genera ni borra nada.
#
# Sin `DATABASE_URL` esto falla y el contenedor NO ARRANCA. Es a proposito, y
# es la respuesta a "despleguemos ahora y las variables despues": una imagen
# que levanta sin base no sirve para ver nada -- cada pantalla de la app pega
# contra Postgres en el primer render. Arrancar igual solo cambiaria un error
# de contenedor, que se ve en el portal, por una app en pie que falla en cada
# pedido, que hay que ir a buscar a los logs.
#
# `./node_modules/.bin/prisma` y no `npx`: npx puede intentar resolver (y
# hasta bajar) el paquete, y este contenedor corre como usuario `node` y
# quizas sin salida a internet. El binario ya esta instalado; se lo llama
# derecho.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/index.js"]
