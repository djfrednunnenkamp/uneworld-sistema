from django.conf import settings
from django.db import models


class CalendarPreference(models.Model):
    DIGEST_FREQ_CHOICES = [
        ('daily',  'Diário'),
        ('weekly', 'Semanal'),
    ]

    SIDE_PANEL_POSITION_CHOICES = [
        ('left',  'Esquerda'),
        ('right', 'Direita'),
    ]

    user                 = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='calendar_preference')
    digest_enabled       = models.BooleanField('Resumo automático por e-mail', default=False)
    digest_frequency     = models.CharField('Frequência do resumo', max_length=10, choices=DIGEST_FREQ_CHOICES, default='daily')
    reminder_enabled     = models.BooleanField('Lembrete de prazos por e-mail', default=False)
    reminder_days_before = models.PositiveSmallIntegerField('Avisar com quantos dias de antecedência', default=3)
    receive_deadline_emails  = models.BooleanField('Receber e-mails de prazos de confirmação', default=False)
    receive_task_emails      = models.BooleanField('Receber e-mails de pendências', default=False)
    receive_birthday_emails  = models.BooleanField('Receber e-mails de aniversários de passageiros', default=False)
    side_panel_enabled   = models.BooleanField('Exibir painel lateral do calendário', default=True)
    side_panel_position  = models.CharField('Posição do painel lateral', max_length=5, choices=SIDE_PANEL_POSITION_CHOICES, default='right')
    TIME_FORMAT_CHOICES = [('24h', '24 horas'), ('12h', '12 horas (AM/PM)')]
    time_format          = models.CharField('Formato de horário', max_length=3, choices=TIME_FORMAT_CHOICES, default='24h')
    # Layout preferido do formulário de contrato — separado para criar e editar.
    CONTRACT_LAYOUT_CHOICES = [('steps', 'Passo a passo'), ('full', 'Completo')]
    contract_create_layout = models.CharField('Layout ao criar contrato', max_length=6, choices=CONTRACT_LAYOUT_CHOICES, default='steps')
    contract_edit_layout   = models.CharField('Layout ao editar contrato', max_length=6, choices=CONTRACT_LAYOUT_CHOICES, default='full')
    # Ao APROVAR um contrato na revisão, o que fazer com a lista de passageiros —
    # PREFERÊNCIA PESSOAL de cada usuário (aba separada [padrão] / mesma aba / não abrir).
    REVIEW_OPEN_CHOICES = [('new_tab', 'Abrir em aba separada'), ('same_tab', 'Abrir na mesma aba'), ('none', 'Não abrir')]
    contract_review_open_mode = models.CharField('Ao aprovar contrato, abrir a lista', max_length=10, choices=REVIEW_OPEN_CHOICES, default='new_tab')
    # Moedas que o usuário escolheu ver na faixa de câmbio da Visão Geral
    # (lista de IDs de ConfigExchangeRate). Vazio = usa as favoritas globais.
    dashboard_currencies = models.JSONField('Moedas do câmbio no painel', default=list, blank=True)
    # Cores personalizadas usadas recentemente na aba Lâminas (lista de '#RRGGBB',
    # a mais recente primeiro). Persistidas no perfil (não só no navegador).
    lamina_recent_colors = models.JSONField('Cores recentes das lâminas', default=list, blank=True)
    # Favoritos da aba Lâminas. `null` = nunca inicializado (o front semeia os
    # padrões no primeiro uso); uma lista (mesmo vazia) = escolha do usuário
    # (respeitada — um item removido não volta sozinho).
    lamina_favorite_patterns     = models.JSONField('Estampas favoritas', null=True, blank=True, default=None)
    lamina_recent_patterns       = models.JSONField('Estampas recentes', default=list, blank=True)
    lamina_favorite_recommended  = models.JSONField('Paletas recomendadas favoritas', null=True, blank=True, default=None)
    # Templates de tema favoritos — referências unificadas ('builtin:<key>',
    # 'rec:<key>', 'mine:<id>'). null = nunca inicializado (semeia os padrões).
    lamina_favorite_themes       = models.JSONField('Templates de tema favoritos', null=True, blank=True, default=None)
    # Intervalo do gráfico de câmbio da Visão Geral.
    DASHBOARD_RANGE_CHOICES = [('week', '1 semana'), ('month', '1 mês'), ('6months', '6 meses'), ('year', '1 ano')]
    dashboard_chart_range = models.CharField('Intervalo do gráfico de câmbio', max_length=8,
                                             choices=DASHBOARD_RANGE_CHOICES, default='week')
    # Status das listas que o usuário quer ver no card "Listas de Passageiros
    # recentes" da Visão Geral. Subconjunto de ['ongoing','aberta','fechada'].
    # Vazio = mostra todas.
    dashboard_list_statuses = models.JSONField('Status das listas no painel', default=list, blank=True)
    # Ordem das abas do detalhe do roteiro escolhida pelo usuário (lista de chaves,
    # ex.: ['destinos','voo','valores',...]). Vazio = ordem padrão do sistema.
    itinerary_tab_order  = models.JSONField('Ordem das abas do roteiro', default=list, blank=True)
    contract_tab_order   = models.JSONField('Ordem das abas dos contratos', default=list, blank=True)
    # Colunas da lista do Drive (Meus Documentos), com ordem e visibilidade
    # escolhidas pelo usuário: [{"key":"modified","on":true}, ...]. Vazio = padrão.
    drive_columns        = models.JSONField('Colunas da lista do Drive', default=list, blank=True)
    # Ordem dos itens da barra lateral escolhida pelo usuário (lista de rotas,
    # ex.: ['/contratos','/roteiros',...]). Só reordena; a visibilidade continua
    # sendo pela permissão. Vazio = ordem padrão do sistema.
    nav_order            = models.JSONField('Ordem da barra lateral', default=list, blank=True)
    # Itens da barra lateral que o usuário escondeu (lista de rotas). A permissão
    # ainda manda; isto é uma ocultação puramente pessoal e reversível.
    nav_hidden           = models.JSONField('Itens escondidos da barra lateral', default=list, blank=True)
    # Colunas das tabelas de lista (ordem + visibilidade) por tabela:
    # {"contracts":[{"key":"payer","on":true},...], "passengers":[...], ...}.
    # A 1ª coluna de cada tabela é fixa e não entra aqui. Vazio = padrão.
    table_columns        = models.JSONField('Colunas das tabelas', default=dict, blank=True)
    # Nº de colunas da grade da Galeria escolhido pelo usuário. 0 = automático
    # (responsivo, padrão); 1..N = quantidade fixa de colunas.
    gallery_columns      = models.PositiveSmallIntegerField('Colunas da galeria', default=0)
    # Cores das abas dos Vouchers, por status: {"geral":"#RRGGBB","em_edicao":..,
    # "publicado":..,"finalizado":..}. Chave ausente/vazia = cor padrão do tema.
    voucher_tab_colors   = models.JSONField('Cores das abas dos vouchers', default=dict, blank=True)
    # Escolhas do pop-up "Prompt da lâmina com IA" (roteiro › Imagens e vídeos):
    # formato, direção de arte, composição, densidade, chamada, paleta/cores,
    # blocos de conteúdo, modo das inclusões e modo de preço. São do USUÁRIO, não
    # do roteiro — quem configurou uma vez abre qualquer roteiro já do seu jeito.
    # Vazio = padrões do sistema. O que depende do roteiro (cidades em destaque,
    # inclusões escolhidas, oferta) e os textos livres NÃO ficam aqui.
    lamina_prompt        = models.JSONField('Configurações do prompt da lâmina', default=dict, blank=True)
    digest_send_hour     = models.IntegerField('Horário de envio do resumo do calendário', default=8)
    send_hour            = models.IntegerField('Horário de envio das notificações diárias', default=8)
    last_digest_sent     = models.DateField('Último resumo enviado em', null=True, blank=True)
    last_reminder_sent   = models.DateField('Último lembrete enviado em', null=True, blank=True)
    last_daily_sent      = models.DateField('Último resumo diário enviado em', null=True, blank=True)
    updated_at           = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name        = 'Preferência de calendário'
        verbose_name_plural = 'Preferências de calendário'

    def __str__(self):
        return f'Preferências de {self.user}'


