/* Ícone + matiz (hue) de cada seção de configuração — usado nos cards de
   Configurações e nos filtros da revisão de importação, para manter a
   mesma identidade visual nos dois lugares. */
export const CARD_META = {
  doc_types:       { icon: 'docs',      hue: 230, desc: 'Modelos e tipos de documentos do sistema.' },
  perm_profiles:   { icon: 'shield',    hue: 252, desc: 'Perfis de acesso e permissões dos usuários.' },
  professions:     { icon: 'briefcase', hue: 38,  desc: 'Profissões disponíveis no cadastro de passageiros.' },
  languages:       { icon: 'globe',     hue: 150, desc: 'Idiomas disponíveis nos cadastros e materiais.' },
  vaccines:        { icon: 'syringe',   hue: 18,  desc: 'Vacinas registradas para controle sanitário.' },
  genders:         { icon: 'gender',    hue: 340, desc: 'Opções de gênero para o cadastro de pessoas.' },
  prof_cards:      { icon: 'card',      hue: 285, desc: 'Tipos de carteiras e documentos de identificação.' },
  list_addits:     { icon: 'listplus',  hue: 260, desc: 'Campos extras configuráveis nas listas de passageiros.' },
  crew_roles:      { icon: 'wrench',    hue: 165, desc: 'Funções e membros da equipe técnica de viagem.' },
  accommodations:  { icon: 'bed',       hue: 280, desc: 'Tipos de acomodação como single, duplo e triplo.' },
  list_categories: { icon: 'grid',      hue: 300, desc: 'Categorias para classificar as acomodações.' },
  countries:       { icon: 'pin',       hue: 130, desc: 'Países e seus respectivos estados e regiões.' },
  states:          { icon: 'pin',       hue: 130, desc: 'Estados vinculados aos países.' },
  cities:          { icon: 'pin',       hue: 130, desc: 'Cidades vinculadas aos estados.' },
  airports:        { icon: 'plane',     hue: 218, desc: 'Aeroportos cadastrados para origens e destinos.' },
  airlines:        { icon: 'ticket',    hue: 195, desc: 'Companhias aéreas disponíveis para voos.' },
  bus_maps:        { icon: 'mapicon',   hue: 45,  desc: 'Mapas de assentos dos ônibus por empresa.' },
  contract_clauses:{ icon: 'docs',      hue: 70,  desc: 'Cláusulas de contrato — base para o futuro gerador de contratos.' },
  terms:           { icon: 'shield',    hue: 5,   desc: 'Termos e condições que todo usuário precisa aceitar.' },
  payment_methods: { icon: 'card',      hue: 200, desc: 'Formas de pagamento disponíveis nos contratos.' },
  exchange_rates:  { icon: 'globe',     hue: 160, desc: 'Câmbio usado para preencher automaticamente os contratos.' },
  itinerary_categories: { icon: 'mapicon', hue: 190, desc: 'Categorias para classificar os roteiros (ex: Grupos Internacionais).' },
  continents:      { icon: 'globe',     hue: 200, desc: 'Continentes vinculados aos roteiros.' },
  destinations:    { icon: 'mapicon',   hue: 210, desc: 'Destinos disponíveis para vincular aos roteiros.' },
  holidays:        { icon: 'calendar',  hue: 25,  desc: 'Feriados e datas comerciais associáveis aos roteiros.' },
  services:        { icon: 'briefcase', hue: 35,  desc: 'Serviços turísticos oferecidos por fornecedores nos roteiros.' },
  itinerary_templates: { icon: 'docs', hue: 250, desc: 'Modelos de texto (seguro, pagamento, condições, documentação) usados nos roteiros.' },
}

export const sectionTileColors = (hue) => ({
  bg: `oklch(0.955 0.035 ${hue})`,
  fg: `oklch(0.52 0.15 ${hue})`,
})
