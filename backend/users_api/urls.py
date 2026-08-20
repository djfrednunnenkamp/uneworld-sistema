from django.urls import path
from . import views

urlpatterns = [
    path('login/',                views.login_view,      name='login'),
    path('logout/',               views.logout_view,     name='logout'),
    path('me/',                   views.me_view,         name='me'),
    path('me/avatar/',            views.me_avatar,       name='me-avatar'),
    path('me/change-password/',   views.change_password, name='change-password'),
    path('me/storage/',           views.me_storage,      name='me-storage'),
    path('me/accept-terms/',      views.accept_terms,    name='accept-terms'),
    path('forgot-password/',      views.forgot_password, name='forgot-password'),
    path('reset-password/',       views.reset_password,  name='reset-password'),
    path('reset-password/validate/', views.validate_reset_token, name='validate-reset-token'),
    path('invite/validate/',      views.validate_invite, name='validate-invite'),
    path('invite/accept/',        views.accept_invite,   name='accept-invite'),
    path('',                      views.user_list,       name='user-list'),
    path('lookup-cpf/',           views.user_lookup_cpf, name='user-lookup-cpf'),
    path('create/',               views.user_create,     name='user-create'),
    path('<int:pk>/',             views.user_update,     name='user-update'),
    path('<int:pk>/invite/',       views.send_user_invite, name='send-invite'),
    path('<int:pk>/send-reset/',   views.admin_send_reset, name='admin-send-reset'),
    path('<int:pk>/set-password/', views.admin_set_password, name='admin-set-password'),
    path('<int:pk>/avatar/',       views.user_avatar,      name='user-avatar'),
    path('<int:pk>/storage/',      views.user_storage,     name='user-storage'),
    path('<int:pk>/unlink-agencies/', views.user_unlink_agencies, name='user-unlink-agencies'),
    path('<int:pk>/delete/',       views.user_delete,      name='user-delete'),
    path('<int:pk>/restore/',      views.user_restore,     name='user-restore'),
    path('<int:pk>/purge/',        views.user_purge,       name='user-purge'),
]

