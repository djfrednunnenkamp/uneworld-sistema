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
    content: 'pais,estado,cidade\nBrasil,São Paulo,São Paulo\nBrasil,São Paulo,Campinas\nBrasil,Rio de Janeiro,Rio de Janeiro',
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
