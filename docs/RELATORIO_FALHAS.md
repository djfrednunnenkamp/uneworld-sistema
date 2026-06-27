# Relatório de Falhas Encontradas e Corrigidas

Auditoria de lógica do código (backend + frontend) realizada em **27/06/2026**.
Foram encontradas e **corrigidas 19 falhas**. Abaixo, cada uma com gravidade,
arquivo, o problema e a correção aplicada.

Legenda de gravidade: 🔴 Crítica · 🟠 Alta · 🟡 Média · ⚪ Baixa

---

## Backend

### 🔴 1. `accept_invite` quebrava (500) ao criar usuário novo
- **Arquivo:** `backend/users_api/views.py`
- **Problema:** usava `User.objects.get_or_create(email__iexact=..., defaults=...)`.
  `email__iexact` é um *lookup*, não um campo do model — no ramo de **criação** o
  Django passava isso ao construtor do `User` e estourava `TypeError/FieldError`.
  Qualquer aceite de convite sem User pré-existente dava 500.
- **Correção:** busca com `filter(email__iexact=...).first()` e, se não existir,
  instancia `User(username=..., email=...)` manualmente.

### 🔴 2. Passageiros na lixeira vazavam em e-mails, calendário e contagens
- **Arquivos:** `backend/agenda/services.py`, `backend/agenda/scheduler.py`,
  `backend/dashboard/views.py`
- **Problema:** passageiros/listas usam soft-delete (não saem do banco), e várias
  consultas de aniversários, prazos, tarefas e contagem de inscrições **não
  filtravam `is_deleted`**. Resultado: passageiros "excluídos" geravam e-mail de
  aniversário, apareciam no calendário e inflavam o total de inscrições.
- **Correção:** adicionado `is_deleted=False` (passageiros) e
  `passenger_list__is_deleted=False` / `exclude(passenger__is_deleted=True)`
  (inscrições/tarefas) em todas essas consultas.

### 🟠 3. Soft-delete do roteiro podia ser furado por PATCH
- **Arquivo:** `backend/itineraries/serializers.py`
- **Problema:** `is_deleted`/`deleted_at` eram graváveis no `ItinerarySerializer`.
  Um usuário com apenas `roteiros_edit` podia mandar um roteiro pra lixeira (ou
  restaurá-lo) via `PATCH`, contornando a regra de que exclusão/restauração é de
  superusuário.
- **Correção:** `read_only_fields = ['slug', 'created_at', 'updated_at',
  'is_deleted', 'deleted_at']`. Essas flags só mudam via destroy/restore/purge.

### 🟠 4. Admin podia atribuir e-mail duplicado e travar o login
- **Arquivo:** `backend/users_api/views.py` (`user_update`)
- **Problema:** ao editar um usuário, o e-mail era gravado **sem checar
  unicidade** e **sem sincronizar o `username`**. Dois usuários com o mesmo e-mail
  faziam o login (`get(email__iexact=...)`) estourar `MultipleObjectsReturned`,
  trancando ambos para fora.
- **Correção:** normaliza (`.strip().lower()`), rejeita e-mail já em uso por outra
  conta e mantém `username == email`.

### 🟠 5. `dashboard_stats` ignorava as permissões dos cards
- **Arquivo:** `backend/dashboard/views.py`
- **Problema:** o endpoint só exigia `IsAuthenticated`. Qualquer autenticado
  conseguia ler total de passageiros, listas abertas, inscrições e listas
  recentes chamando a API direto — as permissões `dashboard_view_*` só eram
  aplicadas no frontend.
- **Correção:** cada bloco (stats, listas recentes, câmbio) agora é condicionado à
  sua permissão no backend, espelhando o gating da UI.

### 🟠 6. Scheduler usava horário ingênuo (fuso errado)
- **Arquivo:** `backend/agenda/scheduler.py`
- **Problema:** `date.today()` / `datetime.now()` usam o horário local do processo
  (UTC em container), então os e-mails de resumo/lembrete disparavam na hora
  errada e podiam virar o dia no momento errado perto da meia-noite.
- **Correção:** passou a usar `timezone.localtime()` (fuso `America/Sao_Paulo`).

### 🟡 7. PATCH de inscrição podia estourar 500 (constraint única)
- **Arquivo:** `backend/trips/views.py` (`manage_passenger`)
- **Problema:** ao vincular/trocar o passageiro de uma inscrição não havia checagem
  de duplicidade; se o passageiro já estivesse na lista, o `save()` violava
  `unique_together(lista, passageiro)` → 500.
- **Correção:** verifica `pl.list_enrollments.filter(passenger=p).exclude(pk=e.pk)`
  e devolve 400 ("Este passageiro já está nesta lista.").

### 🟡 8. Middleware de auditoria atribuía ações ao usuário errado
- **Arquivo:** `backend/audit/middleware.py`
- **Problema:** usuário/IP eram guardados em thread-local mas **nunca limpos**.
  Threads de worker são reaproveitadas, então uma requisição podia herdar o
  usuário/IP da anterior e registrar a ação no log com o ator errado.
- **Correção:** `try/finally` que zera `_local.user`/`_local.ip` ao fim de cada
  requisição.

