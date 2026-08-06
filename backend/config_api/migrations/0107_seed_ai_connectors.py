"""Semente do catálogo de Conectores de IA.

O catálogo nasce com as IAs mais usadas para o usuário não precisar cadastrar do
zero. É IDEMPOTENTE (get_or_create pelo nome) e não desfaz edição: se alguém
renomear, apagar ou trocar o link, rodar de novo não recria nem sobrescreve.
"""
from django.db import migrations

SEMENTE = [
    ('ChatGPT',    'https://chat.openai.com/'),
    ('Claude',     'https://claude.ai/'),
    ('Gemini',     'https://gemini.google.com/'),
    ('Copilot',    'https://copilot.microsoft.com/'),
    ('Perplexity', 'https://www.perplexity.ai/'),
    ('Grok',       'https://grok.com/'),
]


def semear(apps, schema_editor):
    AIConnector = apps.get_model('config_api', 'AIConnector')
    # Só semeia num catálogo VAZIO — se já houver algo, é escolha do usuário.
    if AIConnector.objects.exists():
        return
    for i, (nome, url) in enumerate(SEMENTE):
        AIConnector.objects.get_or_create(
            name=nome, defaults={'url': url, 'order': i, 'is_favorite': i < 3},
        )


def desfazer(apps, schema_editor):
    """Reversível: remove só o que a semente criou e ninguém alterou."""
    AIConnector = apps.get_model('config_api', 'AIConnector')
    for nome, url in SEMENTE:
        AIConnector.objects.filter(name=nome, url=url).delete()


class Migration(migrations.Migration):
    dependencies = [('config_api', '0106_aiconnector')]
    operations = [migrations.RunPython(semear, desfazer)]
