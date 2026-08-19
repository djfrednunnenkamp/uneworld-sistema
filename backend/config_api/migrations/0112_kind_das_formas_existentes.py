from django.db import migrations

# As formas que já existiam foram cadastradas antes de haver tipo. Sem tipo,
# nenhuma delas abre configuração — o financeiro não veria a escolha de gateway
# num contrato pago no cartão. Só preenchemos o que o nome diz sem ambiguidade;
# o resto continua em branco, para a operadora decidir.
POR_NOME = [
    ('cartão de crédito', 'cartao_credito'), ('cartao de credito', 'cartao_credito'),
    ('cartão de débito',  'cartao_debito'),  ('cartao de debito',  'cartao_debito'),
    ('pix',      'pix'),
    ('boleto',   'boleto'),
    ('cheque',   'cheque'),
    ('dinheiro', 'dinheiro'),
]


def preencher(apps, schema_editor):
    Forma = apps.get_model('config_api', 'ConfigPaymentMethod')
    for forma in Forma.objects.filter(kind=''):
        nome = (forma.name or '').strip().lower()
        for prefixo, kind in POR_NOME:
            if nome.startswith(prefixo):
                forma.kind = kind
                forma.save(update_fields=['kind'])
                break


def desfazer(apps, schema_editor):
    """Sem volta atrás: não dá para saber quais tipos foram postos aqui e quais
    a operadora escolheu depois. Deixar como está é o mal menor."""


class Migration(migrations.Migration):
    dependencies = [('config_api', '0111_configpaymentmethod_kind')]
    operations = [migrations.RunPython(preencher, desfazer)]
