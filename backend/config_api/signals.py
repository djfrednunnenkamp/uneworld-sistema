from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import ConfigShipCabin, ConfigAccommodation, ConfigFlightClass
from .repoint import repoint_scoped_row


@receiver(post_save, sender=ConfigShipCabin)
@receiver(post_save, sender=ConfigAccommodation)
@receiver(post_save, sender=ConfigFlightClass)
def _repoint_on_scoped_type_save(sender, instance, created, **kwargs):
    # Ao criar um tipo próprio do roteiro, adota as linhas que ainda apontam
    # para o tipo global correspondente. Só faz sentido na criação.
    if created and getattr(instance, 'itinerary_id', None):
        repoint_scoped_row(instance)
