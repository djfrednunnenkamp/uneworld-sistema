# Deploy em Docker

## Como funciona

A cada push para `main` ou `desenvolver` (ou cada tag `v*`), o workflow
[.github/workflows/docker-publish.yml](.github/workflows/docker-publish.yml) builda
e publica duas imagens no GitHub Container Registry (GHCR):

- `ghcr.io/djfrednunnenkamp/uneworld-sistema-backend:latest`
- `ghcr.io/djfrednunnenkamp/uneworld-sistema-frontend:latest`

No servidor, você só precisa do arquivo `docker-compose.prod.yml` e de um `.env`
— **não precisa do código-fonte**.

## Primeira vez

1. Torne os pacotes públicos (ou configure autenticação — veja abaixo):
   - No GitHub: `Seu perfil → Packages → uneworld-sistema-backend → Package settings → Change visibility → Public`. Repita para `-frontend`.
   - Se preferir manter privado, no servidor rode antes do `pull`:
     `echo SEU_TOKEN | docker login ghcr.io -u SEU_USUARIO --password-stdin`
     (o token precisa do escopo `read:packages`).

2. No servidor, copie `docker-compose.prod.yml` e `.env.example` para uma pasta, ex: `/opt/uneworld/`.

3. Renomeie `.env.example` para `.env` e preencha os valores (gere um `SECRET_KEY` forte, defina `DB_PASSWORD`, ajuste `ALLOWED_HOSTS`/`CORS_ALLOWED_ORIGINS`/`CSRF_TRUSTED_ORIGINS` para o seu domínio).

4. Suba a stack:
   ```bash
   cd /opt/uneworld
   docker compose -f docker-compose.prod.yml pull
   docker compose -f docker-compose.prod.yml up -d
   ```

5. Crie o superusuário:
   ```bash
   docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
   ```

## Atualizar para uma nova versão

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

O `entrypoint.sh` do backend roda `migrate` e `collectstatic` automaticamente a
cada subida do container — não precisa rodar nada manualmente.

## Cloudflare / HTTPS

A stack escuta em HTTP puro na porta definida por `HTTP_PORT` (padrão 80). A
Cloudflare (ou outro proxy) deve apontar para essa porta do seu servidor —
o TLS público é terminado na Cloudflare; a conexão Cloudflare → servidor é
HTTP simples, então não há certificado para configurar aqui.

## Rastreamento de entrega/leitura de e-mail (Resend)

O sistema mostra na tela "E-mails enviados" se cada e-mail foi **entregue** (✓/✗)
e se foi **lido** (✓/✗). Isso depende de um webhook configurado no painel da
Resend, que só funciona com uma URL pública — **não funciona em `localhost`**.

Depois do deploy:
1. Acesse https://resend.com/webhooks → "Add Webhook".
2. URL: `https://seu-dominio.com.br/api/agenda/resend-webhook/`.
3. Eventos a marcar: `email.sent`, `email.delivered`, `email.bounced`, `email.delivery_delayed`, `email.opened`.
4. Copie o "Signing Secret" gerado e coloque em `RESEND_WEBHOOK_SECRET` no `.env`, depois suba a stack de novo (`docker compose up -d`).

Sem isso configurado, todo e-mail fica marcado como "🕐 enviado, aguardando
confirmação" para sempre (não é erro — só falta o webhook apontando para o servidor).

**Importante sobre o indicador de leitura:** ele usa um pixel invisível no
e-mail. Um "✓ lido" é confiável, mas alguns provedores (Gmail, Apple Mail)
pré-carregam ou bloqueiam imagens, então a ausência do evento não garante que
o e-mail não foi lido — é uma limitação de qualquer sistema de rastreamento
por pixel, não específica deste sistema.

## Desenvolvimento local com Docker (build local, sem GHCR)

```bash
cp .env.example .env   # ajuste os valores
docker compose build
docker compose up
```

## O que NÃO foi testado

O build e a execução real dos containers **não foram testados** neste ambiente
(Docker não está disponível aqui). Foram validados apenas:
- `python manage.py check` (Django) sem erros
- `npx vite build` (frontend) sem erros

Antes de depender disso em produção, rode `docker compose build && docker compose up`
localmente (ou no próprio servidor) e confira que tudo sobe corretamente.
