# Páginas do Frontend

Uma página por rota (`frontend/src/pages`). Rotas em `frontend/src/App.jsx`:
tudo dentro de `/` passa por `ProtectedRoute` (exige login) e
`RequirePermission` (exige acesso à rota via `canAccess`). As rotas de auth
(`/login`, `/esqueci-senha`, `/redefinir-senha`, `/aceitar-convite`) são públicas.

> Para cada página: **rota**, **o que faz**, **comportamento esperado**,
> **permissões**, **endpoints/API** e **observações**.

---

## Autenticação (rotas públicas)

### Login.jsx — Tela de Login
- **Rota:** `/login` (redireciona para `/` se já autenticado)
- **O que faz:** Autentica o usuário por e-mail e senha e leva à Visão Geral.
- **Esperado:** valida campos; em sucesso faz `login()` e vai para `/`; em erro
  mostra a mensagem da API. Link para "Esqueci minha senha".
- **Permissões:** nenhuma. **API:** `useAuth().login(email, password)`.

### ForgotPassword.jsx — Esqueci minha senha
- **Rota:** `/esqueci-senha`
- **O que faz:** Recebe o e-mail e dispara o link de redefinição.
- **Esperado:** mensagem neutra (não revela se o e-mail existe); tela de
  confirmação após envio. **API:** `usersApi.forgotPassword(email)`.

### ResetPassword.jsx — Redefinir senha
- **Rota:** `/redefinir-senha?token=...`
- **O que faz:** Cria nova senha a partir do token; trata o caso de já haver
  sessão ativa no navegador (escolha de qual usuário continuar).
- **Esperado:** sem token → `/login`; valida senha (mín. 8) + confirmação; sem
  sessão, redefine e loga automaticamente. **API:** `usersApi.resetPassword`.

### AcceptInvite.jsx — Aceitar convite / Ativar conta
- **Rota:** `/aceitar-convite?token=...`
- **O que faz:** Valida o convite, deixa o novo usuário criar a senha e ativa a
  conta; exige aceite dos Termos quando houver termos cadastrados.
- **Esperado:** valida token ao carregar; checkbox de termos só se houver
  conteúdo visível. **API:** `usersApi.validateInvite`/`acceptInvite`, `configApi.terms`.

---

## Áreas principais

### Dashboard.jsx — Visão Geral
- **Rota:** `/` (index)
- **O que faz:** Cartões de estatísticas (passageiros, listas abertas, inscrições,
  câmbio), tabela de listas recentes e widget de e-mails enviados (status de
  entrega/leitura via Resend).
- **Esperado:** cada stat aparece só com a permissão correspondente (senão "—");
  cards e linhas navegam para as áreas; preview de e-mail (iframe sandbox) e
  reenvio de convite/reset; atualização em tempo real (WebSocket, escopos
  `emails`/`stats`/`lists`/`all`).
- **Permissões:** `dashboard_view_passengers` / `_lists` / `_enrollments`;
  câmbio `settings_exchange_rates_view`; e-mails `email_log_view`/`_preview`/`_resend`.
- **API:** `dashboardApi.getStats`, `agendaApi.emailLog*`.

### Passengers.jsx — Lista de Passageiros
- **Rota:** `/passageiros`
- **O que faz:** Tabela de todos os passageiros, com busca, filtros, criação,
  preview, lixeira e mesclagem de duplicados.
- **Esperado:** filtros client-side (status, aniversário, origem, gênero,
  alimentação); criar abre modal; selecionar 2+ habilita "Mesclar cadastros";
  exclusão recuperável (aba "Excluídos"); colunas sensíveis mascaradas sem
  `passengers_view_full`; tempo real via WebSocket.
- **Permissões:** `passengers_view_full`, `passengers_edit`, `passengers_delete`,
  `passengers_download_docs`.
- **API:** `passengersApi.list/.deleted/.remove/.restore/.purge/.merge`.

