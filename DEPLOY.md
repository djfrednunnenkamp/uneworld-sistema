# Deploy no servidor (Ubuntu) — passo a passo

Este guia assume um servidor Ubuntu (20.04, 22.04 ou 24.04) limpo, acessado via
SSH, com um domínio já configurado na Cloudflare apontando para o IP desse
servidor. Cada comando é para colar exatamente como está.

## Visão geral de como funciona

A cada push para `main` ou `desenvolver` no GitHub, o repositório builda
automaticamente duas imagens Docker e publica no GitHub Container Registry
(GHCR):

- `ghcr.io/djfrednunnenkamp/uneworld-sistema-backend`
- `ghcr.io/djfrednunnenkamp/uneworld-sistema-frontend`

No servidor você **não precisa do código-fonte** — só de dois arquivos
(`docker-compose.prod.yml` e `.env`) que mandam o Docker baixar e rodar essas
imagens já prontas.

---

## Passo 1 — Conectar no servidor

Do seu computador:

```bash
ssh seu_usuario@IP_DO_SERVIDOR
```

Se for a primeira vez, ele vai pedir a senha (ou usar sua chave SSH, se
configurou uma na criação do servidor).

## Passo 2 — Atualizar o sistema

```bash
sudo apt update && sudo apt upgrade -y
```

## Passo 3 — Instalar o Docker

O Ubuntu já vem com uma versão antiga do Docker nos repositórios padrão — vamos
instalar a versão oficial direto do Docker:

```bash
# Remove versões antigas, se existirem (não dá erro se não tiver nenhuma)
sudo apt remove -y docker docker-engine docker.io containerd runc

# Dependências
sudo apt install -y ca-certificates curl gnupg

# Adiciona a chave oficial do Docker
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Adiciona o repositório do Docker
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Instala o Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Confirme que instalou certo:

```bash
docker --version
docker compose version
```

(Opcional, mas recomendado) Para não precisar de `sudo` em todo comando docker:

```bash
sudo usermod -aG docker $USER
```

Depois desse comando, **saia do SSH e conecte de novo** para o grupo valer.

## Passo 4 — Criar a pasta do projeto

```bash
sudo mkdir -p /opt/uneworld
sudo chown $USER:$USER /opt/uneworld
cd /opt/uneworld
```

## Passo 5 — Baixar os arquivos de configuração

Baixe direto do GitHub (substitua `desenvolver` por `main` se for usar a branch principal):

```bash
curl -O https://raw.githubusercontent.com/djfrednunnenkamp/uneworld-sistema/desenvolver/docker-compose.prod.yml
curl -O https://raw.githubusercontent.com/djfrednunnenkamp/uneworld-sistema/desenvolver/.env.example
mv .env.example .env
```

## Passo 6 — Tornar as imagens públicas no GitHub

Por padrão, as imagens que o GitHub Actions publica ficam **privadas** —
sem isso, o `docker compose pull` do passo 9 vai dar erro de permissão.

No navegador:
1. Acesse `https://github.com/djfrednunnenkamp?tab=packages`
2. Clique em `uneworld-sistema-backend`
3. No menu à direita, **Package settings**
4. Role até **Danger Zone → Change visibility → Public**
5. Repita os passos 2 a 4 para `uneworld-sistema-frontend`

(Alternativa, se preferir manter privado: gere um Personal Access Token com
escopo `read:packages` em github.com/settings/tokens e rode no servidor
`echo SEU_TOKEN | docker login ghcr.io -u SEU_USUARIO --password-stdin`
antes do passo 9.)

## Passo 7 — Preencher o `.env`

```bash
nano /opt/uneworld/.env
```

Gere uma `SECRET_KEY` forte (cole o resultado deste comando, rodado numa outra
aba do terminal, no lugar do valor de exemplo):

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(50))"
```

Edite cada linha do `.env`:

| Variável | O que colocar |
|---|---|
| `SECRET_KEY` | O valor gerado acima |
| `DEBUG` | `False` |
| `ALLOWED_HOSTS` | Seu domínio, ex: `uneworld.com.br,www.uneworld.com.br` |
| `CORS_ALLOWED_ORIGINS` | `https://uneworld.com.br` (com https, sem barra no final) |
| `CSRF_TRUSTED_ORIGINS` | mesmo valor de `CORS_ALLOWED_ORIGINS` |
| `DB_NAME` / `DB_USER` | pode deixar os valores padrão (`uneworld`) |
| `DB_PASSWORD` | uma senha forte qualquer — só é usada entre os containers |
| `HTTP_PORT` | `80` (a Cloudflare vai apontar para essa porta) |
| `RESEND_API_KEY` | sua chave da Resend (resend.com/api-keys) |
| `RESEND_FROM_EMAIL` | o remetente que aparece nos e-mails |
| `FRONTEND_URL` / `BACKEND_URL` | `https://uneworld.com.br` (seu domínio, com https) |
| `RESEND_WEBHOOK_SECRET` | deixe vazio por agora — veremos no Passo 12 |
| `MAXMIND_*` | opcional, deixe vazio se não usar geolocalização por IP |

