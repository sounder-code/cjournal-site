# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS dependencies
WORKDIR /app
ENV ASTRO_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM dependencies AS development
COPY . .
EXPOSE 4321
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM dependencies AS build
COPY . .
ARG PUBLIC_GA_ID=G-SE44ENS3KV
ARG PUBLIC_GTM_ID=
ARG PUBLIC_NAVER_ANALYTICS_ID=24eb41c656c0500
ARG PUBLIC_SITE_URL=https://danjipyo.kr
ENV PUBLIC_GA_ID=${PUBLIC_GA_ID}
ENV PUBLIC_GTM_ID=${PUBLIC_GTM_ID}
ENV PUBLIC_NAVER_ANALYTICS_ID=${PUBLIC_NAVER_ANALYTICS_ID}
ENV PUBLIC_SITE_URL=${PUBLIC_SITE_URL}
RUN npm run typecheck && npm run build

FROM nginx:1.27-alpine AS production
COPY docker/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
