from django.db import migrations


def remap_forward(apps, schema_editor):
    """Reposiciona os contratos existentes no NOVO fluxo (assinatura depois das
    conferências):
      - já assinados (assinado / revisao / aprovado / a_faturar no fluxo antigo,
        que só se chegava DEPOIS de assinar) → 'conf_pagamento' (financeiro
        confere o pagamento);
      - 'enviado' (mandado para assinar, mas ainda NÃO assinado) → 'revisao'
        (entra na revisão do fluxo novo; a assinatura vem depois);
      - 'em_edicao', 'em_pagamento', 'faturado' → inalterados.
    A ordem importa: primeiro colapsa os assinados em 'conf_pagamento' e só
    DEPOIS move 'enviado' para 'revisao', para não reprocessar linhas.
    """
    Contract = apps.get_model('contracts', 'Contract')
    Contract.objects.filter(stage__in=['assinado', 'revisao', 'aprovado', 'a_faturar']).update(stage='conf_pagamento')
    Contract.objects.filter(stage='enviado').update(stage='revisao')


class Migration(migrations.Migration):

    dependencies = [
        ('contracts', '0034_alter_contract_stage'),
    ]

    operations = [
        migrations.RunPython(remap_forward, migrations.RunPython.noop),
    ]
