from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def _broadcast(scope: str = 'all'):
    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)('dashboard', {
        'type': 'dashboard.refresh',
        'scope': scope,
    })


# Importações dentro das funções para evitar imports circulares na inicialização

@receiver([post_save, post_delete], sender='passengers.Passenger')
def on_passenger(sender, **kwargs):
    _broadcast('stats')


@receiver([post_save, post_delete], sender='trips.PassengerList')
def on_list(sender, **kwargs):
    _broadcast('lists')


@receiver([post_save, post_delete], sender='trips.ListEnrollment')
def on_enrollment(sender, **kwargs):
    _broadcast('stats')


@receiver(post_save, sender='agenda.EmailLog')
def on_email_log(sender, **kwargs):
    _broadcast('emails')
