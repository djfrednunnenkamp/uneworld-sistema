from django.db.models.signals import post_save, post_delete
from django.db.models import F
from django.dispatch import receiver
from .models import ListEnrollment, PassengerList


def _bump_revision(passenger_list_id):
    PassengerList.objects.filter(pk=passenger_list_id).update(revision=F('revision') + 1)


@receiver(post_save, sender=ListEnrollment)
def enrollment_saved(sender, instance, **kwargs):
    _bump_revision(instance.passenger_list_id)


@receiver(post_delete, sender=ListEnrollment)
def enrollment_deleted(sender, instance, **kwargs):
    _bump_revision(instance.passenger_list_id)
