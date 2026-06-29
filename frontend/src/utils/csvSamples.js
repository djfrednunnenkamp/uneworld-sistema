/* Modelos de CSV para download — um por tipo de configuração */

const simple = (rows) => ['nome', ...rows].join('\n')

export const CSV_SAMPLES = {
  professions:     { content: simple(['Professor', 'Médico', 'Engenheiro']),                filename: 'modelo_profissoes.csv' },
  languages:       { content: simple(['Português', 'Inglês', 'Espanhol']),                 filename: 'modelo_idiomas.csv' },
  vaccines:        { content: simple(['Febre Amarela', 'Covid-19', 'Hepatite B']),          filename: 'modelo_vacinas.csv' },
  genders:         { content: simple(['Masculino', 'Feminino', 'Não-binário']),             filename: 'modelo_generos.csv' },
  prof_cards:      { content: simple(['CNH', 'CREM', 'CREA']),                             filename: 'modelo_carteiras.csv' },
  list_addits:     { content: simple(['Mochila', 'Passaporte', 'Seguro viagem']),           filename: 'modelo_adicionais.csv' },
  crew_roles:      { content: simple(['Guia', 'Motorista', 'Assistente']),                 filename: 'modelo_equipe_tecnica.csv' },
  list_categories: { content: simple(['Standard', 'Superior', 'Deluxe']),                  filename: 'modelo_categorias.csv' },
  payment_methods: { content: simple(['Pix', 'Cartão de crédito', 'Transferência bancária']), filename: 'modelo_formas_pagamento.csv' },

  accommodations: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Acomodações,Cabine dupla,2,sim,,,',
      'Acomodações,Cabine tripla,3,não,,,',
      'Acomodações,Suite individual,1,não,,,',
    ].join('\n'),
    filename: 'modelo_acomodacoes.csv',
  },
  doc_types: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Documentos,Passaporte,,,,,passport',
      'Documentos,Identidade (RG),,,,,rg',
      'Documentos,CNH,,,,,cnh',
    ].join('\n'),
    filename: 'modelo_documentos.csv',
  },
  airports: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Aeroportos,Guarulhos,,,Brasil,Guarulhos,GRU',
      'Aeroportos,Congonhas,,,Brasil,São Paulo,CGH',
      'Aeroportos,Galeão,,,Brasil,Rio de Janeiro,GIG',
    ].join('\n'),
    filename: 'modelo_aeroportos.csv',
  },
  airlines: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Companhias Aéreas,LATAM,,,Brasil,,LA',
      'Companhias Aéreas,Gol,,,Brasil,,G3',
      'Companhias Aéreas,Azul,,,Brasil,,AD',
    ].join('\n'),
    filename: 'modelo_companhias_aereas.csv',
  },
  bus_maps: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Mapas de Ônibus,Convencional 2+2,0,,,,"{""deck_count"":1,""rows"":[]}"',
    ].join('\n'),
    filename: 'modelo_mapas_de_onibus.csv',
  },
  contract_clauses: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Cláusulas de Contrato,Cancelamento de voo,,,,,"{""content"":""<p>Texto da cláusula…</p>"",""is_default"":false}"',
    ].join('\n'),
    filename: 'modelo_clausulas_contrato.csv',
  },
  exchange_rates: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Câmbio,USD → BRL,,,,,"{""from_currency"":""USD"",""to_currency"":""BRL"",""base_rate"":5.3,""markup_percent"":2,""is_favorite"":true,""auto_update"":false,""source_url"":"""",""script"":"""",""update_time"":""""}"',
    ].join('\n'),
    filename: 'modelo_cambio.csv',
  },
  terms: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Termos e Condições,Termos e Condições,,,,,"{""content"":""<p>Texto dos termos…</p>""}"',
    ].join('\n'),
    filename: 'modelo_termos_e_condicoes.csv',
  },
  itinerary_templates: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Modelos de Texto do Roteiro,Condições padrão,,,,,"{""kind"":""condicoes"",""content"":""<p>Condições gerais para compra do pacote…</p>""}"',
      'Modelos de Texto do Roteiro,Seguro premium,,,,,"{""kind"":""seguro"",""content"":""<p>Texto do adicional de seguro viagem…</p>""}"',
    ].join('\n'),
    filename: 'modelo_modelos_roteiro.csv',
  },
  operating_company: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Operadora,UneWorld Viagens,,,,,"{""company_name"":""UneWorld Viagens"",""cnpj"":""00.000.000/0000-00"",""seller"":""Fulano de Tal"",""phone"":""(00) 0000-0000"",""mobile"":""(00) 90000-0000"",""email"":""contato@uneworld.com"",""address"":""Rua Exemplo, 123"",""default_signature_type"":""fisica""}"',
    ].join('\n'),
    filename: 'modelo_operadora.csv',
  },
  countries: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Países,Brasil,,,,,BR',
      'Países,Argentina,,,,,AR',
      'Estados,São Paulo,,,Brasil,,SP',
      'Estados,Rio de Janeiro,,,Brasil,,RJ',
      'Cidades,São Paulo,,,Brasil,São Paulo,',
      'Cidades,Campinas,,,Brasil,São Paulo,',
    ].join('\n'),
    filename: 'modelo_paises_estados_cidades.csv',
  },
  geo: {
    content: 'continente,pais,estado,cidade\nAméricas,Brasil,São Paulo,São Paulo\nAméricas,Brasil,São Paulo,Campinas\nAméricas,Brasil,Rio de Janeiro,Rio de Janeiro',
    filename: 'modelo_geo.csv',
  },
  all: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Profissões,Professor,,,,,',
      'Idiomas,Português,,,,,',
      'Vacinas,Febre Amarela,,,,,',
      'Gêneros,Masculino,,,,,',
      'Carteiras,CNH,,,,,',
      'Adicionais de Lista,Mochila,,,,,',
      'Equipe técnica,Guia,,,,,',
      'Categoria de Acomodações,Standard,,,,,',
      'Acomodações,Cabine dupla,2,sim,,,',
      'Documentos,Passaporte,,,,,passport',
      'Aeroportos,Guarulhos,,,Brasil,Guarulhos,GRU',
      'Companhias Aéreas,LATAM,,,Brasil,,LA',
      'Países,Brasil,,,,,BR',
      'Estados,São Paulo,,,Brasil,,SP',
      'Cidades,São Paulo,,,Brasil,São Paulo,',
    ].join('\n'),
    filename: 'modelo_todas_as_configuracoes.csv',
  },
  perm_profiles: {
    content: [
      'lista,nome,pessoas,casal,pais,estado,codigo',
      'Perfis de Permissão,Gerente de Viagens,,,,,settings_professions_view|settings_languages_view|settings_csv_export',
      'Perfis de Permissão,Operador,,,,,settings_professions_view|settings_professions_edit',
    ].join('\n'),
    filename: 'modelo_perfis_de_permissao.csv',
  },
  passengers: {
    content: 'nome,cpf,email,telefone,genero,data_nascimento,nacionalidade,acomodacao,status,observacoes\nJoão Silva,123.456.789-00,joao@exemplo.com,(11) 99999-0000,M,01/01/1990,Brasileiro,Cabine 1,confirmado,',
    filename: 'modelo_passageiros.csv',
  },
}
