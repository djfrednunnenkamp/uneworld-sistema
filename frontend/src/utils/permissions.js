const ROUTE_PERMS = [
  { prefix: '/passageiros',  perms: ['passengers_view_basic', 'passengers_view_full'] },
  { prefix: '/agencias',     perms: ['agencies_view'] },
  { prefix: '/viagens',      perms: ['lists_view'] },
  { prefix: '/calendario',   perms: ['calendar_view'] },
  { prefix: '/usuarios',     perms: ['manage_users', 'users_view', 'users_edit', 'users_delete', 'users_manage_permissions'] },
  { prefix: '/configuracoes', perms: ['manage_settings', 'settings_view', 'settings_professions', 'settings_languages', 'settings_countries', 'settings_genders', 'settings_vaccines', 'settings_doc_types', 'settings_prof_cards', 'settings_destinations', 'settings_list_additionals', 'settings_crew_roles'] },
  // Sem entrada para '/log': qualquer usuário autenticado pode acessar — o
  // backend decide o que ele vê (tudo, uma área específica, ou só o próprio
  // histórico se não tiver nenhuma permissão de log).
]

export function canAccess(user, path) {
  if (!user) return false
  if (user.is_superuser) return true
  const permissions = user.permissions ?? {}
  const rule = ROUTE_PERMS.find(r => path.startsWith(r.prefix))
  if (!rule) return true
  return rule.perms.some(p => permissions[p])
}
