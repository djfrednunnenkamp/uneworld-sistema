from django.urls import path
from . import views

urlpatterns = [
    path('login/',                views.login_view,      name='login'),
    path('logout/',               views.logout_view,     name='logout'),
    path('me/',                   views.me_view,         name='me'),
    path('forgot-password/',      views.forgot_password, name='forgot-password'),
    path('reset-password/',       views.reset_password,  name='reset-password'),
    path('invite/validate/',      views.validate_invite, name='validate-invite'),
    path('invite/accept/',        views.accept_invite,   name='accept-invite'),
    path('',                      views.user_list,       name='user-list'),
    path('create/',               views.user_create,     name='user-create'),
    path('<int:pk>/',             views.user_update,     name='user-update'),
    path('<int:pk>/invite/',      views.send_user_invite,name='send-invite'),
    path('<int:pk>/delete/',      views.user_delete,     name='user-delete'),
]

