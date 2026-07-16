import uuid
from decimal import Decimal
from django.core.validators import RegexValidator
from django.db import models

from core.storages import public_media_storage


def airline_logo_path(instance, filename):
    """Nome único (uuid) para a logo da companhia — evita cache velho ao trocar."""
    return f'airlines/{uuid.uuid4().hex}.png'


def branding_logo_path(instance, filename):
    """Nome único (uuid) para cada logo do branding — evita reusar o mesmo nome
    (o front envia sempre 'logo.png'), o que fazia o navegador mostrar a logo
    ANTIGA em cache após deletar e reenviar."""
    return f'branding/{uuid.uuid4().hex}.png'


class ConfigProfession(models.Model):
    name = models.CharField('Nome', max_length=200, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Profissão'

    def __str__(self):
        return self.name


class ConfigSpecialNeed(models.Model):
    """Catálogo de necessidades especiais dos passageiros (ex.: Cadeirante, Cego,
    Autista). O passageiro referencia N destes (M2M)."""
    name = models.CharField('Nome', max_length=200, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Necessidade especial'

    def __str__(self):
        return self.name


class ConfigLanguage(models.Model):
    name = models.CharField('Nome', max_length=100, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Idioma'

    def __str__(self):
        return self.name


class ConfigCountry(models.Model):
    name      = models.CharField('Nome', max_length=100, unique=True)
    code      = models.CharField('Código ISO', max_length=10, blank=True)
    continent = models.ForeignKey('ConfigContinent', null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name='countries', verbose_name='Continente')

    class Meta:
        ordering = ['name']
        verbose_name = 'País'

    def __str__(self):
        return self.name


class ConfigState(models.Model):
    country = models.ForeignKey(ConfigCountry, on_delete=models.CASCADE, related_name='states')
    name    = models.CharField('Nome', max_length=100)
    code    = models.CharField('Código', max_length=20, blank=True)

    class Meta:
        ordering = ['name']
        unique_together = [('country', 'name')]
        verbose_name = 'Estado'

    def __str__(self):
        return f'{self.name} ({self.country.name})'


class ConfigGender(models.Model):
    name = models.CharField('Nome', max_length=100, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Gênero'

    def __str__(self):
        return self.name


class ConfigPaymentMethod(models.Model):
    name = models.CharField('Nome', max_length=100, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Forma de pagamento'

    def __str__(self):
        return self.name


class ConfigPaymentPlan(models.Model):
    """Modelo/sugestão de pagamento reutilizável: entrada (opcional, em R$ ou % do
    total) + nº de parcelas + forma de pagamento + agenda de vencimentos. Serve de
    base para os roteiros (que guardam uma CÓPIA) e, via roteiro, é sugerido no
    contrato com um botão de "aplicar" que preenche entrada e parcelas."""
    DOWN_PAYMENT_MODE_CHOICES = [('percent', '% do total'), ('valor', 'Valor em R$')]
    name                 = models.CharField('Nome', max_length=120)
    # À vista: pagamento único do total (ignora entrada/parcelas). O passo de
    # arredondamento do valor à vista reaproveita installment_rounding.
    a_vista              = models.BooleanField('À vista', default=False)
    # Desconto aplicado quando o pagamento é à vista (interpretado por a_vista_discount_mode:
    # 'percent' → % do total; 'valor' → R$). 0 = sem desconto.
    a_vista_discount_mode  = models.CharField('Tipo do desconto à vista', max_length=10, choices=DOWN_PAYMENT_MODE_CHOICES, default='percent')
    a_vista_discount_value = models.DecimalField('Desconto à vista (valor ou %)', max_digits=12, decimal_places=2, default=0)
    has_down_payment     = models.BooleanField('Tem entrada', default=False)
    down_payment_mode    = models.CharField('Tipo da entrada', max_length=10, choices=DOWN_PAYMENT_MODE_CHOICES, default='percent')
    # Interpretado conforme down_payment_mode: 'percent' → % do total; 'valor' → R$.
    down_payment_value   = models.DecimalField('Entrada (valor ou %)', max_digits=12, decimal_places=2, default=0)
    down_payment_method  = models.CharField('Forma de pagamento da entrada', max_length=100, blank=True)
    # Passo de arredondamento (em R$) aplicado ao valor da entrada quando o modelo
    # vira contrato. Ex.: 0.01 = centavos (2 casas), 1 = real inteiro, 10, 100…
    down_payment_rounding = models.DecimalField('Arredondamento da entrada (R$)', max_digits=8, decimal_places=2, default=Decimal('0.01'))
    installments_count   = models.PositiveSmallIntegerField('Nº de parcelas', default=0)
    payment_method       = models.CharField('Forma de pagamento', max_length=100, blank=True)
    # Passo de arredondamento (em R$) aplicado ao valor de CADA parcela.
    installment_rounding = models.DecimalField('Arredondamento das parcelas (R$)', max_digits=8, decimal_places=2, default=Decimal('0.01'))
    # Juros por FAIXA de nº de parcelas. Lista de {up_to, rate}: aplica `rate`% ao
    # valor financiado (parcelas) quando o nº de parcelas ≤ up_to (up_to nulo = "acima").
    # Ex.: [{up_to:6, rate:0}, {up_to:8, rate:1}, {up_to:null, rate:10}].
    interest_tiers       = models.JSONField('Juros por faixa de parcelas', default=list, blank=True)
    first_due_days       = models.PositiveSmallIntegerField('1º vencimento (dias após aplicar)', default=30)
    interval_days        = models.PositiveSmallIntegerField('Intervalo entre parcelas (dias)', default=30)
    created_at           = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at           = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Modelo de pagamento'

    def __str__(self):
        return self.name


class ConfigExchangeRate(models.Model):
    """Taxa de conversão entre duas moedas — usada para preencher automaticamente
    o câmbio e o total em BRL nos contratos (ver app `contracts`).

    `rate` é a taxa EFETIVA (usada nos contratos) = base_rate × (1 + markup_percent/100).
    `base_rate` é a taxa de mercado (digitada ou puxada da internet); `markup_percent`
    é o acréscimo que a operadora soma por cima."""
    from_currency = models.CharField('De', max_length=10, default='USD')
    to_currency   = models.CharField('Para', max_length=10, default='BRL')
    base_rate     = models.DecimalField('Taxa de mercado', max_digits=12, decimal_places=4, null=True, blank=True)
    # Dois acréscimos sobre a MESMA taxa de mercado: um pra compra à vista e outro
    # pra parcelado. Geram duas taxas efetivas (rate = à vista, rate_installment).
    markup_percent = models.DecimalField('Acréscimo à vista (%)', max_digits=6, decimal_places=2, default=0)
    markup_percent_installment = models.DecimalField('Acréscimo parcelado (%)', max_digits=6, decimal_places=2, default=0)
    rate          = models.DecimalField('Taxa à vista', max_digits=12, decimal_places=4)
    rate_installment = models.DecimalField('Taxa parcelado', max_digits=12, decimal_places=4, default=0)
    # Atualização automática diária a partir da internet.
    auto_update   = models.BooleanField('Atualizar automaticamente', default=False)
    is_favorite   = models.BooleanField('Favorito', default=False, db_index=True)
    # Link próprio (JSON) de onde puxar a taxa desta moeda; vazio = API global.
    source_url    = models.CharField('Link da taxa', max_length=500, blank=True)
    # Script Python (sandbox) que calcula a taxa de mercado — tem precedência sobre
    # o link. Ex.: pegar de 2 fontes, tirar a média e somar um percentual.
    script        = models.TextField('Script de cálculo (Python)', blank=True)
    # Horário específico desta moeda; vazio = usa o horário geral (singleton abaixo).
    update_time   = models.TimeField('Horário da atualização', null=True, blank=True)
    last_auto_update = models.DateField('Última atualização automática', null=True, blank=True)
    # Arredondamento opcional da taxa EFETIVA. `rounding_decimals` = nº de casas
    # (None = mantém o padrão de 4 casas, sem arredondar); `rounding_mode` = como
    # arredondar (mais próximo / pra cima / pra baixo).
    ROUNDING_MODE_CHOICES = [('nearest', 'Mais próximo'), ('up', 'Pra cima'), ('down', 'Pra baixo')]
    rounding_decimals = models.PositiveSmallIntegerField('Casas do arredondamento', null=True, blank=True)
    rounding_mode     = models.CharField('Modo do arredondamento', max_length=8, choices=ROUNDING_MODE_CHOICES, default='nearest')
    # Histórico curto da taxa (últimos ~7 dias, 1 ponto por dia) — alimenta o
    # mini-gráfico de câmbio na Visão Geral. Cada item: {"d": "AAAA-MM-DD", "r": 5.3}.
    rate_history  = models.JSONField('Histórico da taxa', default=list, blank=True)
    # Quando a TAXA mudou de fato pela última vez. `updated_at` (auto_now) muda a
    # cada save (estrelar favorito, mexer no markup…), então não serve pra mostrar
    # "quando o câmbio atualizou". Este campo só avança quando `rate` muda mesmo.
    rate_updated_at = models.DateTimeField('Taxa atualizada em', null=True, blank=True)
    updated_at    = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        ordering = ['from_currency', 'to_currency']
        verbose_name = 'Câmbio'
        verbose_name_plural = 'Câmbio'
        unique_together = ('from_currency', 'to_currency')

    def save(self, *args, **kwargs):
        from decimal import Decimal
        from django.utils import timezone
        # Sem taxa de mercado informada, a própria taxa efetiva vira a base
        # (compatível com câmbios antigos e com importação que manda só `rate`).
        if self.base_rate is None:
            self.base_rate = self.rate
        markup = self.markup_percent or Decimal('0')
        markup_inst = self.markup_percent_installment or Decimal('0')
        # Um script de câmbio pode entregar as taxas à vista/parcelado prontas
        # (atributos voláteis _script_a_vista/_script_parcelado). Quando presentes,
        # têm precedência sobre o acréscimo; senão, aplica o markup sobre a base.
        script_av = getattr(self, '_script_a_vista', None)
        script_pc = getattr(self, '_script_parcelado', None)
        new_rate = self._apply_rounding(
            script_av if script_av is not None
            else self.base_rate * (Decimal('1') + markup / Decimal('100')))
        self.rate_installment = self._apply_rounding(
            script_pc if script_pc is not None
            else self.base_rate * (Decimal('1') + markup_inst / Decimal('100')))
        # Só mexe no histórico e na data da taxa quando a taxa EFETIVA realmente
        # muda — senão estrelar favorito ou abrir/salvar o câmbio sem alterar nada
        # falsearia a "última atualização" e achataria o gráfico da Visão Geral.
        old_rate = type(self).objects.filter(pk=self.pk).values_list('rate', flat=True).first() if self.pk else None
        self.rate = new_rate
        rate_changed = old_rate is None or old_rate != new_rate
        extra_fields = set()
        if rate_changed:
            self._record_history_point()
            self.rate_updated_at = timezone.now()
            extra_fields |= {'rate_history', 'rate_updated_at'}
        # Quando o save é parcial (update_fields), garante que a taxa recalculada
        # (e o histórico/data, quando mudou) também sejam gravados.
        uf = kwargs.get('update_fields')
        if uf is not None:
            kwargs['update_fields'] = set(uf) | {'rate', 'rate_installment'} | extra_fields
        super().save(*args, **kwargs)

    def _apply_rounding(self, value):
        """Arredonda a taxa efetiva conforme `rounding_decimals`/`rounding_mode`.
        Sem casas definidas, mantém o padrão de 4 casas (sem arredondar de fato).
        O campo `rate` tem 4 casas, então o resultado é sempre re-quantizado a 4."""
        from decimal import Decimal, ROUND_HALF_UP, ROUND_UP, ROUND_DOWN
        if self.rounding_decimals is not None:
            modes = {'up': ROUND_UP, 'down': ROUND_DOWN, 'nearest': ROUND_HALF_UP}
            q = Decimal(1).scaleb(-int(self.rounding_decimals))   # ex.: 2 → 0.01
            value = value.quantize(q, rounding=modes.get(self.rounding_mode, ROUND_HALF_UP))
        return value.quantize(Decimal('0.0001'))

    def _record_history_point(self):
        """Guarda 1 ponto por dia (atualiza o do dia se a taxa mudar de novo),
        com data e horário da captura, e mantém ~1 ano — o usuário escolhe o
        intervalo exibido (semana/mês/6 meses/ano) no gráfico da Visão Geral."""
        from django.utils import timezone
        now = timezone.now()
        today = timezone.localdate().isoformat()
        hist = list(self.rate_history or [])
        point = {'d': today, 'r': float(self.rate), 't': now.isoformat()}
        if hist and hist[-1].get('d') == today:
            hist[-1] = point
        else:
            hist.append(point)
        self.rate_history = hist[-366:]

    def __str__(self):
        return f'{self.from_currency} → {self.to_currency}: {self.rate}'


class ConfigExchangeSettings(models.Model):
    """Singleton com as configurações gerais de câmbio — por ora, o horário geral
    de atualização automática (usado pelas moedas que não têm horário próprio)."""
    default_update_time = models.TimeField('Horário geral de atualização', null=True, blank=True)
    updated_at          = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        verbose_name = 'Configurações de câmbio'
        verbose_name_plural = 'Configurações de câmbio'

    @classmethod
    def get(cls):
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create()
        return obj


class ConfigVaccine(models.Model):
    name = models.CharField('Nome', max_length=200, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Vacina'

    def __str__(self):
        return self.name


class CustomDocType(models.Model):
    """Tipo de documento gerenciável pelo painel."""
    key       = models.SlugField('Chave', max_length=50, unique=True)
    label     = models.CharField('Nome', max_length=100)
    icon      = models.CharField('Ícone (emoji)', max_length=10, default='📄')
    color     = models.CharField('Cor', max_length=20, default='#475569')
    order     = models.PositiveIntegerField('Ordem', default=0)
    is_active = models.BooleanField('Ativo', default=True)

    class Meta:
        ordering = ['order', 'label']
        verbose_name = 'Tipo de documento'

    def __str__(self):
        return self.label


class CustomDocField(models.Model):
    """Campo de um tipo de documento."""
    FIELD_TYPES = [
        ('text',       'Texto livre'),
        ('date',       'Data'),
        ('list',       'Lista suspensa'),
        ('country',    'País / Estado / Cidade'),
        ('language',   'Idioma'),
        ('profession', 'Profissão'),
        ('prof_card',  'Carteira profissional'),
    ]
    doc_type   = models.ForeignKey(CustomDocType, on_delete=models.CASCADE, related_name='fields')
    key        = models.SlugField('Chave', max_length=50)
    label      = models.CharField('Label', max_length=100)
    field_type = models.CharField('Tipo', max_length=20, choices=FIELD_TYPES, default='text')
    required   = models.BooleanField('Obrigatório', default=False)
    order      = models.PositiveIntegerField('Ordem', default=0)
    # Para campo tipo 'country': 'country_only' | 'country_state' | 'country_state_city'
    subtype    = models.CharField('Subtipo', max_length=30, blank=True, default='')

    class Meta:
        ordering = ['order']
        unique_together = [('doc_type', 'key')]
        verbose_name = 'Campo de documento'

    def __str__(self):
        return f'{self.doc_type.label} / {self.label}'


class CustomDocFieldOption(models.Model):
    """Opção de um campo do tipo 'list'."""
    field = models.ForeignKey(CustomDocField, on_delete=models.CASCADE, related_name='options')
    value = models.CharField('Valor', max_length=200)
    order = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order', 'value']
        verbose_name = 'Opção de campo'

    def __str__(self):
        return self.value


class ConfigProfCard(models.Model):
    name = models.CharField('Nome', max_length=200, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Carteira profissional'

    def __str__(self):
        return self.name


class ConfigCity(models.Model):
    state = models.ForeignKey(ConfigState, on_delete=models.CASCADE, related_name='cities')
    name  = models.CharField('Nome', max_length=150)
    # Nome normalizado (minúsculo, sem acento) — usado na busca insensível a acento.
    name_ascii = models.CharField(max_length=150, blank=True, default='', db_index=True)
    # Apelidos PT normalizados (ex.: 'cidade do mexico' p/ 'Mexico City') — também
    # pesquisados, para achar cidades famosas pelo nome em português.
    aliases    = models.CharField(max_length=255, blank=True, default='', db_index=True)

    def save(self, *args, **kwargs):
        from .textsearch import normalize_text
        self.name_ascii = normalize_text(self.name)
        super().save(*args, **kwargs)

    class Meta:
        ordering = ['name']
        unique_together = [('state', 'name')]
        verbose_name = 'Cidade'

    def __str__(self):
        return f'{self.name} ({self.state.name})'


class ConfigAccommodation(models.Model):
    name      = models.CharField('Nome', max_length=200)
    capacity  = models.PositiveIntegerField('Capacidade (pessoas)', default=1)
    is_couple = models.BooleanField('É para casal', default=False)
    # Vínculo OPCIONAL com um roteiro: null = tipo GLOBAL (catálogo padrão);
    # setado = tipo EXCLUSIVO daquele roteiro (personalização por-roteiro). Os
    # custos/blocos/linhas continuam apontando por FK (id) — sem refatoração.
    itinerary = models.ForeignKey('itineraries.Itinerary', null=True, blank=True, on_delete=models.CASCADE, related_name='+')

    class Meta:
        ordering = ['name']
        constraints = [
            # Nome único entre os GLOBAIS; e único dentro de cada roteiro.
            models.UniqueConstraint(fields=['name'], condition=models.Q(itinerary__isnull=True), name='uniq_global_accom_name'),
            models.UniqueConstraint(fields=['itinerary', 'name'], name='uniq_roteiro_accom_name'),
        ]
        verbose_name = 'Tipo de acomodação'
        verbose_name_plural = 'Tipos de acomodação'

    def __str__(self):
        return self.name


class ConfigShipCabin(models.Model):
    """Tipo de cabine de navio (aba Valores › Navio). Igual ao tipo de acomodação:
    nome + capacidade + se é para casal. Opcionalmente agrupado em uma categoria/
    setor (ex.: "Balcão Juliet Inferior") para organizar os tipos (Duplo/Twin/
    Single) do mesmo setor. Cadastrado nas Configurações."""
    category  = models.CharField('Categoria / setor', max_length=200, blank=True, default='', db_index=True)
    name      = models.CharField('Nome', max_length=200)
    capacity  = models.PositiveIntegerField('Capacidade (pessoas)', default=1)
    is_couple = models.BooleanField('É para casal', default=False)
    # Vínculo OPCIONAL com um roteiro (igual à acomodação): null = global; setado
    # = exclusivo do roteiro.
    itinerary = models.ForeignKey('itineraries.Itinerary', null=True, blank=True, on_delete=models.CASCADE, related_name='+')

    class Meta:
        ordering = ['category', 'name']
        # Nome único DENTRO de cada categoria — nos globais e dentro de cada roteiro.
        constraints = [
            models.UniqueConstraint(fields=['category', 'name'], condition=models.Q(itinerary__isnull=True), name='uniq_global_cabin'),
            models.UniqueConstraint(fields=['itinerary', 'category', 'name'], name='uniq_roteiro_cabin'),
        ]
        verbose_name = 'Tipo de cabine'
        verbose_name_plural = 'Tipos de cabine'

    def __str__(self):
        return f'{self.category} - {self.name}' if self.category else self.name


class ConfigListCategory(models.Model):
    name = models.CharField('Nome', max_length=100, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Categoria de lista'
        verbose_name_plural = 'Categorias de lista'

    def __str__(self):
        return self.name


class Airline(models.Model):
    name        = models.CharField('Nome', max_length=200, db_index=True)
    iata_code   = models.CharField('Código IATA', max_length=10, blank=True, db_index=True)
    country     = models.CharField('País', max_length=200, blank=True)
    is_favorite = models.BooleanField('Favorito', default=False, db_index=True)
    # Logo normalizada em 320×160 PNG (fundo transparente) — upload manual (com
    # recorte no front) ou baixada da Kiwi pelo código IATA.
    logo        = models.ImageField('Logo', upload_to=airline_logo_path, storage=public_media_storage, null=True, blank=True)

    class Meta:
        ordering            = ['name']
        verbose_name        = 'Companhia aérea'
        verbose_name_plural = 'Companhias aéreas'

    def __str__(self):
        parts = [self.iata_code, self.name]
        return ' — '.join(p for p in parts if p)


class Airport(models.Model):
    name        = models.CharField('Nome', max_length=200, db_index=True)
    iata_code   = models.CharField('Código IATA', max_length=10, blank=True, db_index=True)
    city        = models.CharField('Cidade', max_length=200, blank=True, db_index=True)
    country     = models.CharField('País', max_length=200, blank=True)
    is_favorite = models.BooleanField('Favorito', default=False, db_index=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Aeroporto'
        verbose_name_plural = 'Aeroportos'

    def __str__(self):
        parts = [self.iata_code, self.name]
        return ' — '.join(p for p in parts if p)


class BusMap(models.Model):
    """Mapa de assentos de um ônibus, configurável fileira a fileira."""
    DECK_COUNT_CHOICES = [(1, 'Andar único'), (2, 'Dois andares')]

    key        = models.SlugField('Chave', max_length=60, unique=True)
    label      = models.CharField('Nome', max_length=100)
    order      = models.PositiveIntegerField('Ordem', default=0)
    is_active  = models.BooleanField('Ativo', default=True)
    deck_count = models.PositiveSmallIntegerField('Andares do ônibus', choices=DECK_COUNT_CHOICES, default=1)

    class Meta:
        ordering = ['order', 'label']
        verbose_name = 'Mapa de ônibus'
        verbose_name_plural = 'Mapas de ônibus'

    def __str__(self):
        return self.label


class BusMapRow(models.Model):
    """Fileira de assentos de um mapa de ônibus: N à esquerda do corredor, M à direita.
    Quando o mapa tem dois andares (BusMap.deck_count == 2), cada fileira pertence a um deles."""
    DECK_CHOICES = [(1, '1º andar'), (2, '2º andar')]

    bus_map      = models.ForeignKey(BusMap, on_delete=models.CASCADE, related_name='rows')
    deck         = models.PositiveSmallIntegerField('Andar', choices=DECK_CHOICES, default=1)
    order        = models.PositiveIntegerField('Ordem', default=0)
    left_seats   = models.PositiveSmallIntegerField('Assentos à esquerda', default=2)
    right_seats  = models.PositiveSmallIntegerField('Assentos à direita', default=2)
    left_labels  = models.JSONField('Numeração à esquerda', default=list, blank=True)
    right_labels = models.JSONField('Numeração à direita', default=list, blank=True)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Fileira de ônibus'
        verbose_name_plural = 'Fileiras de ônibus'

    def __str__(self):
        return f'{self.bus_map.label} · fileira {self.order + 1}'


class PermissionProfile(models.Model):
    name = models.CharField('Nome', max_length=100, unique=True)
    permissions = models.JSONField('Permissões', default=dict)
    # Perfil aplicado automaticamente aos USUÁRIOS DE AGÊNCIA ao criá-los. Só um
    # perfil pode ser o padrão de agência (garantido no serializer).
    is_agency_default = models.BooleanField('Perfil padrão dos usuários de agência', default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ── Lixeira (soft-delete) — nunca é removido de fato do banco ──
    is_deleted = models.BooleanField('Excluído', default=False, db_index=True)
    deleted_at = models.DateTimeField('Excluído em', null=True, blank=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Perfil de permissão'

    def __str__(self):
        return self.name


class ContractClause(models.Model):
    """Base para o futuro recurso de geração de contrato — ainda não usado em
    nenhum fluxo, só a tela de cadastro/edição das cláusulas em si.

    Exclusão é definitiva (sem lixeira): uma vez usada num contrato, o texto
    fica salvo no próprio contrato — apagar a cláusula-modelo depois não
    afeta contratos já gerados."""
    name       = models.CharField('Nome', max_length=200)
    content    = models.TextField('Texto', blank=True)  # HTML do editor rico
    is_default = models.BooleanField('Cláusula padrão', default=False, db_index=True)  # sempre entra no contrato
    created_at = models.DateTimeField('Criado em', auto_now_add=True)
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Cláusula de contrato'
        verbose_name_plural = 'Cláusulas de contrato'

    def __str__(self):
        return self.name


class OperatingCompany(models.Model):
    """Singleton com os dados da própria UneWorld como operadora — pré-preenche
    automaticamente a seção 'Operadora' de todo contrato novo (ver app `contracts`)."""
    company_name   = models.CharField('Nome/Empresa', max_length=200, blank=True)
    cnpj           = models.CharField('CNPJ', max_length=20, blank=True)
    seller         = models.CharField('Vendedor', max_length=200, blank=True)
    phone          = models.CharField('Telefone fixo', max_length=20, blank=True)
    mobile         = models.CharField('Celular', max_length=20, blank=True)
    email          = models.EmailField('E-mail', blank=True)
    website        = models.CharField('Site', max_length=300, blank=True)
    address        = models.CharField('Endereço', max_length=300, blank=True)
    # PIX da UneWorld — usado no contrato quando a agência marca "usar PIX da UneWorld".
    pix_key_type   = models.CharField('Tipo de chave PIX', max_length=20, blank=True)
    pix_key        = models.CharField('Chave PIX', max_length=200, blank=True)
    SIGNATURE_CHOICES = [('fisica', 'Física (imprimir e assinar)'), ('digital', 'Digital')]
    default_signature_type = models.CharField('Assinatura padrão dos contratos', max_length=10,
                                              choices=SIGNATURE_CHOICES, default='fisica')
    # Assinatura digital automática do CEO: ele entra como signatário oficial e o
    # sistema assina por ele via API da Autentique (signDocument com o token dele).
    ceo_name              = models.CharField('CEO — nome', max_length=200, blank=True)
    ceo_email             = models.EmailField('CEO — e-mail (conta Autentique)', blank=True)
    ceo_autentique_token  = models.CharField('CEO — token de assinatura (Autentique)', max_length=255, blank=True)
    ceo_auto_sign         = models.BooleanField('Assinar automaticamente pelo CEO nos contratos digitais', default=False)
    # Imagem da assinatura do CEO — embutida no PDF FÍSICO (acima da linha da
    # Operadora). PNG com fundo transparente é o ideal.
    ceo_signature         = models.ImageField('CEO — assinatura (imagem)', upload_to='operating/', null=True, blank=True)
    updated_at     = models.DateTimeField('Atualizado em', auto_now=True)

    @property
    def ceo_auto_sign_enabled(self):
        """Só habilita quando ligado E com e-mail + token do CEO preenchidos."""
        return bool(self.ceo_auto_sign and (self.ceo_email or '').strip() and (self.ceo_autentique_token or '').strip())

    class Meta:
        verbose_name = 'Dados da operadora'
        verbose_name_plural = 'Dados da operadora'

    def __str__(self):
        return self.company_name or 'Dados da operadora'

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class TermsAndConditions(models.Model):
    """Singleton com o texto de termos e condições — todo usuário precisa
    aceitar no primeiro login; se o texto for editado depois, precisa
    aceitar de novo (comparado via updated_at)."""
    content    = models.TextField('Texto', blank=True)  # HTML do editor rico
    updated_at = models.DateTimeField('Atualizado em', auto_now=True)

    class Meta:
        verbose_name = 'Termos e condições'
        verbose_name_plural = 'Termos e condições'

    def __str__(self):
        return 'Termos e condições'

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class SystemSettings(models.Model):
    """Singleton de configurações globais do sistema."""
    deadline_notification_emails = models.JSONField('E-mails de notificação de prazos', default=list, blank=True)

    # Opções globais de pagamento à vista (desconto único + forma sugerida). Usadas
    # quando o pagamento é à vista, independentemente do modelo de pagamento.
    A_VISTA_DISCOUNT_MODE_CHOICES = [('percent', '% do total'), ('valor', 'Valor em R$')]
    a_vista_discount_mode  = models.CharField('Tipo do desconto à vista', max_length=10, choices=A_VISTA_DISCOUNT_MODE_CHOICES, default='percent')
    a_vista_discount_value = models.DecimalField('Desconto à vista (valor ou %)', max_digits=12, decimal_places=2, default=0)
    a_vista_payment_method = models.CharField('Forma de pagamento à vista', max_length=100, blank=True)

    # Logos configuráveis por lugar (branding). Vazio = usa o /logo.png padrão.
    logo_system   = models.ImageField('Logo do tema (sistema)', upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)  # legado
    logo_sidebar  = models.ImageField('Logo da sidebar', upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_topbar   = models.ImageField('Logo do topo (barra branca)', upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_login    = models.ImageField('Logo das telas de login', upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    favicon       = models.ImageField('Favicon (ícone do navegador)', upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_site     = models.ImageField('Logo do site (vitrine)', upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_pdf      = models.ImageField('Logo do PDF dos roteiros', upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_contract = models.ImageField('Logo dos contratos', upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_voucher  = models.ImageField('Logo dos vouchers', upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_list     = models.ImageField('Logo do PDF da lista de passageiros', upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    # Não-destrutivo: a imagem ORIGINAL de cada logo (para reabrir/desfazer o
    # enquadramento). Os dados do recorte ficam em `branding_crops` (slot → {u,v,du,dv,fw,fh}).
    logo_system_original   = models.ImageField(upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_sidebar_original  = models.ImageField(upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_topbar_original   = models.ImageField(upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_login_original    = models.ImageField(upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    favicon_original       = models.ImageField(upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_site_original     = models.ImageField(upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_pdf_original      = models.ImageField(upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_contract_original = models.ImageField(upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_voucher_original  = models.ImageField(upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    logo_list_original     = models.ImageField(upload_to=branding_logo_path, storage=public_media_storage, null=True, blank=True)
    branding_crops = models.JSONField('Recortes das logos', default=dict, blank=True)
    # Template GLOBAL padrão do voucher (blocos). Vazio = usa o padrão do código
    # (vouchers.models.DEFAULT_VOUCHER_BLOCKS). Cada lista pode ter o seu próprio.
    voucher_template = models.JSONField('Template padrão do voucher', default=list, blank=True)
    # Título da aba do navegador. Vazio = usa o nome da operadora.
    browser_title = models.CharField('Título da aba do navegador', max_length=120, blank=True, default='')
    # Cores do tema (hex). Vazio = usa a cor padrão do sistema.
    color_primary   = models.CharField('Cor principal', max_length=9, blank=True, default='')
    color_secondary = models.CharField('Cor secundária', max_length=9, blank=True, default='')

    class Meta:
        verbose_name = 'Configurações do sistema'
        verbose_name_plural = 'Configurações do sistema'

    def __str__(self):
        return 'Configurações do sistema'

    @classmethod
    def get(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class ConfigItineraryCategory(models.Model):
    """Categoria de roteiro (ex: Grupos Internacionais, Grupos Nacionais)."""
    name = models.CharField('Nome', max_length=200, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Categoria de Roteiro'

    def __str__(self):
        return self.name


class ConfigContinent(models.Model):
    name = models.CharField('Nome', max_length=100, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Continente'

    def __str__(self):
        return self.name


class ConfigItineraryType(models.Model):
    """Tipo de roteiro como LISTA extensível (ex.: Aéreo, Terrestre, Marítimo,
    Cruzeiro, Rodoviário). Complementa — não substitui — o campo de choices
    Itinerary.trip_type ('aereo'/'terrestre'), que é preservado por compatibilidade."""
    name = models.CharField('Nome', max_length=120, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Tipo de Roteiro'
        verbose_name_plural = 'Tipos de Roteiro'

    def __str__(self):
        return self.name


class ConfigMaritimeCompany(models.Model):
    """Companhia marítima / de cruzeiro (ex.: MSC, Costa, Royal Caribbean)."""
    name    = models.CharField('Nome', max_length=200, unique=True)
    website = models.URLField('Site', blank=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Companhia Marítima'
        verbose_name_plural = 'Companhias Marítimas'

    def __str__(self):
        return self.name


class ConfigKeyword(models.Model):
    """Palavra-chave de roteiro (tag). Cadastrada em Configurações e escolhida nos
    roteiros; pode ser criada na hora pelo popup do roteiro."""
    name = models.CharField('Nome', max_length=120, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Palavra-chave'
        verbose_name_plural = 'Palavras-chave'

    def __str__(self):
        return self.name


class ConfigCostCategory(models.Model):
    """Categoria de custo do roteiro (aba Valores). Cadastrada nas Configurações e
    escolhida em cada item de custo."""
    name = models.CharField('Nome', max_length=80, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Categoria de custo'
        verbose_name_plural = 'Categorias de custo'

    def __str__(self):
        return self.name


class ConfigFlightSegment(models.Model):
    """Trecho/tipo de voo do custo aéreo (aba Valores › Aéreo): ex. Voo total,
    Voo do guia, Ida, Volta. Cadastrado nas Configurações."""
    name = models.CharField('Nome', max_length=80, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Trecho aéreo'
        verbose_name_plural = 'Trechos aéreos'

    def __str__(self):
        return self.name


class ConfigFlightClass(models.Model):
    """Classe da passagem aérea (aba Valores › Aéreo): ex. Econômica, Premium
    Economy, Executiva, Primeira Classe. Cadastrada nas Configurações.
    Pode ser personalizada por roteiro (FK itinerary opcional, igual à
    acomodação/cabine): null = global; setado = exclusiva do roteiro."""
    name = models.CharField('Nome', max_length=80)
    itinerary = models.ForeignKey('itineraries.Itinerary', null=True, blank=True, on_delete=models.CASCADE, related_name='+')

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['name'], condition=models.Q(itinerary__isnull=True), name='uniq_global_flightclass'),
            models.UniqueConstraint(fields=['itinerary', 'name'], name='uniq_roteiro_flightclass'),
        ]
        verbose_name = 'Classe aérea'
        verbose_name_plural = 'Classes aéreas'

    def __str__(self):
        return self.name


class ConfigInclusion(models.Model):
    """Item que pode estar INCLUSO num pacote/roteiro (ex.: Café da manhã, Traslados,
    Seguro viagem). Cadastrado em Configurações e escolhido nos roteiros."""
    name = models.CharField('Nome', max_length=200, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Incluso'
        verbose_name_plural = 'Inclusos'

    def __str__(self):
        return self.name


class ConfigHighlight(models.Model):
    """Destaque de um pacote/roteiro (ex.: Guia em português, City tour incluso,
    Hotéis 5 estrelas). Cadastrado em Configurações e escolhido nos roteiros."""
    name = models.CharField('Nome', max_length=200, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Destaque'
        verbose_name_plural = 'Destaques'

    def __str__(self):
        return self.name


class ConfigSpecialDate(models.Model):
    """Data especial de um pacote/roteiro (ex.: Réveillon, Carnaval, Natal,
    Semana Santa). Cadastrada em Configurações e escolhida nos roteiros."""
    name = models.CharField('Nome', max_length=200, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Data especial'
        verbose_name_plural = 'Datas especiais'

    def __str__(self):
        return self.name


class ConfigCurrency(models.Model):
    """Moeda como LISTA de referência (código ISO-4217 + símbolo). Criada para
    substituir, no futuro, o choices fixo EUR/USD/BRL. IMPORTANTE: NÃO altera
    o campo Itinerary.base_currency (choices), preservado por compatibilidade —
    esta tabela apenas disponibiliza o cadastro para uso posterior."""
    code   = models.CharField('Código ISO', max_length=3, unique=True, validators=[
        RegexValidator(r'^[A-Z]{3}$', 'Use o código ISO-4217 com 3 letras maiúsculas (ex.: USD).'),
    ])
    name   = models.CharField('Nome', max_length=100)
    symbol = models.CharField('Símbolo', max_length=8, blank=True)

    class Meta:
        ordering = ['code']
        verbose_name = 'Moeda'
        verbose_name_plural = 'Moedas'

    def __str__(self):
        return f'{self.code} — {self.name}'


class OperatingCompanyContact(models.Model):
    """Pessoa/contato da operadora (equipe): nome, função, e-mail e telefone/WhatsApp.
    Lista simples exibida na aba 'Contatos' da Operadora nas Configurações."""
    name  = models.CharField('Nome', max_length=200)
    role  = models.CharField('Função', max_length=200, blank=True)
    email = models.EmailField('E-mail', blank=True)
    phone = models.CharField('Telefone/WhatsApp', max_length=30, blank=True)
    order = models.PositiveIntegerField('Ordem', default=0)

    class Meta:
        ordering = ['order', 'name']
        verbose_name = 'Contato da operadora'
        verbose_name_plural = 'Contatos da operadora'

    def __str__(self):
        return self.name


class ConfigHotelCategory(models.Model):
    """Categoria de hotel (ex.: 5 estrelas, Resort, Boutique). Gerida direto no
    pop-up de hotéis das Configurações."""
    name = models.CharField('Nome', max_length=150, unique=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Categoria de hotel'
        verbose_name_plural = 'Categorias de hotel'

    def __str__(self):
        return self.name


class ConfigHotel(models.Model):
    """Catálogo global de hotéis (Configurações)."""
    name        = models.CharField('Nome', max_length=300, db_index=True)
    city        = models.ForeignKey(ConfigCity, null=True, blank=True, on_delete=models.SET_NULL, related_name='hotels')
    categories  = models.ManyToManyField(ConfigHotelCategory, blank=True, related_name='hotels')
    website     = models.CharField('Site', max_length=500, blank=True)
    phone       = models.CharField('Telefone', max_length=40, blank=True)
    description = models.TextField('Descrição', blank=True, default='')
    # False = hotel criado só para um roteiro (não aparece no catálogo geral).
    is_global   = models.BooleanField('No catálogo geral', default=True, db_index=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Hotel'
        verbose_name_plural = 'Hotéis'

    def __str__(self):
        return self.name


def boat_media_path(instance, filename):
    """Nome único (uuid) para imagens/vídeos do barco, preservando a extensão."""
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'bin'
    return f'boats/{uuid.uuid4().hex}.{ext}'


def hotel_media_path(instance, filename):
    """Nome único (uuid) para imagens/vídeos do hotel, preservando a extensão."""
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'bin'
    return f'hotels/{uuid.uuid4().hex}.{ext}'


class ConfigHotelMedia(models.Model):
    """Imagem ou vídeo de um hotel."""
    IMAGE = 'image'
    VIDEO = 'video'
    hotel       = models.ForeignKey(ConfigHotel, on_delete=models.CASCADE, related_name='media')
    file        = models.FileField('Arquivo', upload_to=hotel_media_path, storage=public_media_storage)
    kind        = models.CharField('Tipo', max_length=10, default=IMAGE)
    order       = models.PositiveIntegerField('Ordem', default=0)
    uploaded_at = models.DateTimeField('Enviado em', auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Mídia de hotel'
        verbose_name_plural = 'Mídias de hotel'

    def __str__(self):
        return f'{self.hotel_id} · {self.kind}'


class ConfigBoat(models.Model):
    """Catálogo de barcos (Configurações). Nome, site, descrição e mídias."""
    name        = models.CharField('Nome', max_length=300, db_index=True)
    website     = models.CharField('Site', max_length=500, blank=True)
    description = models.TextField('Descrição', blank=True, default='')
    # False = barco criado só para um roteiro (não aparece no catálogo geral).
    is_global   = models.BooleanField('No catálogo geral', default=True, db_index=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Barco'
        verbose_name_plural = 'Barcos'

    def __str__(self):
        return self.name


class ConfigBoatMedia(models.Model):
    """Imagem ou vídeo de um barco."""
    IMAGE = 'image'
    VIDEO = 'video'
    boat        = models.ForeignKey(ConfigBoat, on_delete=models.CASCADE, related_name='media')
    file        = models.FileField('Arquivo', upload_to=boat_media_path, storage=public_media_storage)
    kind        = models.CharField('Tipo', max_length=10, default=IMAGE)
    order       = models.PositiveIntegerField('Ordem', default=0)
    uploaded_at = models.DateTimeField('Enviado em', auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']
        verbose_name = 'Mídia de barco'
        verbose_name_plural = 'Mídias de barco'

    def __str__(self):
        return f'{self.boat_id} · {self.kind}'


class ConfigTerrestreCompany(models.Model):
    """Empresa/transportadora terrestre (Configurações) — usada nos trechos da
    aba Terrestre do roteiro (equivalente à Companhia Aérea dos voos)."""
    name        = models.CharField('Nome', max_length=200, unique=True)
    is_favorite = models.BooleanField('Favorito', default=False, db_index=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Empresa terrestre'
        verbose_name_plural = 'Empresas terrestres'

    def __str__(self):
        return self.name
