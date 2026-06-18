export const PERM_GROUPS = [
  {
    title: 'Visão Geral',
    icon: 'grid',
    sections: [
      {
        label: 'Dashboard',
        items: [
          ['dashboard_view_passengers',  'Ver total de passageiros'],
          ['dashboard_view_lists',       'Ver total de listas abertas'],
          ['dashboard_view_enrollments', 'Ver total de inscrições'],
        ],
      },
      {
        label: 'Log de E-mails',
        items: [
          ['email_log_view',       'Ver e-mails enviados pelo sistema'],
          ['email_log_preview',    'Clicar para visualizar conteúdo do e-mail'],
          ['email_resend_actions', 'Reenviar redefinição de senha / convite'],
        ],
      },
    ],
  },
  {
    title: 'Passageiros',
    icon: 'users',
    items: [
      ['passengers_view_basic',    'Ver dados básicos'],
      ['passengers_view_full',     'Ver dados completos (sensíveis)'],
      ['passengers_edit',          'Criar / Editar'],
      ['passengers_delete',        'Excluir'],
      ['passengers_download_docs', 'Baixar documentos'],
      ['passengers_upload_docs',   'Enviar documentos'],
      ['passengers_view_logs',     'Ver log de atividades do passageiro'],
    ],
  },
  {
    title: 'Agências',
    icon: 'building',
    items: [
      ['agencies_view',      'Ver agências'],
      ['agencies_edit',      'Criar / Editar'],
      ['agencies_delete',    'Excluir'],
      ['agencies_view_logs', 'Ver log de atividades da agência'],
    ],
  },
  {
    title: 'Listas de Passageiros',
    icon: 'plane',
    sections: [
      {
        label: 'Geral',
        items: [
          ['lists_view',       'Ver listas'],
          ['lists_edit',       'Criar / Editar'],
          ['lists_delete',     'Excluir lista'],
          ['lists_view_logs',  'Ver log de atividades da lista'],
          ['lists_download',   'Baixar / exportar lista'],
          ['lists_csv_upload', 'Importar passageiros via CSV'],
        ],
      },
      {
        label: 'Passageiros na lista',
        items: [
          ['lists_passengers_add',    'Adicionar passageiro à lista'],
          ['lists_passengers_edit',   'Editar passageiro na lista'],
          ['lists_passengers_remove', 'Remover passageiro da lista'],
        ],
      },
    ],
  },
  {
    title: 'Calendário',
    icon: 'calendar',
    items: [
      ['calendar_view',               'Acessar o calendário'],
      ['calendar_view_birthdays',     'Ver aniversários de passageiros'],
      ['calendar_view_all_deadlines', 'Ver prazos de confirmação de todos os usuários'],
    ],
  },
  {
    title: 'Usuários',
    icon: 'users',
    items: [
      ['users_view',               'Ver lista de usuários'],
      ['users_edit',               'Criar / Editar usuários'],
      ['users_block',              'Bloquear / Desbloquear usuários'],
      ['users_delete',             'Excluir usuários permanentemente'],
      ['users_manage_permissions', 'Gerenciar permissões'],
      ['users_set_password',       'Definir senha via admin'],
    ],
  },
  {
    title: 'Configurações',
    icon: 'settings',
    sections: [
      {
        label: 'Acesso',
        items: [
          ['settings_view', 'Acessar página de configurações'],
        ],
      },
      {
        label: 'Categorias',
        items: [
          ['settings_professions',      'Profissões'],
          ['settings_languages',        'Idiomas'],
          ['settings_countries',        'Países e Estados'],
          ['settings_genders',          'Gêneros'],
          ['settings_vaccines',         'Vacinas'],
          ['settings_doc_types',        'Tipos de documento'],
          ['settings_prof_cards',       'Carteiras profissionais'],
          ['settings_user_profiles',    'Perfis de permissão'],
          ['settings_destinations',     'Destinos de viagem'],
          ['settings_list_additionals', 'Itens adicionais de lista'],
          ['settings_crew_roles',       'Funções de tripulante'],
        ],
      },
    ],
  },
  {
    title: 'Log do Sistema',
    icon: 'list',
    sections: [
      {
        label: 'Acesso',
        items: [
          ['log_view', 'Ver log do sistema'],
        ],
      },
      {
        label: 'Por área',
        items: [
          ['log_passengers', 'Passageiros'],
          ['log_lists',      'Listas de passageiros'],
          ['log_agencies',   'Agências'],
          ['log_users',      'Usuários'],
          ['log_settings',   'Configurações'],
        ],
      },
    ],
  },
]

