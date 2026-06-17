from django.urls import path

from .views import CalendarPreferenceView, UserCalendarPreferenceView, calendar_events, send_now

urlpatterns = [
    path('events/',                         calendar_events,                    name='calendar-events'),
    path('preferences/',                    CalendarPreferenceView.as_view(),   name='calendar-preferences'),
    path('preferences/<int:user_id>/',      UserCalendarPreferenceView.as_view(), name='calendar-preferences-user'),
    path('send-now/',                       send_now,                           name='calendar-send-now'),
]
