FROM node:20-alpine AS base
WORKDIR /app

# deps
COPY package.json package-lock.json* ./
RUN npm ci

# build (if TS)
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=base /app/dist ./dist
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

EXPOSE 3000

CMD ["node", "dist/index.js"]