### PassengerDetail.jsx — Detalhe / Cadastro de Passageiro
- **Rota:** `/passageiros/:id` (`:id === 'novo'` cria)
- **O que faz:** Cadastro completo (dados pessoais, contatos, endereço,
  preferências) e gestão dos documentos anexados.
- **Esperado:** abas "Informações do cliente" e "Documentos" (persistida);
  validação local destaca obrigatórios e rola até o 1º erro; busca de CEP
  (ViaCEP); aviso ao sair com alterações não salvas; sub-abas de documentos
  (Atuais/Vencidos) com upload, validade e download.
- **Permissões:** `passengers_edit` (sem ela, campos `disabled`),
  `passengers_view_full`, `passengers_upload_docs`, `passengers_download_docs`.
- **API:** `passengersApi.get/.create/.update`, `documentsApi.*`, `configApi.docTypes/countries`.

### Agencies.jsx — Lista de Agências
- **Rota:** `/agencias`
- **O que faz:** Tabela de agências (PF/PJ) com busca, filtro por status, preview,
  criação, mesclagem e lixeira.
- **Esperado:** linha abre popup com campos copiáveis; selecionar 2+ → "Mesclar";
  exclusão recuperável; tempo real (WebSocket `agencies`).
- **Permissões:** `agencies_edit`, `agencies_delete`, `agencies_view_logs`.
- **API:** `agenciesApi.list/.deleted/.remove/.restore/.purge/.merge`.

### AgencyDetail.jsx — Detalhe / Cadastro de Agência
- **Rota:** `/agencias/:id` (`:id === 'nova'` cria)
- **O que faz:** Cadastro completo da agência (agente, endereço, PIX,
  observações) e aba de usuários vinculados.
- **Esperado:** busca por CEP (ViaCEP) e por CNPJ (BrasilAPI); PIX auto conforme
  o tipo; aba "Usuários" cria conta + vincula + envia convite; abas só aparecem
  para agências salvas.
- **Permissões:** `agencies_edit`, `agencies_view_logs`.
- **API:** `agenciesApi.get/.create/.update/.listMembers/.addMemberById/.removeMember`,
  `usersApi.create/.update/.sendInvite`.

### Contracts.jsx — Lista de Contratos
- **Rota:** `/contratos`
- **O que faz:** Tabela de contratos com busca, filtro por status, CRUD via modal,
  download de PDF e lixeira.
- **Esperado:** "Docs" busca o contrato completo e gera o PDF
  (`generateContractPDF`); exclusão recuperável; tempo real (WebSocket `contracts`).
- **Permissões:** `contracts_edit`, `contracts_delete`.
- **API:** `contractsApi.list/.get/.remove/.deleted/.restore/.purge`.

### Itineraries.jsx — Listagem de Roteiros
- **Rota:** `/roteiros`
- **O que faz:** Tabela de roteiros com busca, CRUD e lixeira.
- **Esperado:** criar abre modal e navega para `/roteiros/:id`; exclusão
  recuperável; tempo real (WebSocket `itineraries`).
- **Permissões:** `roteiros_edit`, `roteiros_delete`.
- **API:** `itinerariesApi.list/.deleted/.remove/.restore/.purge`.

### ItineraryDetail.jsx — Detalhe / Edição do Roteiro
- **Rota:** `/roteiros/:id`
- **O que faz:** Edição completa do roteiro em abas. A aba "Informações do
  roteiro" reúne básicos, campos editoriais (rich text), datas, financeiro e
  serviços intermediados. Abas Vídeos/Imagens/Slideshow exibem "Em breve".
- **Esperado:** edição inline; "Salvar" envia o payload completo. Sem
  `roteiros_edit`, a tela fica em **modo leitura** (inputs e editores de texto
  desabilitados, botões Salvar/Adicionar ocultos).
- **Permissões:** `roteiros_edit`.
- **API:** `itinerariesApi.get/.update`, `configApi.itineraryCategories/continents/
  destinations/holidays/services/itineraryTemplates`, `listsApi.suppliers`.