### 🟡 9. Webhook tratava atraso de entrega como "não entregue"
- **Arquivo:** `backend/agenda/views.py` (`resend_webhook_view`)
- **Problema:** `email.delivery_delayed` era mapeado para status `bounced`. Um
  atraso **não** é um bounce — a Resend ainda tenta reentregar; e-mails que
  chegariam normalmente ficavam rotulados como "Não entregue".
- **Correção:** só `email.bounced` (e `complained`) marcam como `bounced`; atraso
  é ignorado.

### 🟡 10. Merge sobrescrevia o `full_name` escolhido
- **Arquivo:** `backend/core/merge.py`
- **Problema:** ao mesclar passageiros, se o usuário escolhia o `full_name` de um
  perdedor mas mantinha o nome do vencedor, `Passenger.save()` recalculava
  `full_name` a partir de `first_name`/`last_name`, descartando a escolha.
- **Correção:** após o `save()`, os valores escolhidos campo a campo são
  reafirmados via `update()` (que não passa pela derivação do `save()`).

### ⚪ 11. Buscas de duplicidade encontravam registros na lixeira
- **Arquivos:** `backend/passengers/views.py` (`check-cpf`),
  `backend/agencies/views.py` (`check-cnpj`), `backend/trips/views.py` (import CSV)
- **Problema:** as verificações de CPF/CNPJ e o match do import CSV não filtravam
  `is_deleted=False`, então apontavam para (ou religavam a) cadastros excluídos.
- **Correção:** `is_deleted=False` adicionado a essas consultas.

### ⚪ 12. `perform_create` retornava 500 em vez de 400/404
- **Arquivo:** `backend/config_api/views.py` (DocField, DocFieldOption, City, State)
- **Problema:** liam `self.request.data['x_id']` com `Model.objects.get(...)` cru;
  chave ausente ou id inválido viravam 500.
- **Correção:** `get_object_or_404(Model, pk=self.request.data.get('x_id'))`.

### ⚪ 13. `forgot_password` enviava link para conta desativada
- **Arquivo:** `backend/users_api/views.py`
- **Problema:** não filtrava `is_active`; usuários soft-deletados (desativados)
  ainda recebiam o e-mail de reset.
- **Correção:** `get(email__iexact=email, is_active=True)`.

### ⚪ 14. `restore`/`purge` agiam sobre itens não excluídos
- **Arquivo:** `backend/core/soft_delete.py`
- **Problema:** restaurar/purgar usavam `objects.get(pk=pk)` sem exigir
  `is_deleted=True`, permitindo purgar (apagar de vez) um item que nem estava na
  lixeira.
- **Correção:** `get_object_or_404(model, pk=pk, is_deleted=True)`.

---

## Frontend

### 🟠 15. Botão de excluir pendência não fazia nada
- **Arquivo:** `frontend/src/pages/TripDetail.jsx` (`PendenciesPanel`)
- **Problema:** o `ConfirmModal` recebia `onConfirm={handleDelete}`, mas o
  componente só chama `onOk`. Confirmar a exclusão chamava `undefined` — nada era
  removido e o modal ficava aberto.
- **Correção:** `onOk={handleDelete}`.

### 🟠 16. Aniversário marcado no dia errado (fuso)
- **Arquivo:** `frontend/src/utils/listFormat.js` (`hasBirthdayInTrip`)
- **Problema:** `new Date('YYYY-MM-DD')` é interpretado como UTC; em UTC-3 o
  `.getDate()` volta um dia. O marcador 🎂 nas listas (PDF/HTML) caía no dia errado.
- **Correção:** parse com `new Date(valor + 'T00:00:00')` (fuso local), igual ao
  `DatePicker`.

### 🟡 17. Campos de texto do roteiro editáveis sem permissão
- **Arquivos:** `frontend/src/components/RichTextEditor.jsx`,
  `frontend/src/pages/ItineraryDetail.jsx`
- **Problema:** todos os inputs simples respeitavam `disabled={!canEdit}`, mas os
  ~13 editores de texto rico não tinham como ser desabilitados — um usuário sem
  `roteiros_edit` conseguia digitar neles (embora o Salvar fosse oculto).
- **Correção:** `RichTextEditor` agora aceita `disabled` (modo `readonly` do
  Jodit); todas as instâncias recebem `disabled={!canEdit}`.

### ⚪ 18. Contadores `0` invisíveis no resultado da importação CSV
- **Arquivo:** `frontend/src/pages/TripDetail.jsx` (`Chip`)
- **Problema:** `if (!value) return null` escondia o número `0` ("Adicionados 0",
  "Erros 0"), deixando o painel de resultado em branco.
- **Correção:** o guard passou a esconder só `null`/`undefined`/`''`, exibindo `0`.

### ⚪ 19. Handler de foco morto + entrada de mapa de nacionalidade
- **Arquivo:** `frontend/src/pages/TripDetail.jsx`, `frontend/src/utils/listFormat.js`
- **Problema:** `onFocus2` (prop inexistente) nunca aplicava o destaque de borda;
  e havia uma chave morta (`BRASILEIR`) no mapa de nacionalidade.
- **Correção:** destaque movido para `onFocus`/`onBlur` reais; chave morta
  removida. (Também: `fmtDiet` ganhou optional chaining defensivo.)

---

## Verificação

- `cd backend && python manage.py check` → sem problemas.
- `cd frontend && npm run build` → build OK (1076 módulos transformados).
