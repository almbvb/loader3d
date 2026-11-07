# syntax=docker/dockerfile:1

# Versions come from .env via docker-compose.yml (build args); these are fallbacks.
ARG NODE_VERSION=24
ARG CADDY_VERSION=2

# --- build: typecheck, unit tests, production bundle ---------------------------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
# Public address of the site for the prerendered landing page (scripts/prerender.mjs); may be empty.
ARG SITE_URL=
ENV SITE_URL=${SITE_URL}
# Tariffs on the site (vite.config.ts reads it like the repository's .env); the api gets it at runtime.
ARG TIERS_ENABLED=false
ENV TIERS_ENABLED=${TIERS_ENABLED}

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm test && npm run build

# --- runtime: static files served by Caddy (automatic HTTPS when a domain is set)
FROM caddy:${CADDY_VERSION}-alpine

COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

EXPOSE 80 443 443/udp
