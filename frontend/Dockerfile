FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# A-15: imagem nginx NÃO-root (roda como uid 101 "nginx"). Ela escuta em 8080
# (porta não-privilegiada) — o nginx.conf usa "listen 8080" e o compose mapeia a
# porta 80 do HOST para a 8080 do container, então nada muda pra quem acessa.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
