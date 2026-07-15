## Guia obrigatório de arquitetura e design

Antes de implementar ou modificar qualquer funcionalidade, leia o guia oficial do sistema:

`Uni_Front/docs/SYSTEM_DESIGN_GUIDE.md`  *(vive no repositório do front-end; caminho relativo ao workspace `UneWorld System/`)*

Esse arquivo contém os padrões oficiais do sistema (front-end **e** back-end): arquitetura das apps Django, convenções de models/serializers/views, sistema de permissões (`users_api/permissions.py`, `_settings_perm`, `has_any_perm`, escopo de agência), padrões de API, tratamento de erros, auditoria, segurança e o checklist obrigatório.

Pontos-chave do back-end (detalhes no guia):
- Autenticação por **sessão/cookie** (sem JWT); permissão padrão `IsAuthenticated`.
- **Soft-delete** padrão (`core/soft_delete.py`); auditoria automática por signals (`audit/`).
- Permissões booleanas por chave em `UserPermissions`; **nunca** confiar no front — revalidar no back.
- Dinheiro sempre `Decimal`; `itineraries/pricing.py` é a fonte da verdade.

Sempre reutilize os padrões registrados no guia. Quando um novo padrão oficial for criado, atualize o documento.
