const ROUTE_PERMS = [
  { prefix: '/passageiros', perms: ['passengers_view_basic', 'passengers_view_full'] },
  { prefix: '/agencias',    perms: ['agencies_view'] },
  { prefix: '/viagens',     perms: ['lists_view'] },
  { prefix: '/calendario',  perms: ['calendar_view'] },
  { prefix: '/usuarios',    perms: ['manage_users'] },
  { prefix: '/configuracoes', perms: ['manage_settings'] },
  { prefix: '/log',         perms: ['view_audit_log'] },
]

export function canAccess(user, path) {
  if (!user) return false
  if (user.is_superuser) return true
  const permissions = user.permissions ?? {}
  const rule = ROUTE_PERMS.find(r => path.startsWith(r.prefix))
  if (!rule) return true
  return rule.perms.some(p => permissions[p])
}
