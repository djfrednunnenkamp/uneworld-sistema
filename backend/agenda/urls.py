from django.urls import path

from .views import (CalendarPreferenceView, UserCalendarPreferenceView,
                    calendar_events, send_now,
                    EmailLogListView, EmailLogDetailView, email_preview_enabled)

urlpatterns = [
    path('events/',                         calendar_events,                      name='calendar-events'),
    path('preferences/',                    CalendarPreferenceView.as_view(),     name='calendar-preferences'),
    path('preferences/<int:user_id>/',      UserCalendarPreferenceView.as_view(), name='calendar-preferences-user'),
    path('send-now/',                       send_now,                             name='calendar-send-now'),
    path('email-log/',                      EmailLogListView.as_view(),           name='email-log-list'),
    path('email-log/<int:pk>/',             EmailLogDetailView.as_view(),         name='email-log-detail'),
    path('email-log/settings/',             email_preview_enabled,                name='email-log-settings'),
]
