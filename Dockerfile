FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM nginx:stable-alpine
ENV STUDIO_API_UPSTREAM=http://backend:8788
ENV STUDIO_TRUSTED_PROXY_CIDR=127.0.0.1/32
COPY --from=build /app/dist /usr/share/nginx/html
COPY deployment/nginx.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
