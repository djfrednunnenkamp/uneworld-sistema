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
    title: 'Contratos',
    icon: 'docs',
    items: [
      ['contracts_view',   'Ver contratos'],
      ['contracts_edit',   'Criar / Editar'],
      ['contracts_delete', 'Excluir'],
    ],
  },
  {
    title: 'Roteiros',
    icon: 'mapicon',
    items: [
      ['roteiros_view',   'Ver roteiros'],
      ['roteiros_edit',   'Criar / Editar'],
      ['roteiros_delete', 'Excluir'],
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
      ['users_view_logs',          'Ver log de atividades de usuários'],
      ['log_page_views',           'Ver páginas visitadas e botões clicados pelos usuários'],
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
          ['settings_view_logs',  'Ver log de atividades de Configurações'],
        ],
      },
      // A partir daqui, mesma ordem alfabética (e mesmo ícone) dos cards da página Configurações
      {
        label: 'Adicionais de lista', icon: 'listplus', hue: 260,
        items: [
          ['settings_list_additionals_view',        'Ver itens adicionais de lista'],
          ['settings_list_additionals_edit',        'Criar / Editar itens adicionais de lista'],
          ['settings_list_additionals_delete',      'Excluir itens adicionais de lista'],
          ['settings_list_additionals_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_list_additionals_bulk_import', 'Importação em massa via CSV'],
        ],
      },
      {
        label: 'Aeroportos', icon: 'plane', hue: 218,
        items: [
          ['settings_airports_view',        'Ver aeroportos'],
          ['settings_airports_edit',        'Criar / Editar aeroportos'],
          ['settings_airports_delete',      'Excluir aeroportos'],
          ['settings_airports_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_airports_bulk_import', 'Importação em massa via CSV'],
          ['settings_airports_import_web',  'Importar base mundial da internet'],
        ],
      },
      {
        label: 'Carteiras profissionais', icon: 'card', hue: 285,
        items: [
          ['settings_prof_cards_view',        'Ver carteiras profissionais'],
          ['settings_prof_cards_edit',        'Criar / Editar carteiras profissionais'],
          ['settings_prof_cards_delete',      'Excluir carteiras profissionais'],
          ['settings_prof_cards_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_prof_cards_bulk_import', 'Importação em massa via CSV'],
          ['settings_prof_cards_import_web',  'Importar lista pronta da internet'],
        ],
      },
      {
        label: 'Categoria de Acomodações', icon: 'grid', hue: 300,
        items: [
          ['settings_list_categories_view',        'Ver categorias de acomodação'],
          ['settings_list_categories_edit',        'Criar / Editar categorias de acomodação'],
          ['settings_list_categories_delete',      'Excluir categorias de acomodação'],
          ['settings_list_categories_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_list_categories_bulk_import', 'Importação em massa via CSV'],
        ],
      },
      {
        label: 'Cláusulas de Contrato', icon: 'docs', hue: 70,
        items: [
          ['settings_contract_clauses_view',   'Ver cláusulas de contrato'],
          ['settings_contract_clauses_edit',   'Criar / Editar cláusulas de contrato'],
          ['settings_contract_clauses_delete', 'Excluir cláusulas de contrato'],
        ],
      },
      {
        label: 'Formas de Pagamento', icon: 'card', hue: 200,
        items: [
          ['settings_payment_methods_view',   'Ver formas de pagamento'],
          ['settings_payment_methods_edit',   'Criar / Editar formas de pagamento'],
          ['settings_payment_methods_delete', 'Excluir formas de pagamento'],
        ],
      },
      {
        label: 'Câmbio', icon: 'globe', hue: 160,
        items: [
          ['settings_exchange_rates_view',   'Ver câmbio'],
          ['settings_exchange_rates_edit',   'Criar / Editar câmbio'],
          ['settings_exchange_rates_delete', 'Excluir câmbio'],
        ],
      },
      {
        label: 'Companhias Aéreas', icon: 'ticket', hue: 195,
        items: [
          ['settings_airlines_view',        'Ver companhias aéreas'],
          ['settings_airlines_edit',        'Criar / Editar companhias aéreas'],
          ['settings_airlines_delete',      'Excluir companhias aéreas'],
          ['settings_airlines_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_airlines_bulk_import', 'Importação em massa via CSV'],
          ['settings_airlines_import_web',  'Importar base mundial da internet'],
        ],
      },
      {
        label: 'Documentos', icon: 'docs', hue: 230,
        items: [
          ['settings_doc_types_view',         'Ver tipos de documento'],
          ['settings_doc_types_edit',         'Criar / Editar tipos de documento'],
          ['settings_doc_types_delete',       'Excluir tipos de documento'],
          ['settings_doc_types_bulk_delete',  'Exclusão em massa via CSV'],
          ['settings_doc_types_bulk_import',  'Importação em massa via CSV'],
        ],
      },
      {
        label: 'Equipe técnica', icon: 'wrench', hue: 165,
        items: [
          ['settings_crew_roles_view',        'Ver funções de tripulante'],
          ['settings_crew_roles_edit',        'Criar / Editar funções de tripulante'],
          ['settings_crew_roles_delete',      'Excluir funções de tripulante'],
          ['settings_crew_roles_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_crew_roles_bulk_import', 'Importação em massa via CSV'],
        ],
      },
      {
        label: 'Gêneros', icon: 'gender', hue: 340,
        items: [
          ['settings_genders_view',        'Ver gêneros'],
          ['settings_genders_edit',        'Criar / Editar gêneros'],
          ['settings_genders_delete',      'Excluir gêneros'],
          ['settings_genders_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_genders_bulk_import', 'Importação em massa via CSV'],
        ],
      },
      {
        label: 'Idiomas', icon: 'globe', hue: 150,
        items: [
          ['settings_languages_view',        'Ver idiomas'],
          ['settings_languages_edit',        'Criar / Editar idiomas'],
          ['settings_languages_delete',      'Excluir idiomas'],
          ['settings_languages_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_languages_bulk_import', 'Importação em massa via CSV'],
          ['settings_languages_import_web',  'Importar lista pronta da internet'],
        ],
      },
      {
        label: 'Mapas de Ônibus', icon: 'mapicon', hue: 45,
        items: [
          ['settings_bus_maps_view',   'Ver mapas de ônibus'],
          ['settings_bus_maps_edit',   'Criar / Editar mapas de ônibus'],
          ['settings_bus_maps_delete', 'Excluir mapas de ônibus'],
        ],
      },
      {
        label: 'Países & Estados', icon: 'pin', hue: 130,
        items: [
          ['settings_countries_view',        'Ver países e estados'],
          ['settings_countries_edit',        'Criar / Editar países, estados e cidades'],
          ['settings_countries_delete',      'Excluir países, estados e cidades'],
          ['settings_countries_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_countries_bulk_import', 'Importação em massa via CSV'],
          ['settings_countries_import_web',  'Importar países / estados / cidades da internet'],
        ],
      },
      {
        label: 'Perfis de permissão', icon: 'shield', hue: 252,
        items: [
          ['settings_user_profiles_view',   'Ver perfis de permissão'],
          ['settings_user_profiles_edit',   'Criar / Editar perfis de permissão'],
          ['settings_user_profiles_delete', 'Excluir perfis de permissão'],
        ],
      },
      {
        label: 'Profissões', icon: 'briefcase', hue: 38,
        items: [
          ['settings_professions_view',        'Ver profissões'],
          ['settings_professions_edit',        'Criar / Editar profissões'],
          ['settings_professions_delete',      'Excluir profissões'],
          ['settings_professions_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_professions_bulk_import', 'Importação em massa via CSV'],
          ['settings_professions_import_web',  'Importar lista pronta da internet'],
        ],
      },
      {
        label: 'Termos e Condições', icon: 'shield', hue: 5,
        items: [
          ['settings_terms_view', 'Ver termos e condições'],
          ['settings_terms_edit', 'Editar termos e condições'],
        ],
      },
      {
        label: 'Categorias de Roteiro', icon: 'mapicon', hue: 190,
        items: [
          ['settings_itinerary_categories_view',        'Ver categorias de roteiro'],
          ['settings_itinerary_categories_edit',        'Criar / Editar categorias de roteiro'],
          ['settings_itinerary_categories_delete',      'Excluir categorias de roteiro'],
          ['settings_itinerary_categories_bulk_import', 'Importação em massa via CSV'],
        ],
      },
      {
        label: 'Continentes', icon: 'globe', hue: 200,
        items: [
          ['settings_continents_view',        'Ver continentes'],
          ['settings_continents_edit',        'Criar / Editar continentes'],
          ['settings_continents_delete',      'Excluir continentes'],
          ['settings_continents_bulk_import', 'Importação em massa via CSV'],
        ],
      },
      {
        label: 'Tipos de Acomodação', icon: 'bed', hue: 280,
        items: [
          ['settings_accommodations_view',        'Ver tipos de acomodação'],
          ['settings_accommodations_edit',        'Criar / Editar tipos de acomodação'],
          ['settings_accommodations_delete',      'Excluir tipos de acomodação'],
          ['settings_accommodations_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_accommodations_bulk_import', 'Importação em massa via CSV'],
        ],
      },
      {
        label: 'Vacinas', icon: 'syringe', hue: 18,
        items: [
          ['settings_vaccines_view',        'Ver vacinas'],
          ['settings_vaccines_edit',        'Criar / Editar vacinas'],
          ['settings_vaccines_delete',      'Excluir vacinas'],
          ['settings_vaccines_bulk_delete', 'Exclusão em massa via CSV'],
          ['settings_vaccines_bulk_import', 'Importação em massa via CSV'],
          ['settings_vaccines_import_web',  'Importar lista pronta da internet'],
        ],
      },
    ],
  },
  // "Log do Sistema" (log_view) foi removido da UI de permissões — concedia
  // acesso a TODAS as áreas de log de uma vez, duplicando o que já é
  // controlado individualmente em cada área (Ver log de atividades de
  // passageiros/agências/listas/usuários/configurações). Mantido como campo
  // legado (igual manage_users/manage_settings/view_audit_log) só por
  // compatibilidade com quem já tinha essa permissão concedida.
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

  contracts_edit:   'contracts_view',
  contracts_delete: 'contracts_view',

  roteiros_edit:   'roteiros_view',
  roteiros_delete: 'roteiros_view',

  calendar_view_birthdays:     'calendar_view',
  calendar_view_all_deadlines: 'calendar_view',

  email_log_preview:    'email_log_view',
  email_resend_actions: 'email_log_preview',

  users_edit:               'users_view',
  users_block:              'users_view',
  users_delete:             'users_view',
  users_manage_permissions: 'users_view',
  users_set_password:       'users_view',
  users_view_logs:          'users_view',

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

  settings_contract_clauses_view:   'settings_view',
  settings_contract_clauses_edit:   'settings_contract_clauses_view',
  settings_contract_clauses_delete: 'settings_contract_clauses_view',

  settings_payment_methods_view:   'settings_view',
  settings_payment_methods_edit:   'settings_payment_methods_view',
  settings_payment_methods_delete: 'settings_payment_methods_view',

  settings_exchange_rates_view:    'settings_view',
  settings_exchange_rates_edit:    'settings_exchange_rates_view',
  settings_exchange_rates_delete:  'settings_exchange_rates_view',

  settings_terms_view: 'settings_view',
  settings_terms_edit: 'settings_terms_view',

  settings_itinerary_categories_view:        'settings_view',
  settings_itinerary_categories_edit:        'settings_itinerary_categories_view',
  settings_itinerary_categories_delete:      'settings_itinerary_categories_view',
  settings_itinerary_categories_bulk_import: 'settings_itinerary_categories_edit',
  settings_continents_view:        'settings_view',
  settings_continents_edit:        'settings_continents_view',
  settings_continents_delete:      'settings_continents_view',
  settings_continents_bulk_import: 'settings_continents_edit',

  // bulk_import depende de _edit (igual ao bulk_delete que depende de _delete)
  settings_professions_bulk_import:      'settings_professions_edit',
  settings_languages_bulk_import:        'settings_languages_edit',
  settings_vaccines_bulk_import:         'settings_vaccines_edit',
  settings_genders_bulk_import:          'settings_genders_edit',
  settings_prof_cards_bulk_import:       'settings_prof_cards_edit',
  settings_list_additionals_bulk_import: 'settings_list_additionals_edit',
  settings_crew_roles_bulk_import:       'settings_crew_roles_edit',
  settings_list_categories_bulk_import:  'settings_list_categories_edit',
  settings_accommodations_bulk_import:   'settings_accommodations_edit',
  settings_doc_types_bulk_import:        'settings_doc_types_edit',
  settings_airports_bulk_import:         'settings_airports_edit',
  settings_airlines_bulk_import:         'settings_airlines_edit',
  settings_countries_bulk_import:        'settings_countries_edit',

  // import_web ("Importar da internet") depende só de _view — é uma ação independente do CSV
  settings_professions_import_web: 'settings_professions_view',
  settings_languages_import_web:   'settings_languages_view',
  settings_vaccines_import_web:    'settings_vaccines_view',
  settings_prof_cards_import_web:  'settings_prof_cards_view',
  settings_countries_import_web:   'settings_countries_view',
  settings_airports_import_web:    'settings_airports_view',
  settings_airlines_import_web:    'settings_airlines_view',

  // CSV buttons appear only when at least one section view/edit perm is active
  settings_csv_export: [
    'settings_doc_types_view', 'settings_professions_view', 'settings_languages_view',
    'settings_vaccines_view', 'settings_genders_view', 'settings_prof_cards_view',
    'settings_list_additionals_view', 'settings_crew_roles_view', 'settings_list_categories_view',
    'settings_accommodations_view', 'settings_countries_view',
    'settings_airports_view', 'settings_airlines_view',
    'settings_itinerary_categories_view', 'settings_continents_view',
  ],
  // "Importar CSV global" só aparece quando pelo menos um _bulk_import de seção está ativo
  settings_csv_import: [
    'settings_doc_types_bulk_import', 'settings_professions_bulk_import', 'settings_languages_bulk_import',
    'settings_vaccines_bulk_import', 'settings_genders_bulk_import', 'settings_prof_cards_bulk_import',
    'settings_list_additionals_bulk_import', 'settings_crew_roles_bulk_import', 'settings_list_categories_bulk_import',
    'settings_accommodations_bulk_import', 'settings_countries_bulk_import',
    'settings_airports_bulk_import', 'settings_airlines_bulk_import',
    'settings_itinerary_categories_bulk_import', 'settings_continents_bulk_import',
  ],

  settings_view_logs: 'settings_view',

  log_page_views: 'users_view',
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
