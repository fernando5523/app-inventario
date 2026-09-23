# Imagen del backend de app-inventario, para Azure Web App for Containers.
#
# ---------------------------------------------------------------------------
# NODE 22 Y NO LA 26
# ---------------------------------------------------------------------------
# En la maquina de desarrollo corre Node 26, pero la imagen se fija en 22 LTS:
# es lo que ofrece Azure y lo que va a tener soporte durante el piloto. Fijarla
# ACA y no dejarla al azar es lo que evita el clasico "en mi maquina anda":
# el contenedor es el mismo en las dos partes.
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
COPY package.json package-lock.json ./
RUN npm ci

# El schema ANTES del resto del codigo: `prisma generate` solo depende de el.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

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
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm install --no-save prisma@5.20.0

# El cliente generado en la etapa de build: no se regenera acá.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist

# Las migraciones y el seed de las 10 tiendas viajan: el seed se corre a mano
# una sola vez (`docker exec ... npx prisma db seed`), las migraciones las
# aplica el arranque.
COPY prisma ./prisma

# El puerto es el que inyecta Azure (`PORT`). El 3000 es solo el default de
# `src/index.ts` cuando la variable no esta -- por ejemplo corriendo la imagen
# a mano en la laptop. En Azure hay que configurar WEBSITES_PORT con el mismo
# numero que se exponga acá, si no el front-end no sabe a donde mandar el
# trafico.
EXPOSE 3000

# NO root: si alguien se escapa del proceso, no es administrador del
# contenedor. La imagen de Node ya trae el usuario `node`.
USER node

# Las migraciones ANTES de escuchar. `migrate deploy` (no `migrate dev`) es el
# comando de produccion: aplica lo pendiente y nunca genera ni borra nada.
# Si falla, el contenedor no arranca -- y eso es lo correcto: es preferible que
# Azure reporte el arranque caido a que atienda pedidos con la base a medias.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
