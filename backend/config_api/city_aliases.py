"""Apelidos em PORTUGUÊS para cidades famosas (as cidades vêm do GeoNames com
nome em inglês/local: 'Mexico City', 'London', 'Rome'…). Assim, buscar
'Cidade do México' / 'Londres' / 'Roma' encontra a cidade certa.

Formato: (nome_exato_no_banco, trecho_do_país, [apelidos_pt]).
Aplicado na coluna `aliases` (normalizada) e casado na busca."""

CITY_ALIASES = [
    # América
    ('Mexico City', 'xico', ['Cidade do México']),
    ('New York City', 'Unidos', ['Nova Iorque', 'Nova York']),
    ('Washington', 'Unidos', ['Washington']),
    ('New Orleans', 'Unidos', ['Nova Orleans']),
    ('Philadelphia', 'Unidos', ['Filadélfia']),
    ('Bogotá', 'Col', ['Bogotá']),
    ('Bogota', 'Col', ['Bogotá']),
    ('Montevideo', 'Urugu', ['Montevidéu']),
    ('Asunción', 'Para', ['Assunção']),
    ('Asuncion', 'Para', ['Assunção']),
    ('Havana', 'Cuba', ['Havana']),
    # Europa
    ('London', 'Reino', ['Londres']),
    ('Edinburgh', 'Reino', ['Edimburgo']),
    ('Rome', 'It', ['Roma']),
    ('Florence', 'It', ['Florença']),
    ('Venice', 'It', ['Veneza']),
    ('Milan', 'It', ['Milão']),
    ('Naples', 'It', ['Nápoles']),
    ('Turin', 'It', ['Turim']),
    ('Genoa', 'It', ['Gênova']),
    ('Lisbon', 'Portugal', ['Lisboa']),
    ('Athens', 'Gr', ['Atenas']),
    ('Thessaloniki', 'Gr', ['Tessalônica', 'Salônica']),
    ('Munich', 'Alema', ['Munique']),
    ('Cologne', 'Alema', ['Colônia']),
    ('Hamburg', 'Alema', ['Hamburgo']),
    ('Berlin', 'Alema', ['Berlim']),
    ('Nuremberg', 'Alema', ['Nuremberg']),
    ('Vienna', 'ustria', ['Viena']),
    ('Prague', 'Tch', ['Praga']),
    ('Warsaw', 'Pol', ['Varsóvia']),
    ('Kraków', 'Pol', ['Cracóvia']),
    ('Krakow', 'Pol', ['Cracóvia']),
    ('Copenhagen', 'Dinam', ['Copenhague']),
    ('Stockholm', 'Su', ['Estocolmo']),
    ('Helsinki', 'Finl', ['Helsinque', 'Helsínquia']),
    ('Reykjavík', 'Isl', ['Reiquiavique']),
    ('Reykjavik', 'Isl', ['Reiquiavique']),
    ('Amsterdam', 'Pa', ['Amsterdã', 'Amesterdão']),
    ('Brussels', 'lgica', ['Bruxelas']),
    ('Antwerp', 'lgica', ['Antuérpia']),
    ('Geneva', 'Su', ['Genebra']),
    ('Zurich', 'Su', ['Zurique']),
    ('Bern', 'Su', ['Berna']),
    ('Marseille', 'Fran', ['Marselha']),
    ('Bordeaux', 'Fran', ['Bordéus']),
    ('Seville', 'Espanha', ['Sevilha']),
    ('Málaga', 'Espanha', ['Málaga']),
    ('Malaga', 'Espanha', ['Málaga']),
    ('Moscow', 'ss', ['Moscou', 'Moscovo']),
    ('Saint Petersburg', 'ss', ['São Petersburgo']),
    ('Kyiv', 'Ucr', ['Kiev']),
    ('Kiev', 'Ucr', ['Kiev']),
    ('Bucharest', 'Rom', ['Bucareste']),
    ('Budapest', 'Hungria', ['Budapeste']),
    ('Belgrade', 'rvia', ['Belgrado']),
    # Ásia / Oriente Médio
    ('Beijing', 'China', ['Pequim']),
    ('Shanghai', 'China', ['Xangai']),
    ('Guangzhou', 'China', ['Cantão']),
    ('Nanjing', 'China', ['Nanquim']),
    ('Tokyo', 'Jap', ['Tóquio']),
    ('Kyoto', 'Jap', ['Quioto']),
    ('Seoul', 'Cor', ['Seul']),
    ('Bangkok', 'Til', ['Banguecoque']),
    ('Bangkok', 'Tail', ['Banguecoque']),
    ('New Delhi', 'ndia', ['Nova Déli', 'Nova Delhi']),
    ('Mumbai', 'ndia', ['Bombaim']),
    ('Istanbul', 'Turquia', ['Istambul']),
    ('Jerusalem', 'Israel', ['Jerusalém']),
    ('Damascus', 'ria', ['Damasco']),
    ('Baghdad', 'Iraque', ['Bagdá', 'Bagdade']),
    ('Tehran', 'Ir', ['Teerã', 'Teerão']),
    ('Mecca', 'Sau', ['Meca']),
    # África
    ('Cairo', 'Egito', ['Cairo']),
    ('Cape Town', 'Sul', ['Cidade do Cabo']),
    ('Johannesburg', 'Sul', ['Joanesburgo']),
    ('Marrakesh', 'Marrocos', ['Marraquexe']),
    ('Marrakech', 'Marrocos', ['Marraquexe']),
    ('Fez', 'Marrocos', ['Fez']),
]


def apply_aliases(City):
    """Grava os apelidos PT (normalizados) na coluna `aliases`, sem duplicar.
    Retorna quantas cidades foram atualizadas."""
    from .textsearch import normalize_text
    updated = 0
    for english, country_frag, pts in CITY_ALIASES:
        cities = City.objects.filter(name__iexact=english,
                                     state__country__name__icontains=country_frag)
        add = [normalize_text(p) for p in pts]
        for city in cities:
            toks = (city.aliases or '').split()
            for phrase in add:
                for t in phrase.split():
                    if t not in toks:
                        toks.append(t)
            new = ' '.join(toks)
            if new != (city.aliases or ''):
                city.aliases = new
                city.save(update_fields=['aliases'])
                updated += 1
    return updated
