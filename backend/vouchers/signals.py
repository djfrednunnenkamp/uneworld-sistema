from django.db.models.signals import post_save
from django.dispatch import receiver


@receiver(post_save, sender='trips.PassengerList')
def create_voucher_for_list(sender, instance, created, **kwargs):
    """Toda lista de passageiros ganha um voucher automaticamente (blocos None =
    usa o template global padrão até a lista personalizar o dela)."""
    if created:
        from .models import VoucherList
        VoucherList.objects.get_or_create(passenger_list=instance)
