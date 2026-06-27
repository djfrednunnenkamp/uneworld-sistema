# Apps do Backend

Django REST Framework. Cada app é registrado em `core/urls.py` sob `/api/...`.
Padrões transversais (soft-delete, merge, permissões, tempo real) estão na
[ARQUITETURA.md](ARQUITETURA.md).

---

### users_api — Autenticação, Usuários e Permissões
- **Responsabilidade:** Login/logout por e-mail, gestão de usuários, o sistema de
  permissões granular, convites, reset de senha e o gate de Termos.
- **URL:** `/api/users/`
- **Models:**
  - `UserPermissions` — `OneToOne` com `User`; ~200 `BooleanField` (um por chave).
    Carrega também o soft-delete do usuário (`is_deleted`/`deleted_at`) e
    `terms_accepted_at`.
  - `PasswordResetToken` — token UUID, expira em 2h.
  - `InviteToken` — convite por e-mail (UUID, expira em 7 dias).
- **Endpoints:** `POST login/`, `POST logout/`, `GET/PATCH me/`,
  `POST me/change-password/`, `POST me/accept-terms/`, `POST forgot-password/`,
  `POST reset-password/`, `GET invite/validate/`, `POST invite/accept/`. Admin:
  lista (`?deleted=1`), `create/`, `<pk>/` (update), `<pk>/invite/`,
  `<pk>/send-reset/`, `<pk>/set-password/` (exige a senha do admin),
  `<pk>/delete/` (soft), `<pk>/restore/`, `<pk>/purge/` (superuser).
- **Permissões:** é o app que **define** o sistema. Ver [PERMISSOES.md](PERMISSOES.md).
- **Particularidades:** `username == email` sempre. Soft-delete de usuários. Gate
  de Termos força reaceite se os termos mudarem após o último aceite. E-mails via
  Resend (`email_service`).

### passengers — Passageiros e Documentos
- **Responsabilidade:** CRUD de passageiros e gestão dos documentos (arquivos).
- **URL:** `/api/passengers/`
- **Models:** `Passenger` (cadastro completo; M2M com `Agency`; soft-delete),
  `PassengerDocument` (arquivo com tipo/validade/número; upload em caminho com UUID).
- **Endpoints:** ViewSet CRUD; actions `GET check-cpf/` (duplicidade), `GET active/`,
  `GET <pk>/agencies/`, `GET/POST <pk>/documents/`, `POST merge/`. ViewSet
  `documents/` separado com `preview/` (inline) e `download/` (anexo).
- **Permissões:** `passengers_view_basic`/`_view_full`, `passengers_edit`,
  `passengers_delete`, `passengers_upload_docs`/`_download_docs`.
- **Particularidades:** Soft-delete + merge (reaponta inscrições e documentos).
  Download/remoção apagam o arquivo físico e geram `AuditLog`.

### trips — Listas de Passageiros, Inscrições, Acomodações, Tarefas
- **Responsabilidade:** Núcleo operacional de uma viagem: a Lista e tudo que pende
  dela. Contém também modelos legados (`Trip`/`Enrollment`/`Destination`).
- **URL:** `/api/trips/`
- **Models:**
  - `PassengerList` — a lista operacional (tipo aéreo/terrestre, capacidade, datas,
    status, saída, mapa de ônibus, M2M fornecedores/adicionais/roteiros); soft-delete.
  - `ListEnrollment` — passageiro **ou** bloqueio dentro da lista (acomodação,
    assento, status, prazo, origem/voo). `unique_together(lista, passageiro)`.
  - `Room` (acomodação, com `same_sex_ack`), `ListTask` (pendência com prazo),
    `Supplier`/`ListAdditional`/`CrewRole`/`Roteiro` (catálogos).
- **Endpoints (PassengerListViewSet):** `GET/POST <pk>/passageiros/`,
  `PATCH/DELETE <pk>/passageiros/<id>/` (`manage_passenger` — vincula/troca/
  desvincula, edita), `POST <pk>/import-csv/`, `GET/POST <pk>/rooms/`,
  `GET/POST <pk>/tasks/`, `POST <pk>/log-download/`.
- **Permissões:** `lists_view`/`_edit`/`_delete`, `lists_passengers_add`/`_edit`/
  `_remove`, `lists_csv_upload`, `lists_download`.
- **Particularidades:** Soft-delete. `_cleanup_empty_rooms` remove quartos vazios.
  Import CSV detecta delimitador, normaliza cabeçalhos e gera `AuditLog`.

### agencies — Agências e Parceiros
- **Responsabilidade:** CRUD de agências (PF/PJ) e seus membros (usuários vinculados).
- **URL:** `/api/agencies/`
- **Models:** `Agency` (cadastro, financeiro/comissão, PIX; soft-delete),
  `AgencyMember` (vínculo `User`↔`Agency` com função; `unique_together`).
- **Endpoints:** ViewSet CRUD; `GET check-cnpj/`, `POST merge/`,
  `GET/POST <pk>/members/`, `PATCH/DELETE <pk>/members/<id>/`.
- **Permissões:** `agencies_view`/`_edit`/`_delete`. Leitura também liberada a
  quem edita passageiros/listas (pickers precisam consultar). Mexer em membro
  exige `IsAdminUser`.
- **Particularidades:** Soft-delete + merge.

### contracts — Contratos de Viagem
- **Responsabilidade:** Contrato de adesão por viagem (capa do PDF UneWorld).
- **URL:** `/api/contracts/`
- **Models:** `Contract` (agência, lista, contratante = passageiro **ou** dados
  `payer_*`; pacote, totais USD/BRL, câmbio, M2M cláusulas; soft-delete),
  `ContractAccommodationLine`, `ContractGuest`, `ContractInstallment`.
