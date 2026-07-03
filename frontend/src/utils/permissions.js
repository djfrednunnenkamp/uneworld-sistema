/* F-02 — Mapa rota → permissões para decidir o que MOSTRAR no menu/rotas.
 * Isto é UX, NÃO segurança: user.permissions vem do backend e é manipulável no
 * cliente. A proteção real de dados é no backend (cada endpoint checa a permissão
 * correspondente). Não usar canAccess() como controle de acesso a dados. */
const ROUTE_PERMS = [
  { prefix: '/passageiros',  perms: ['passengers_view_basic', 'passengers_view_full'] },
  { prefix: '/agencias',     perms: ['agencies_view'] },
  { prefix: '/contratos',    perms: ['contracts_view'] },
  { prefix: '/roteiros',     perms: ['roteiros_view'] },
  { prefix: '/viagens',      perms: ['lists_view'] },
  { prefix: '/calendario',   perms: ['calendar_view'] },
  { prefix: '/usuarios',     perms: ['manage_users', 'users_view', 'users_edit', 'users_delete', 'users_manage_permissions'] },
  { prefix: '/configuracoes', perms: ['manage_settings', 'settings_view', 'settings_professions', 'settings_languages', 'settings_countries', 'settings_genders', 'settings_vaccines', 'settings_doc_types', 'settings_prof_cards', 'settings_list_additionals', 'settings_crew_roles'] },
  // Sem entrada para '/log': qualquer usuário autenticado pode acessar — o
  // backend decide o que ele vê (tudo, uma área específica, ou só o próprio
  // histórico se não tiver nenhuma permissão de log).
]

export function canAccess(user, path) {
  if (!user) return false
  if (user.is_superuser) return true
  // Admin de agência acessa a página Usuários (gerencia os usuários da agência dele).
  if (user.is_agency_admin && path.startsWith('/usuarios')) return true
  const permissions = user.permissions ?? {}
  const rule = ROUTE_PERMS.find(r => path.startsWith(r.prefix))
  if (!rule) return true
  return rule.perms.some(p => permissions[p])
}
