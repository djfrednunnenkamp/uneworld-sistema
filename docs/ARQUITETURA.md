# Arquitetura

## Stack

| Camada | Tecnologia |
|--------|------------|
| Backend | Django 6 + Django REST Framework + Channels (WebSockets) |
| Frontend | React 19 + Vite + (estilos majoritariamente inline + CSS global) |
| Banco | PostgreSQL (produção) / SQLite (desenvolvimento) |
| Tempo real | Django Channels + Redis |
| E-mail | Resend (envio + webhook de status) |
| Geolocalização | GeoLite2 (offline) + Nominatim (reverse geocode) |
| Deploy | Docker + GitHub Actions → GHCR |

## Organização de pastas

```
backend/
  core/         Projeto Django: settings.py, urls.py, soft_delete.py, merge.py
  users_api/    Autenticação, usuários, PERMISSÕES, convites, reset de senha
  passengers/   Passageiros e documentos
  trips/        Listas de Passageiros, inscrições, acomodações, voos, tarefas
  agencies/     Agências parceiras e membros
  contracts/    Contratos de viagem
  itineraries/  Roteiros (produto comercial)
  config_api/   ~30 catálogos configuráveis + singletons (operadora, termos, sistema)
  agenda/       Calendário, e-mails automáticos (scheduler), webhook Resend
  dashboard/    Estatísticas da home + infra de jobs em background
  audit/        Log de auditoria + geolocalização de IP

frontend/src/
  pages/        Uma página por rota (ver PAGINAS.md)
  components/   ~70 componentes reutilizáveis (pickers, modais, tabela, etc.)
  context/      AuthContext (usuário logado) e PrefsContext (preferências)
  hooks/        useWebSocket, usePersistedTab, etc.
  api/          client.js (axios) e index.js (todas as funções de API)
  utils/        permGroups, permissions, formatadores, geradores de PDF/HTML
```

## Fluxo de dados (request típico)

```
Página React → função em api/index.js → axios (api/client.js, baseURL '/api')
   → Django URLConf (core/urls.py → app/urls.py) → ViewSet/View
   → Serializer → Model → PostgreSQL
   → resposta JSON → estado da página
```

O Vite (dev) faz proxy de `/api` para `http://localhost:8000`. Em produção o
nginx serve o build do frontend e encaminha `/api` para o Django.

## Autenticação e sessão

- Autenticação por **sessão/cookie** do Django (não há JWT). O `api/client.js`
  usa `withCredentials` e envia o token CSRF lido do cookie.
- Login é por **e-mail**: o backend acha o usuário pelo e-mail (`email__iexact`)
  e autentica pelo `username` interno. **Convenção do sistema: `username` é
  sempre igual ao `email`** — qualquer fluxo que mude o e-mail precisa sincronizar
  o username (ver [RELATORIO_FALHAS.md](RELATORIO_FALHAS.md)).
- O frontend descobre quem está logado via `GET /api/users/me/`, que devolve o
  usuário + o dicionário de permissões. `AuthContext` mantém esse estado
  (`user` tri-estado: `null` carregando / `false` deslogado / objeto logado).
- Convites e reset de senha usam tokens UUID com expiração (`InviteToken` 7 dias,
  `PasswordResetToken` 2h).

## Permissões

Sistema **granular por área e ação**, definido em
`backend/users_api/permissions.py` e espelhado no frontend em
`frontend/src/utils/permGroups.js`. Detalhes em [PERMISSOES.md](PERMISSOES.md).
Resumo: superusuário pode tudo; demais usuários têm um `BooleanField` por chave
de permissão no model `UserPermissions`.

## Soft-delete (lixeira)

Quase nenhuma entidade é apagada de fato. "Excluir" só marca
`is_deleted=True`/`deleted_at`. O item vai para a aba **"Excluídos"** da área, de
onde **só um superusuário** pode restaurar ou purgar (apagar de vez).

- Implementado por `core/soft_delete.py` (`SoftDeleteViewSetMixin`):
  `get_queryset` filtra por `is_deleted`; `destroy` faz o soft-delete;
  `restore`/`purge` são restritos a superusuário e só agem sobre itens já na lixeira.
- **Atenção:** consultas em outros lugares (relatórios, e-mails, contagens,
  buscas de duplicidade) precisam filtrar `is_deleted=False` explicitamente, senão
  registros "excluídos" vazam. Esse foi um padrão de bug corrigido na auditoria.

## Mesclagem de duplicatas (merge)

`core/merge.py` (`MergeViewSetMixin`) mescla cadastros duplicados (passageiros,
agências): o usuário escolhe o registro "vencedor" e, campo a campo, de qual
registro vem cada valor. Os perdedores têm suas referências (inscrições,
documentos, membros) repontadas para o vencedor e depois vão para a lixeira.

## Tempo real (WebSocket)

`dashboard/consumers.py` + Django Channels transmitem mensagens de "refresh" por
**escopo** (`lists`, `passengers`, `agencies`, `contracts`, `config`, `audit`,
`emails`, `stats`, `all`). No frontend, o hook `useWebSocket` faz um *refetch
silencioso* da página quando chega um evento do escopo relevante — por isso as
listas atualizam sozinhas quando outro usuário altera algo.

## E-mails e agendamento

- Envio via **Resend** (`agenda/email_service.py`, `users_api/email_service.py`).
- `agenda/scheduler.py` roda uma **thread daemon** (iniciada no `apps.ready()`)
  que, de hora em hora, envia os resumos/lembretes que cada usuário configurou,
  **respeitando o fuso horário configurado** (`America/Sao_Paulo`).
- Cada e-mail é registrado em `EmailLog`; o webhook `POST /api/agenda/resend-webhook/`
  (assinatura Svix) atualiza o status (entregue/aberto/devolvido).

## Jobs em background

`dashboard/jobs.py` (`run_job`) executa importações demoradas (catálogos da
internet: CBO, países, IBGE, aeroportos, etc.) em background, reportando
progresso que a Central de Configurações exibe na barra lateral.

## Auditoria

Toda ação relevante gera um `AuditLog` (quem, o quê, quando, de onde). O IP é
geolocalizado offline (GeoLite2) e, em logins, refinado por reverse geocode
(Nominatim). `audit/middleware.py` guarda usuário/IP da requisição atual em
thread-local para os signals; **esse estado é limpo ao fim de cada requisição**
para não atribuir ações ao usuário errado em threads reaproveitadas.