class EmailLog(models.Model):
    EMAIL_TYPES = [
        ('daily_digest',   'Digest diário'),
        ('digest',         'Resumo do calendário'),
        ('deadline',       'Prazo de confirmação'),
        ('task',           'Pendência'),
        ('birthday',       'Aniversário de passageiro'),
        ('reservation',    'Reserva de assentos'),
        ('reset_password', 'Redefinição de senha'),
        ('invite',         'Convite'),
        ('other',          'Outro'),
    ]

    STATUS_CHOICES = [
        ('sent',      'Enviado'),       # aceito pela Resend, entrega ainda não confirmada
        ('delivered', 'Entregue'),
        ('bounced',   'Não entregue'),
        ('failed',    'Falhou no envio'),
    ]

    sent_at      = models.DateTimeField('Enviado em', auto_now_add=True, db_index=True)
    to           = models.TextField('Destinatários')
    subject      = models.CharField('Assunto', max_length=500)
    email_type   = models.CharField('Tipo', max_length=30, choices=EMAIL_TYPES, default='other')
    html_body    = models.TextField('Conteúdo HTML', blank=True)
    success      = models.BooleanField('Enviado com sucesso', default=True)

    # Rastreamento via webhook da Resend (ver agenda/views.py:resend_webhook_view).
    # resend_id é o id retornado pela API no momento do envio — é com ele que a
    # Resend identifica qual EmailLog cada evento do webhook se refere.
    resend_id    = models.CharField('ID na Resend', max_length=100, blank=True, null=True, db_index=True)
    status       = models.CharField('Status de entrega', max_length=10, choices=STATUS_CHOICES, default='sent')
    delivered_at = models.DateTimeField('Entregue em', null=True, blank=True)
    opened_at    = models.DateTimeField('Aberto em', null=True, blank=True)

    class Meta:
        ordering            = ['-sent_at']
        verbose_name        = 'Log de e-mail'
        verbose_name_plural = 'Log de e-mails'

    def __str__(self):
        return f'[{self.email_type}] {self.subject} → {self.to}'
