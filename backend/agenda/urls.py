from django.urls import path

from .views import CalendarPreferenceView, calendar_events, send_now

urlpatterns = [
    path('events/',       calendar_events,        name='calendar-events'),
    path('preferences/',  CalendarPreferenceView.as_view(), name='calendar-preferences'),
    path('send-now/',     send_now,               name='calendar-send-now'),
]