export const PERM_DEPENDENCIES = {
  passengers_view_full:     'passengers_view_basic',
  passengers_edit:          'passengers_view_full',
  passengers_delete:        'passengers_view_basic',
  passengers_download_docs: 'passengers_view_full',
  passengers_upload_docs:   'passengers_view_full',
  passengers_view_logs:     'passengers_view_basic',

  lists_edit:              'lists_view',
  lists_delete:            'lists_view',
  lists_view_logs:         'lists_view',
  lists_download:          'lists_view',
  lists_csv_upload:        'lists_view',
  lists_passengers_add:    'lists_view',
  lists_passengers_edit:   'lists_view',
  lists_passengers_remove: 'lists_view',

  agencies_edit:      'agencies_view',
  agencies_delete:    'agencies_view',
  agencies_view_logs: 'agencies_view',

  calendar_view_birthdays:     'calendar_view',
  calendar_view_all_deadlines: 'calendar_view',

  email_log_preview:    'email_log_view',
  email_resend_actions: 'email_log_preview',

  users_edit:               'users_view',
  users_block:              'users_view',
  users_delete:             'users_view',
  users_manage_permissions: 'users_view',
  users_set_password:       'users_view',

  settings_professions:      'settings_view',
  settings_languages:        'settings_view',
  settings_countries:        'settings_view',
  settings_genders:          'settings_view',
  settings_vaccines:         'settings_view',
  settings_doc_types:        'settings_view',
  settings_prof_cards:       'settings_view',
  settings_user_profiles:    'settings_view',
  settings_destinations:     'settings_view',
  settings_list_additionals: 'settings_view',
  settings_crew_roles:       'settings_view',

  log_passengers: 'log_view',
  log_lists:      'log_view',
  log_agencies:   'log_view',
  log_users:      'log_view',
  log_settings:   'log_view',
}

export const groupItems = g => g.items ?? g.sections.flatMap(s => s.items)

export const ALL_PERM_KEYS = PERM_GROUPS.flatMap(g => groupItems(g).map(([k]) => k))

const ADMIN_TITLES    = ['Usuários', 'Configurações', 'Log do Sistema']
export const ADMIN_PERM_KEYS = PERM_GROUPS
  .filter(g => ADMIN_TITLES.includes(g.title))
  .flatMap(g => groupItems(g).map(([k]) => k))

export const EMPTY_PERMISSIONS = Object.fromEntries(ALL_PERM_KEYS.map(k => [k, false]))
export const PRESET_ADMIN      = Object.fromEntries(ALL_PERM_KEYS.map(k => [k, true]))
const PRESET_USER_OFF          = ['calendar_view_all_deadlines']
export const PRESET_USER       = Object.fromEntries(ALL_PERM_KEYS.map(k => [k, !ADMIN_PERM_KEYS.includes(k) && !PRESET_USER_OFF.includes(k)]))

export const sanitizePerms = perms => {
  const out = { ...perms }
  for (const [depKey, baseKey] of Object.entries(PERM_DEPENDENCIES)) {
    if (!out[baseKey]) out[depKey] = false
  }
  return out
}

export const applyPermChanges = (permissions, changes) => sanitizePerms({ ...permissions, ...changes })
