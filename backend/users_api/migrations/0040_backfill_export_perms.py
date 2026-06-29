from django.db import migrations

# Áreas que ganharam a permissão granular de download ("_export").
EXPORT_AREAS = [
    'professions', 'languages', 'countries', 'genders', 'vaccines',
    'doc_types', 'prof_cards', 'user_profiles', 'destinations',
    'list_additionals', 'crew_roles', 'accommodations', 'list_categories',
    'airports', 'airlines', 'bus_maps', 'contract_clauses', 'payment_methods',
    'exchange_rates', 'terms', 'operating_company', 'itinerary_categories',
    'holidays', 'services', 'itinerary_templates',
]


def forwards(apps, schema_editor):
    """Preserva o comportamento atual: antes, exportar dependia só de "_view".
    Agora "_export" é uma permissão própria — então concede "_export" a quem já
    tinha "_view" da mesma área. Idem para a importação de Modelos de Texto, que
    antes dependia de "_edit" e agora tem "_bulk_import" próprio. NÃO concede
    "_bulk_delete" (capacidade nova e destrutiva, começa desligada)."""
    UserPermissions = apps.get_model('users_api', 'UserPermissions')
    pairs = [(f'settings_{a}_view', f'settings_{a}_export') for a in EXPORT_AREAS]
    pairs.append(('settings_itinerary_templates_edit', 'settings_itinerary_templates_bulk_import'))

    for perms in UserPermissions.objects.all().iterator():
        changed = False
        for src, dst in pairs:
            if getattr(perms, src, False) and not getattr(perms, dst, False):
                setattr(perms, dst, True)
                changed = True
        if changed:
            perms.save(update_fields=[dst for _, dst in pairs])

    # Perfis de permissão guardam um snapshot em JSON.
    PermissionProfile = apps.get_model('config_api', 'PermissionProfile')
    for prof in PermissionProfile.objects.all().iterator():
        data = prof.permissions or {}
        changed = False
        for src, dst in pairs:
            if data.get(src) and not data.get(dst):
                data[dst] = True
                changed = True
        if changed:
            prof.permissions = data
            prof.save(update_fields=['permissions'])


def backwards(apps, schema_editor):
    # Sem reversão de dados — os campos são removidos pela migração de schema.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users_api', '0039_userpermissions_settings_accommodations_export_and_more'),
        ('config_api', '0019_permissionprofile'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