- **Observações:** usa **modelos de texto reutilizáveis** (Configurações);
  TagPickers permitem criar destinos/países/serviços na hora.

### Calendar.jsx — Calendário / Agenda
- **Rota:** `/calendario`
- **O que faz:** Calendário de eventos (viagens, prazos, pendências,
  aniversários) com visões Mês/Semana/Dia, painel "Hoje" e disparo manual do
  resumo por e-mail.
- **Esperado:** aceita `?date=` e `?list_id=` (filtra por lista); clicar num
  evento abre o objeto (se houver acesso); "Enviar resumo" dispara o digest;
  tempo real (WebSocket).
- **Permissões:** eventos por `calendar_view*`; log por `lists_view_logs`/`view_audit_log`.
- **API:** `agendaApi.events/getPrefs/updatePrefs/sendNow`.

---

## Operacional (Listas de Passageiros)

### Trips.jsx — Listas de Passageiros (índice)
- **Rota:** `/viagens`
- **O que faz:** Lista todas as "Listas de Passageiros" segmentadas por fase do
  ciclo de vida (Em criação / Em andamento / Finalizadas), calculadas pelas datas.
- **Esperado:** aba "Excluídos" (lixeira) para quem pode excluir; criar abre
  `ListModal` e navega para a nova lista; tempo real (WebSocket `lists`).
- **Permissões:** `lists_edit`, `lists_delete`, `lists_view_logs`.
- **API:** `listsApi.list/.remove/.deleted/.restore/.purge`.

### TripDetail.jsx — Detalhe da Lista de Passageiros
- **Rota:** `/viagens/:id`
- **O que faz:** Tela operacional central de uma lista/viagem. Apesar do nome
  "Trip", a entidade é uma **Lista de Passageiros** (`listsApi.get(id)`).
  Cabeçalho com métricas + conteúdo em abas.
- **Abas e seções:**
  - **Passageiros** (sempre): inscritos agrupados por acomodação, com seções de
    bloqueios, "sem acomodação" e cancelados; busca, seleção em massa, ícones de
    documento/assento/origem; adicionar passageiro (busca/CPF), edição rápida,
    mudar status, observações, equipe técnica, vincular agência, acomodações.
  - **Voos** (só `aereo`): passagens/voos por passageiro + notas da lista.
  - **Origens** (só `terrestre`): passageiros saindo de cidade/aeroporto
    diferentes do padrão.
  - **Modais:** mapa de ônibus (`SeatMapModal`), importação CSV, impressão
    (PDF/HTML + `logDownload`), pendências/tarefas (com atalho para o calendário),
    edição rápida, confirmação "mesmo sexo" no quarto.
- **Esperado:** alternar status (Aberta/Fechada) com PATCH otimista + rollback;
  card "Disponíveis para venda" fica vermelho ao vender além do bloqueio; tempo
  real (WebSocket).
- **Permissões:** `lists_edit`, `lists_download`, `lists_passengers_add/_edit/_remove`,
  `lists_csv_upload`, `passengers_download_docs`, `lists_view_logs`.
- **API:** `listsApi.*` (passageiros, quartos, tarefas, CSV, log-download),
  `passengersApi.*`, `configApi.*`, `documentsApi.*`, `agenciesApi.*`.

---

## Administração & Configuração

### Users.jsx — Gestão de Usuários
- **Rota:** `/usuarios`
- **O que faz:** Lista, cria, edita perfil/permissões, bloqueia e exclui
  usuários, com permissões granulares (acordeão por grupo) e lixeira.
- **Esperado:** filtros (papel, status, permissão, datas); ações por linha
  (editar perfil/permissões, enviar reset/convite, definir senha com senha de
  admin, bloquear, excluir); seleção em massa (presets Admin/Usuário, exclusão em
  lote); não é possível bloquear/excluir a si mesmo; tempo real.
- **Permissões:** `manage_users` ou granulares (`users_edit`,
  `users_manage_permissions`, `users_block`, `users_delete`, `users_set_password`).
