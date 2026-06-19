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
        label: 'Acesso global',
        items: [
          ['settings_view',       'Acessar a aba Configurações'],
          ['settings_csv_import', 'Importar CSV global'],
          ['settings_csv_export', 'Exportar CSV global'],
        ],
      },
      {
        label: 'Documentos',
        items: [
          ['settings_doc_types_view',         'Ver tipos de documento'],
          ['settings_doc_types_edit',         'Criar / Editar tipos de documento'],
          ['settings_doc_types_delete',       'Excluir tipos de documento'],
          ['settings_doc_types_bulk_delete',  'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Perfis de permissão',
        items: [
          ['settings_user_profiles_view',   'Ver perfis de permissão'],
          ['settings_user_profiles_edit',   'Criar / Editar perfis de permissão'],
          ['settings_user_profiles_delete', 'Excluir perfis de permissão'],
        ],
      },
      {
        label: 'Profissões',
        items: [
          ['settings_professions_view',        'Ver profissões'],
          ['settings_professions_edit',        'Criar / Editar profissões'],
          ['settings_professions_delete',      'Excluir profissões'],
          ['settings_professions_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Idiomas',
        items: [
          ['settings_languages_view',        'Ver idiomas'],
          ['settings_languages_edit',        'Criar / Editar idiomas'],
          ['settings_languages_delete',      'Excluir idiomas'],
          ['settings_languages_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Vacinas',
        items: [
          ['settings_vaccines_view',        'Ver vacinas'],
          ['settings_vaccines_edit',        'Criar / Editar vacinas'],
          ['settings_vaccines_delete',      'Excluir vacinas'],
          ['settings_vaccines_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Gêneros',
        items: [
          ['settings_genders_view',        'Ver gêneros'],
          ['settings_genders_edit',        'Criar / Editar gêneros'],
          ['settings_genders_delete',      'Excluir gêneros'],
          ['settings_genders_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Carteiras profissionais',
        items: [
          ['settings_prof_cards_view',        'Ver carteiras profissionais'],
          ['settings_prof_cards_edit',        'Criar / Editar carteiras profissionais'],
          ['settings_prof_cards_delete',      'Excluir carteiras profissionais'],
          ['settings_prof_cards_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Adicionais de lista',
        items: [
          ['settings_list_additionals_view',        'Ver itens adicionais de lista'],
          ['settings_list_additionals_edit',        'Criar / Editar itens adicionais de lista'],
          ['settings_list_additionals_delete',      'Excluir itens adicionais de lista'],
          ['settings_list_additionals_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Equipe técnica',
        items: [
          ['settings_crew_roles_view',        'Ver funções de tripulante'],
          ['settings_crew_roles_edit',        'Criar / Editar funções de tripulante'],
          ['settings_crew_roles_delete',      'Excluir funções de tripulante'],
          ['settings_crew_roles_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Tipos de Acomodação',
        items: [
          ['settings_accommodations_view',        'Ver tipos de acomodação'],
          ['settings_accommodations_edit',        'Criar / Editar tipos de acomodação'],
          ['settings_accommodations_delete',      'Excluir tipos de acomodação'],
          ['settings_accommodations_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Categoria de Acomodações',
        items: [
          ['settings_list_categories_view',        'Ver categorias de acomodação'],
          ['settings_list_categories_edit',        'Criar / Editar categorias de acomodação'],
          ['settings_list_categories_delete',      'Excluir categorias de acomodação'],
          ['settings_list_categories_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Países & Estados',
        items: [
          ['settings_countries_view',        'Ver países e estados'],
          ['settings_countries_edit',        'Criar / Editar países, estados e cidades'],
          ['settings_countries_delete',      'Excluir países, estados e cidades'],
          ['settings_countries_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Aeroportos',
        items: [
          ['settings_airports_view',        'Ver aeroportos'],
          ['settings_airports_edit',        'Criar / Editar aeroportos'],
          ['settings_airports_delete',      'Excluir aeroportos'],
          ['settings_airports_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Companhias Aéreas',
        items: [
          ['settings_airlines_view',        'Ver companhias aéreas'],
          ['settings_airlines_edit',        'Criar / Editar companhias aéreas'],
          ['settings_airlines_delete',      'Excluir companhias aéreas'],
          ['settings_airlines_bulk_delete', 'Exclusão em massa via CSV'],
        ],
      },
      {
        label: 'Mapas de Ônibus',
        items: [
          ['settings_bus_maps_view',   'Ver mapas de ônibus'],
          ['settings_bus_maps_edit',   'Criar / Editar mapas de ônibus'],
          ['settings_bus_maps_delete', 'Excluir mapas de ônibus'],
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

  settings_doc_types_view:        'settings_view',
  settings_doc_types_edit:        'settings_doc_types_view',
  settings_doc_types_delete:      'settings_doc_types_view',
  settings_doc_types_bulk_delete: 'settings_doc_types_delete',

  settings_user_profiles_view:   'settings_view',
  settings_user_profiles_edit:   'settings_user_profiles_view',
  settings_user_profiles_delete: 'settings_user_profiles_view',

  settings_professions_view:        'settings_view',
  settings_professions_edit:        'settings_professions_view',
  settings_professions_delete:      'settings_professions_view',
  settings_professions_bulk_delete: 'settings_professions_delete',

  settings_languages_view:        'settings_view',
  settings_languages_edit:        'settings_languages_view',
  settings_languages_delete:      'settings_languages_view',
  settings_languages_bulk_delete: 'settings_languages_delete',

  settings_vaccines_view:        'settings_view',
  settings_vaccines_edit:        'settings_vaccines_view',
  settings_vaccines_delete:      'settings_vaccines_view',
  settings_vaccines_bulk_delete: 'settings_vaccines_delete',

  settings_genders_view:        'settings_view',
  settings_genders_edit:        'settings_genders_view',
  settings_genders_delete:      'settings_genders_view',
  settings_genders_bulk_delete: 'settings_genders_delete',

  settings_prof_cards_view:        'settings_view',
  settings_prof_cards_edit:        'settings_prof_cards_view',
  settings_prof_cards_delete:      'settings_prof_cards_view',
  settings_prof_cards_bulk_delete: 'settings_prof_cards_delete',

  settings_list_additionals_view:        'settings_view',
  settings_list_additionals_edit:        'settings_list_additionals_view',
  settings_list_additionals_delete:      'settings_list_additionals_view',
  settings_list_additionals_bulk_delete: 'settings_list_additionals_delete',

  settings_crew_roles_view:        'settings_view',
  settings_crew_roles_edit:        'settings_crew_roles_view',
  settings_crew_roles_delete:      'settings_crew_roles_view',
  settings_crew_roles_bulk_delete: 'settings_crew_roles_delete',

  settings_accommodations_view:        'settings_view',
  settings_accommodations_edit:        'settings_accommodations_view',
  settings_accommodations_delete:      'settings_accommodations_view',
  settings_accommodations_bulk_delete: 'settings_accommodations_delete',

  settings_list_categories_view:        'settings_view',
  settings_list_categories_edit:        'settings_list_categories_view',
  settings_list_categories_delete:      'settings_list_categories_view',
  settings_list_categories_bulk_delete: 'settings_list_categories_delete',

  settings_countries_view:        'settings_view',
  settings_countries_edit:        'settings_countries_view',
  settings_countries_delete:      'settings_countries_view',
  settings_countries_bulk_delete: 'settings_countries_delete',

  settings_airports_view:        'settings_view',
  settings_airports_edit:        'settings_airports_view',
  settings_airports_delete:      'settings_airports_view',
  settings_airports_bulk_delete: 'settings_airports_delete',

  settings_airlines_view:        'settings_view',
  settings_airlines_edit:        'settings_airlines_view',
  settings_airlines_delete:      'settings_airlines_view',
  settings_airlines_bulk_delete: 'settings_airlines_delete',

  settings_bus_maps_view:   'settings_view',
  settings_bus_maps_edit:   'settings_bus_maps_view',
  settings_bus_maps_delete: 'settings_bus_maps_view',

  // CSV buttons appear only when at least one section view/edit perm is active
  settings_csv_export: [
    'settings_doc_types_view', 'settings_professions_view', 'settings_languages_view',
    'settings_vaccines_view', 'settings_genders_view', 'settings_prof_cards_view',
    'settings_list_additionals_view', 'settings_crew_roles_view', 'settings_list_categories_view',
    'settings_accommodations_view', 'settings_countries_view',
    'settings_airports_view', 'settings_airlines_view',
  ],
  settings_csv_import: [
    'settings_doc_types_edit', 'settings_professions_edit', 'settings_languages_edit',
    'settings_vaccines_edit', 'settings_genders_edit', 'settings_prof_cards_edit',
    'settings_list_additionals_edit', 'settings_crew_roles_edit', 'settings_list_categories_edit',
    'settings_accommodations_edit', 'settings_countries_edit',
    'settings_airports_edit', 'settings_airlines_edit',
  ],

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
    const satisfied = Array.isArray(baseKey)
      ? baseKey.some(k => out[k])
      : out[baseKey]
    if (!satisfied) out[depKey] = false
  }
  return out
}

export const applyPermChanges = (permissions, changes) => sanitizePerms({ ...permissions, ...changes })