- **Endpoints:** ViewSet CRUD (busca por reserva/pacote/contratante/agência).
- **Permissões:** `contracts_view`/`_edit`/`_delete`.
- **Particularidades:** Soft-delete. Dados da operadora vêm de
  `config_api.OperatingCompany` na geração do PDF.

### itineraries — Roteiros (produto comercial)
- **Responsabilidade:** Roteiro publicável (slug, destinos, conteúdo editorial,
  datas, financeiro). Distinto da Lista de Passageiros operacional.
- **URL:** `/api/itineraries/`
- **Models:** `Itinerary` (slug único autogerado; M2M países/destinos; conteúdo
  editorial longo; aviso colorido; flags; financeiro; soft-delete),
  `ItineraryServiceLine` (serviço intermediado com percentual).
- **Endpoints:** ViewSet CRUD (busca por nome/slug).
- **Permissões:** `roteiros_view`/`_edit`/`_delete`.
- **Particularidades:** Soft-delete. `slug` gerado no `save()` a partir do nome +
  datas, com desambiguação por sufixo. `is_deleted`/`deleted_at` são **read-only**
  no serializer (só mudam via destroy/restore/purge).

### config_api — Catálogos e Listas Configuráveis
- **Responsabilidade:** Todos os cadastros gerenciáveis em Configurações + os
  singletons globais (operadora, termos, sistema, perfis de permissão).
- **URL:** `/api/config/`
- **Models:** ~30. Catálogos simples (profissões, idiomas, gêneros, vacinas,
  carteiras, categorias/destinos de roteiro, feriados, serviços, formas de
  pagamento, câmbio); hierarquia geo `ConfigContinent→Country→State→City`;
  documentos customizáveis (`CustomDocType`/`Field`/`FieldOption`);
  `Airport`/`Airline`/`BusMap`; acomodações/categorias; `ContractClause`;
  `ConfigItineraryTemplate`; `PermissionProfile` (soft-delete); singletons
  `OperatingCompany`/`TermsAndConditions`/`SystemSettings` (via `.get()`).
- **Endpoints:** ViewSets CRUD por catálogo; várias actions `POST import/seed`
  (CBO, mledoze/countries, IBGE, countriesnow, OurAirports, OpenFlights) que rodam
  em background e devolvem `job_id`; geo `analyze/import/export/action`; singletons
  `system-settings/`, `terms/` (GET público — lido na tela de convite),
  `operating-company/`.
- **Permissões:** helper `_settings_perm(base, ...)` monta o gating granular
  (`{base}_view/_edit/_delete/_import_web`), sempre aceitando `manage_settings`.
- **Particularidades:** Importações externas via `dashboard.jobs.run_job`.
  Soft-delete em `PermissionProfile`. Export geo é `StreamingHttpResponse`.

### agenda — Calendário, E-mails Automáticos e Webhooks
- **Responsabilidade:** Calendário de eventos, preferências de notificação,
  e-mails de resumo/lembrete agendados, log de e-mails e webhook da Resend.
- **URL:** `/api/agenda/`
- **Models:** `CalendarPreference` (`OneToOne`; digest, lembretes, horário/fuso,
  datas do último envio), `EmailLog` (tipo, destinatários, HTML, `resend_id`,
  status de entrega/abertura).
- **Endpoints:** `GET events/` (filtrável por lista), `GET/PATCH preferences/`,
  `POST send-now/`, `GET email-log/`, `GET email-log/<pk>/`,
  `POST email-log/<pk>/resend/`, `POST resend-webhook/` (público, assinatura Svix).
- **Permissões:** `calendar_view`; `calendar_view_birthdays`/`_all_deadlines`
  filtram o que aparece; e-mails via `email_log_view`/`_preview`/`email_resend_actions`.
- **Particularidades:** **Scheduler** em thread daemon (verifica a cada 1h,
  respeitando o fuso configurado). Integração Resend para envio e status.
  As coletas de eventos/e-mails filtram `is_deleted=False`.

### dashboard — Estatísticas da Visão Geral
- **Responsabilidade:** Endpoint único com os números da home + as listas
  recentes. Hospeda também a infra de jobs em background (`jobs.py`).
- **URL:** `/api/dashboard/`
- **Models:** nenhum próprio (agrega passageiros, listas, inscrições, câmbio).
- **Endpoints:** `GET ` (`dashboard_stats`).
- **Permissões:** cada bloco condicionado à sua chave
  (`dashboard_view_passengers`/`_lists`/`_enrollments`, `settings_exchange_rates_view`).
- **Particularidades:** Respeita soft-delete em todas as contagens. `run_job` é a
  infra de tarefas em background usada pelo `config_api`.

### audit — Log de Auditoria e Geolocalização
- **Responsabilidade:** Registra e expõe todas as ações (CRUD, login, downloads,
  navegação) com filtragem por escopo/permissão e enriquecimento geográfico do IP.
- **URL:** `/api/audit/`
- **Models:** `AuditLog` (usuário, ação, modelo, `object_id`/`repr`, `changes`
  JSON, IP, geolocalização).
- **Endpoints:** `GET logs/` (ReadOnly, paginado, muitos filtros), `POST page-view/`,
  `POST log-upload/`, `POST log-download/`, `POST refine-login-location/`.
- **Permissões:** `view_audit_log`/`log_view` (global) ou `*_view_logs` por área;
  `log_page_views` para navegação. Sem permissão, vê só as próprias ações.
- **Particularidades:** Geolocalização no `save()` via GeoLite2; login/logout fazem
  reverse-geocode (Nominatim, 1 req/s). `middleware.py` guarda usuário/IP em
  thread-local e **limpa ao fim de cada requisição**.