Salve com `Ctrl+O`, Enter, e saia com `Ctrl+X`.

## Passo 8 — Configurar o firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw enable
```

Confirme com `y` quando ele perguntar. Verifique com `sudo ufw status`.

> Não abra as portas do Postgres (5432) ou do backend (8000) — elas só
> precisam ser visíveis entre os containers, nunca da internet.

## Passo 9 — Subir o sistema

```bash
cd /opt/uneworld
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

O primeiro `pull` baixa as imagens (pode demorar alguns minutos). O `up -d`
sobe tudo em segundo plano. Acompanhe os logs até ver o Daphne subir:

```bash
docker compose -f docker-compose.prod.yml logs -f backend
```

Quando aparecer `Starting Daphne (ASGI) na porta 8000`, está pronto. Saia do
log com `Ctrl+C` (isso não para o container, só sai da visualização).

## Passo 10 — Criar o usuário administrador

```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

Preencha e-mail e senha quando pedir.

## Passo 11 — Configurar a Cloudflare

No painel da Cloudflare, para o domínio:

1. **DNS** → adicione um registro `A` apontando para o IP do servidor, com a
   nuvem **laranja** (proxy ativado).
2. **SSL/TLS → Overview** → modo **"Flexible"**. Isso é essencial: significa
   que o visitante acessa via HTTPS na Cloudflare, e a Cloudflare conversa
   com seu servidor via HTTP simples (porta 80, exatamente o que o
   `docker-compose.prod.yml` expõe). O backend já está preparado para
   reconhecer isso (cabeçalho `X-Forwarded-Proto`).

Espere alguns minutos para o DNS propagar e acesse `https://seu-dominio.com.br`
— deve aparecer a tela de login do sistema.

## Passo 12 — Rastreamento de entrega/leitura de e-mail (opcional)

Agora que o domínio está público, dá para ativar os indicadores de "entregue"
e "lido" na tela de e-mails:

1. Acesse `https://resend.com/webhooks` → **Add Webhook**
2. URL: `https://seu-dominio.com.br/api/agenda/resend-webhook/`
3. Eventos: `email.sent`, `email.delivered`, `email.bounced`, `email.delivery_delayed`, `email.opened`
4. Copie o **Signing Secret** gerado
5. No servidor: `nano /opt/uneworld/.env`, preencha `RESEND_WEBHOOK_SECRET` com esse valor
6. `docker compose -f docker-compose.prod.yml up -d` (recria o backend com a variável nova)

## Pronto — checklist final

- [ ] `https://seu-dominio.com.br` abre a tela de login
- [ ] Login com o superusuário criado no Passo 10 funciona
- [ ] Envio de e-mail funciona (teste em Configurações → convidar um usuário, por exemplo)
- [ ] `docker compose -f docker-compose.prod.yml ps` mostra os 4 containers (`db`, `redis`, `backend`, `frontend`) como `Up`

---

## Atualizar para uma versão nova

Sempre que houver um novo push em `main`/`desenvolver`, uma nova imagem é
publicada automaticamente. No servidor:

```bash
cd /opt/uneworld
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

O backend roda `migrate` e `collectstatic` automaticamente a cada subida —
não precisa fazer nada manual.

## Backup do banco de dados

O Postgres guarda os dados num volume Docker (`db_data`), que sobrevive a
`up`/`down`, mas é bom ter backups externos:

```bash
docker compose -f docker-compose.prod.yml exec db pg_dump -U uneworld uneworld > backup_$(date +%Y%m%d).sql
```

Rode isso periodicamente (ex: via `cron`) e copie o arquivo para fora do
servidor (outro disco, S3, etc.).

## Comandos úteis do dia a dia

```bash
# Ver os containers rodando
docker compose -f docker-compose.prod.yml ps

# Ver logs de um serviço específico
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f frontend

# Reiniciar tudo
docker compose -f docker-compose.prod.yml restart

# Parar tudo (sem apagar dados)
docker compose -f docker-compose.prod.yml down

