"""Guarda contra campo declarado em serializer que não existe no model.

O DRF só descobre isso na PRIMEIRA vez que monta os campos do serializer — ou
seja, na requisição, com 500 na cara do usuário, e sem o `manage.py check`
piscar. Foi o que aconteceu com `bus_map`: ele é do BLOQUEIO
(ItineraryInventoryBlock), mas acabou declarado também no serializer do ITEM DE
CUSTO, derrubando todo endpoint de custo do roteiro (aba Valores, a
precificação e o "Custo real" do Financeiro) por duas semanas.

Montar os campos de TODO ModelSerializer do projeto é o teste: se um nome não
bate com o model, o próprio DRF levanta ImproperlyConfigured aqui, e não na
tela. Vale para qualquer app — o erro é de digitação, não de domínio.
"""
import importlib
import inspect

from django.apps import apps
from django.test import TestCase
from rest_framework import serializers as drf


def _model_serializers():
    """(rótulo, classe) de todo ModelSerializer em `<app>/serializers.py`."""
    for cfg in apps.get_app_configs():
        try:
            mod = importlib.import_module(cfg.name + '.serializers')
        except ModuleNotFoundError:
            continue
        for nome, obj in vars(mod).items():
            if (inspect.isclass(obj) and issubclass(obj, drf.ModelSerializer)
                    and getattr(getattr(obj, 'Meta', None), 'model', None) is not None):
                yield f'{cfg.name}.{nome}', obj


class SerializerFieldsTest(TestCase):
    def test_todo_campo_declarado_existe_no_model(self):
        problemas = []
        for rotulo, cls in _model_serializers():
            try:
                cls().fields          # é aqui que o DRF valida nome por nome
            except Exception as e:
                problemas.append(f'{rotulo}: {e}')
        self.assertEqual(problemas, [], 'Serializer com campo inexistente:\n' + '\n'.join(problemas))

    def test_item_de_custo_nao_tem_mapa_de_onibus(self):
        """Regressão direta: quem aponta para o mapa é o bloqueio, não o custo."""
        from itineraries.serializers import (ItineraryCostItemSerializer,
                                             ItineraryInventoryBlockSerializer)
        self.assertNotIn('bus_map', ItineraryCostItemSerializer().fields)
        self.assertIn('bus_map', ItineraryInventoryBlockSerializer().fields)
