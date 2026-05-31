from django.urls import path
from . import views

urlpatterns = [
    path('login/',        views.login_view,  name='login'),
    path('logout/',       views.logout_view, name='logout'),
    path('me/',           views.me_view,     name='me'),
    path('',              views.user_list,   name='user-list'),
    path('create/',       views.user_create, name='user-create'),
    path('<int:pk>/',     views.user_update, name='user-update'),
    path('<int:pk>/delete/', views.user_delete, name='user-delete'),
]