- **API:** `usersApi.*`, `configApi.permissionProfiles`.

### Settings.jsx — Central de Configurações
- **Rota:** `/configuracoes` (importações em `/configuracoes/import` e
  `/configuracoes/geo-import`)
- **O que faz:** Página única com **grade de cards por categoria**; cada card abre
  um modal com o gerenciador da lista. Centraliza todos os cadastros que alimentam
  o sistema, com export/import CSV (por lista, geo, e combinado global) e
  importação de bases prontas "da internet" em background.
- **Seções gerenciadas (chave de permissão):** Documentos
  (`settings_doc_types`), Perfis de permissão (`settings_user_profiles`, com
  lixeira), Profissões, Idiomas, Vacinas, Gêneros, Categorias de Roteiro,
  Destinos, Feriados, Serviços, **Modelos de Texto do Roteiro**
  (`settings_itinerary_templates`), Carteiras, Adicionais de Lista, Equipe
  técnica, Tipos/Categorias de Acomodação, **Países & Estados** (hierarquia
  Continente→País→Estado→Cidade), Aeroportos, Companhias Aéreas, Mapas de Ônibus,
  Cláusulas de Contrato, **Operadora** (`settings_operating_company` — dados da
  UneWorld que pré-preenchem os contratos), Termos e Condições, Formas de
  Pagamento, Câmbio.
- **Esperado:** busca + filtro por área; CRUD por modal; "Exportar/Importar tudo";
  "Importar da internet" assíncrono (progresso na sidebar); tempo real (WebSocket
  `config`).
- **Permissões:** `can(base, acao)` — `manage_settings` ou
  `settings_*_view/edit/delete/bulk_import/import_web`.

### GeoImport.jsx — Revisão de Importação CSV (Geografia)
- **Rota:** `/configuracoes/geo-import` (recebe o CSV via `location.state`)
- **O que faz:** Revisão e confirmação da importação CSV da hierarquia geográfica
  (Continente → País → Estado → Cidade).
- **Esperado:** fases upload → análise (lotes) → revisão → importação → fim; cada
  linha marcada como Novo/Duplicado/Erro; modos adicionar/substituir/apagar;
  edição inline; linhas com erro ficam de fora.
- **API:** `configApi.geoAnalyze/geoAction`, `auditApi.logUpload`.

### FlatImport.jsx — Revisão de Importação CSV (listas simples e "todas")
- **Rota:** `/configuracoes/import` (recebe o CSV via `location.state`)
- **O que faz:** Revisão/confirmação de importação CSV das listas de
  configuração — de uma lista específica ou do CSV combinado de todas.
- **Esperado:** status por linha (novo/duplicado/erro); filtros; edição inline;
  respeita as `permittedKeys` (o que o usuário pode importar). Cobre ~25 tipos.
- **API:** `configApi.*`, `listsApi.*`, `auditApi.logUpload`.

### AuditLog.jsx — Log de Auditoria
- **Rota:** `/log` (params: `scope`, `model`, `list_id`, `passenger_id`, `agency_id`)
- **O que faz:** Histórico de ações (CRUD, login, downloads/uploads, navegação)
  com filtros por área/tipo, ação, usuário, data e contexto.
- **Esperado:** filtro de Tipo em duas camadas (área → modelo); barra de contexto
  quando chega com `list_id`/etc.; detalhe com diffs e **mapa de localização**;
  tempo real (WebSocket `audit`).
- **Permissões:** `view_audit_log`/`log_view` (global) ou `*_view_logs` por área;
  `log_page_views` para ver navegação. Sem permissão, vê só as próprias ações.
- **API:** `auditApi.list`, `usersApi.list`, `listsApi/passengersApi/agenciesApi.list`.

> **Nota:** a antiga `Destinations.jsx` (placeholder não roteado, com botões sem
> ação) foi **removida**. A gestão de Destinos vive em Configurações
> (`settings_destinations`).
