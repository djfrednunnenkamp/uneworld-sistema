# Guia do Desenvolvedor

## Rodando localmente

Pré-requisitos: Python 3.12+, Node 18+, (opcional) PostgreSQL e Redis.

```bash
# Backend
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env     # preencha SECRET_KEY e demais valores
cd backend && python manage.py migrate && cd ..

# Frontend
cd frontend && npm install && cd ..

# Sobe backend (8000) e frontend (5173) juntos
./start.sh
```

- Backend: <http://localhost:8000> · Frontend: <http://localhost:5173>
- Em dev, sem Redis, o tempo real (WebSocket) pode não funcionar — o resto roda
  normalmente com SQLite.

### Comandos úteis

```bash
# Backend
cd backend
python manage.py check              # checagem do sistema (rode antes de commitar)
python manage.py makemigrations     # gerar migração ao mudar um model
python manage.py migrate            # aplicar — NUNCA deixe migração pendente
python manage.py createsuperuser

# Frontend
cd frontend
npm run dev      # servidor de desenvolvimento
npm run build    # build de produção (pega erros de sintaxe/import)
npm run lint     # eslint
```

## Convenções de código

### Backend (Django/DRF)

- **Permissões:** toda view/action é gateada por `RequirePermission('chave', ...)`
  (libera se o usuário tiver **qualquer** uma das chaves). Veja [PERMISSOES.md](PERMISSOES.md).
- **Soft-delete:** ViewSets de entidades "excluíveis" usam `SoftDeleteViewSetMixin`.
  Ao escrever uma **nova consulta** que toca essas entidades (contagem, e-mail,
  relatório, verificação de duplicidade), **filtre `is_deleted=False`** — é fácil
  esquecer e vazar registros da lixeira.
- **Tempo/Datas:** o projeto usa `USE_TZ=True` / `America/Sao_Paulo`. Use
  `django.utils.timezone` (`timezone.localtime()`), **nunca** `datetime.now()` /
  `date.today()` para lógica sensível a horário (o processo costuma rodar em UTC).
- **username == email** em todo o sistema. Se mudar o e-mail de um usuário,
  sincronize o `username` e valide unicidade.
- Use `get_object_or_404` (não `.get()` cru com `request.data['x']`) ao resolver
  objetos a partir de dados da requisição, para devolver 404/400 em vez de 500.

### Frontend (React)

- **Estilos:** a maioria das páginas usa estilo inline + classes do CSS global
  (`btn`, `btn-outline`, `mbox`, `overlay`, etc.). `Destinations.jsx` usa Tailwind
  e é a exceção (placeholder não roteado).
- **DatePicker obrigatório:** sempre use o componente `DatePicker` (popup), nunca
  `<input type="date">` nativo.
- **Dropdown/picker dentro de modal:** use sempre `createPortal` + `position:fixed`
  (via `getBoundingClientRect`) + `zIndex` alto. Nunca `position:absolute` dentro
  de modal — o picker fica cortado.
- **Datas "YYYY-MM-DD":** `new Date('2026-03-15')` é interpretado como **UTC** e em
  UTC-3 volta um dia ao ler `.getDate()`. Use `new Date(valor + 'T00:00:00')` para
  parse no fuso local (o `DatePicker` já faz isso).
- **Permissões na UI:** use o helper `can(...)`/`canAccess(...)`. Lembre que isso é
  só UX — **a autorização de verdade é no backend**. Não confie no gating do front.

## Padrões recorrentes (reconheça-os no código)

| Padrão | Onde | O que faz |
|--------|------|-----------|
| `SoftDeleteViewSetMixin` | `core/soft_delete.py` | lixeira (destroy/restore/purge) |
| `MergeViewSetMixin` | `core/merge.py` | mesclagem de duplicatas |
| `RequirePermission(...)` | `users_api/permissions.py` | autorização por chave |
| `useWebSocket(scope)` | `hooks/` | refetch silencioso em tempo real |
| `usePersistedTab(key)` | `hooks/` | lembra a aba ativa entre visitas |
| `TrashTab` | `components/` | UI padrão da aba "Excluídos" |
| `DataTable` | `components/` | tabela com busca/ordenação/paginação |
| `run_job(...)` | `dashboard/jobs.py` | tarefa em background com progresso |

## Armadilhas conhecidas (já causaram bugs)

1. **Chave de permissão sem campo no model.** Toda nova chave em
   `PERMISSION_FIELDS` precisa de um `BooleanField` em `UserPermissions` **e** de
   uma migração; senão `/users/me/` quebra (500) para não-superusuários. E precisa
   aparecer em `permGroups.js` para ser visível na UI. Ver [PERMISSOES.md](PERMISSOES.md).
2. **Vazamento de soft-delete.** Consultas que não filtram `is_deleted=False`
   fazem registros "excluídos" reaparecerem em e-mails, calendário e contagens.
3. **Horário ingênuo.** `datetime.now()`/`date.today()` no servidor (UTC) disparam
   e-mails na hora errada. Use `timezone.localtime()`.
4. **`ReferenceError` que o lint não pega.** O build e o eslint nem sempre pegam
   variáveis indefinidas usadas só em runtime. **Carregue a página de verdade**
   (inclusive headless) antes de dizer que está pronto.
5. **Prop errada em componente.** Ex.: `ConfirmModal` usa `onOk` (não `onConfirm`);
   passar a prop errada faz o botão não fazer nada, em silêncio.

## Verificação antes de concluir

1. `cd backend && python manage.py check`
2. `cd frontend && npm run build`
3. Suba o sistema (`./start.sh`) e **carregue de verdade** as telas que você mexeu,
   olhando o console do navegador — consolidando tudo em **uma** passada de teste.
4. Commit e push para a branch **`desenvolver`** (nunca `main`).