# Abrir um shell Django dentro do container (ex: para rodar comandos manuais)
docker compose -f docker-compose.prod.yml exec backend python manage.py shell
```

## Vídeos da Galeria (FFmpeg)

Todo vídeo enviado à Galeria é **normalizado** no servidor para um MP4 tocável em
qualquer navegador (H.264/yuv420p, `+faststart`, timestamps reconstruídos) e ganha
uma **thumbnail** real. O `ffmpeg`/`ffprobe` já vêm **instalados na imagem do
backend** (ver `Dockerfile`) — não há nada a instalar manualmente.

- **Como processa:** logo após o upload, um vídeo entra como `processando` e uma
  thread de fundo o converte (`VIDEO_PROCESS_INLINE=True`, padrão). O card mostra
  "Processando…" e vira ▶ (pronto) ou "Falha no vídeo" sozinho, via WebSocket.
- **Recuperar/reprocessar** (fila, presos, falhados, e vídeos **antigos** que ainda
  não têm versão normalizada):
  ```bash
  # Ver o que falta dos antigos (sem alterar nada)
  docker compose -f docker-compose.prod.yml exec backend \
      python manage.py reprocess_videos --legacy --dry-run
  # Migrar os antigos em lotes + destravar presos há >30min
  docker compose -f docker-compose.prod.yml exec backend \
      python manage.py reprocess_videos --legacy --requeue-stuck 30
  # Retentar os que falharam
  docker compose -f docker-compose.prod.yml exec backend \
      python manage.py reprocess_videos --failed
  ```
  O comando é **idempotente** e pode rodar por cron (ex.: `--pending --requeue-stuck 30`
  a cada 5 min) em servidores com muito volume, ou com `VIDEO_PROCESS_INLINE=0`
  quando quiser tirar a conversão do processo web.
- **Limite de upload:** o limite do sistema é 200 MB por vídeo. O **proxy reverso**
  na frente do backend (nginx/Cloudflare) precisa aceitar corpos desse tamanho —
  no nginx: `client_max_body_size 210m;` e um `proxy_read_timeout` folgado para
  uploads grandes. O `/media` já é servido com **HTTP Range** (nginx nativo), o que
  permite o *seek* no player.
- **Progresso real + recuperação:** a interface mostra barra/etapa/tempo restante
  (via `-progress` do FFmpeg + polling do endpoint `/status/`, com WebSocket para o
  instantâneo). Um vídeo que trava (thread/processo morto) é detectado por
  **heartbeat** e recuperado — pelo `--requeue-stuck`, e também sozinho quando o
  modal consulta o `/status/`. Nada fica "Processando…" para sempre.
- **FFmpeg não encontrado pelo Django:** se o processo Django subiu com um `PATH`
  diferente (ex.: ffmpeg em `~/.local/bin` e o serviço sem esse dir), o upload é
  aceito mas o vídeo vai para `failed` na hora (fail-fast, com mensagem clara) — não
  fica preso. Aponte o binário com `FFMPEG_BINARY=/caminho/ffmpeg` e
  `FFPROBE_BINARY=/caminho/ffprobe` no `.env` e **reinicie** o backend. Confira o que
  o processo resolve com `manage.py reprocess_videos` (ele imprime os caminhos).
- **Ajustes finos** (`.env`, opcionais): `VIDEO_TARGET_FPS` (30), `VIDEO_MAX_HEIGHT`
  (1080, não amplia), `VIDEO_CRF` (23), `VIDEO_PRESET` (medium), `FFMPEG_TIMEOUT`,
  `VIDEO_STUCK_HEARTBEAT_SECONDS` (120), `VIDEO_MAX_PROCESSING_ATTEMPTS` (3).

## Solução de problemas

**"https://seu-dominio.com.br" não abre / erro de conexão**
- Confira o DNS na Cloudflare (registro A correto, nuvem laranja)
- Confira o firewall: `sudo ufw status` deve mostrar `80/tcp ALLOW`
- Confira se os containers estão de pé: `docker compose -f docker-compose.prod.yml ps`

**Erro "too many redirects" no navegador**
- Confira se o SSL/TLS da Cloudflare está em **"Flexible"** (não "Full" nem "Strict") — com "Full"/"Strict" a Cloudflare espera HTTPS no servidor, que não existe aqui.

**`docker compose pull` falha com "denied" / "unauthorized"**
- As imagens ainda estão privadas — revise o Passo 6, ou faça `docker login ghcr.io` antes.

**Login dá "E-mail ou senha inválidos" mesmo com a senha certa**
- Confira se o backend está de pé: `docker compose -f docker-compose.prod.yml logs backend` — se não aparecer nada recente, ele pode ter caído; `docker compose -f docker-compose.prod.yml restart backend`.

**E-mails não chegam**
- Confira `RESEND_API_KEY` no `.env`
- Veja os logs: `docker compose -f docker-compose.prod.yml logs backend | grep RESEND`

**O agendador de prazos/aniversários não está enviando nada**
- Confira nos logs do backend se aparece a thread do agendador iniciando. Ela só inicia no processo principal (`RUN_SCHEDULER=1`, já configurado no `entrypoint.sh` da imagem — não precisa fazer nada manual).

---

## Build local (sem depender do GHCR)

Para testar mudanças no código antes de publicar, na sua máquina (não no
servidor):

```bash
cp .env.example .env   # ajuste os valores para localhost
docker compose build
docker compose up
```

## O que não foi testado neste ambiente

O build e a execução real dos containers foram desenhados e validados via
`python manage.py check`, `collectstatic` e `npx vite build` — mas o **build
Docker em si** (`docker build`, `docker compose up`) ainda não foi executado
de ponta a ponta, pois este ambiente de desenvolvimento não tem Docker
disponível. Recomenda-se acompanhar de perto a primeira subida em produção
(Passo 9) e observar os logs.
