# Sistema de Permissões

O acesso é controlado por **permissões granulares**: cada combinação de
*área × ação* é uma chave booleana. Não há "papéis" rígidos no banco — papéis
(Admin, Usuário) são apenas **presets** que ligam/desligam conjuntos de chaves.

## Onde cada coisa vive

| Camada | Arquivo | Papel |
|--------|---------|-------|
| Definição canônica | `backend/users_api/permissions.py` (`PERMISSION_FIELDS`) | lista oficial de todas as chaves |
| Armazenamento | `backend/users_api/models.py` (`UserPermissions`) | um `BooleanField` por chave, `OneToOne` com `User` |
| Aplicação (API) | `RequirePermission('chave', ...)` | gate de cada view/action |
| Exposição | `GET /api/users/me/` (`permissions_dict`) | manda `{chave: bool}` ao frontend |
| Espelho na UI | `frontend/src/utils/permGroups.js` (`PERM_GROUPS`) | agrupa chaves em seções para a tela de gestão |
| Helpers na UI | `frontend/src/utils/permissions.js` (`can`, `canAccess`) | gateiam botões e rotas |

## Como funciona, na prática

1. O usuário loga; o frontend chama `/api/users/me/` e recebe o usuário + o dict
   de permissões.
2. **Superusuário tem tudo** (`is_superuser` → todas as chaves `True`,
   tanto em `permissions_dict` quanto em `has_any_perm`).
3. Na UI, `can('passengers', 'edit')` (ou `can('passengers_edit')`) decide se um
   botão aparece; `canAccess(user, '/passageiros')` decide se a rota é acessível.
4. No backend, a mesma ação é protegida por `RequirePermission('passengers_edit')`.
   **O gating do frontend é só UX** — a autorização real é sempre a do backend.

`has_any_perm(user, *chaves)` libera se o usuário tiver **qualquer** uma das
chaves informadas; `RequirePermission` é a permission class do DRF construída em
cima dele.

## Grupos de permissão (seções da UI)

Definidos em `permGroups.js`, espelham as áreas do sistema:

- Visão Geral · Passageiros · Agências · Contratos · Roteiros ·
  Listas de Passageiros · Calendário · Usuários · Configurações

Dentro de cada grupo há chaves por ação. Convenções de sufixo mais comuns:

| Sufixo | Significado |
|--------|-------------|
| `_view` / `_view_basic` / `_view_full` | leitura (full = campos sensíveis) |
| `_edit` | criar/editar |
| `_delete` | excluir (soft-delete) |
| `_view_logs` | ver o log de auditoria daquela área |
| `_bulk_import` / `_import_web` | importar CSV / semear da internet |
| `_download` / `_upload_docs` / `_download_docs` | ações específicas |

Há também a chave legada `manage_settings` (e `manage_users`), que funcionam como
"atalho" liberando uma área inteira. A direção atual do projeto é **preferir
chaves granulares** — o usuário costuma marcar área por área.

## Staff / acesso ao admin do Django

`STAFF_PERMISSION_FIELDS` + `sync_is_staff()` recalculam `user.is_staff` a partir
das permissões administrativas. Não mexa em `is_staff` na mão.

## ⚠️ Regra de ouro ao adicionar uma permissão nova

Uma chave nova precisa existir em **três** lugares, ou algo quebra:

1. `BooleanField` em `UserPermissions` (`backend/users_api/models.py`) **+ migração**.
   Sem o campo, `permissions_dict`/`has_any_perm` fazem `getattr` que falha e o
   `GET /users/me/` **quebra (500) para não-superusuários**.
2. Entrada em `PERMISSION_FIELDS` (`backend/users_api/permissions.py`).
3. Item em `PERM_GROUPS` (`frontend/src/utils/permGroups.js`), senão a permissão
   fica **invisível** na tela de gestão.

E lembre de aplicar a migração (`makemigrations` + `migrate`) **antes** de testar.

> Verificado nesta auditoria: atualmente front e back estão **sincronizados** —
> toda chave de `permGroups.js` tem campo e entrada correspondentes no backend.
