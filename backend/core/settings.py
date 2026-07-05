from pathlib import Path
from decouple import config

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = config('SECRET_KEY')

DEBUG = config('DEBUG', default=False, cast=bool)

ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1').split(',')

# Libera a EXCLUSÃO DEFINITIVA (purge) de itens da lixeira — destrutiva e
# irreversível. Mesmo habilitada, só superusuário pode usar. Manter False em
# produção; ligar só quando precisar limpar de vez (ex.: fase de teste).
ALLOW_HARD_DELETE = config('ALLOW_HARD_DELETE', default=False, cast=bool)

INSTALLED_APPS = [
    'daphne',               # deve vir antes de staticfiles para substituir runserver
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'whitenoise.runserver_nostatic',
    'rest_framework',
    'corsheaders',
    'users_api',
    'passengers',
    'agencies',
    'trips',
    'dashboard',
    'config_api',
    'audit',
    'agenda',
    'contracts',
    'itineraries',
    'channels',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'audit.middleware.AuditMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'core.wsgi.application'
ASGI_APPLICATION  = 'core.asgi.application'

REDIS_HOST = config('REDIS_HOST', default='')

if REDIS_HOST:
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [(REDIS_HOST, config('REDIS_PORT', default=6379, cast=int))],
            },
        }
    }
else:
    # Sem Redis (dev local): só funciona com um único processo, pois os grupos de
    # WebSocket (ex: dashboard) não são compartilhados entre workers/réplicas.
    CHANNEL_LAYERS = {
        'default': {
            'BACKEND': 'channels.layers.InMemoryChannelLayer',
        }
    }

DB_ENGINE = config('DB_ENGINE', default='sqlite')

if DB_ENGINE == 'postgresql':
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': config('DB_NAME', default='uneworld'),
            'USER': config('DB_USER', default='postgres'),
            'PASSWORD': config('DB_PASSWORD', default=''),
            'HOST': config('DB_HOST', default='localhost'),
            'PORT': config('DB_PORT', default='5432'),
        }
    }
elif DB_ENGINE == 'mysql':
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.mysql',
            'NAME': config('DB_NAME', default='uneworld'),
            'USER': config('DB_USER', default='root'),
            'PASSWORD': config('DB_PASSWORD', default=''),
            'HOST': config('DB_HOST', default='localhost'),
            'PORT': config('DB_PORT', default='3306'),
            'OPTIONS': {'charset': 'utf8mb4'},
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
            # SQLite só permite um escritor por vez — sem isso, duas importações em
            # background gravando ao mesmo tempo (ex: "Importar tudo da internet" com
            # várias seções marcadas) lançam "database is locked" quase instantaneamente.
            # Com o timeout, a segunda thread espera a primeira liberar em vez de falhar.
            'OPTIONS': {'timeout': 30},
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'pt-br'
TIME_ZONE = 'America/Sao_Paulo'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# ── OnlyOffice Document Server (edição de Office na aba Observações do roteiro) ──
# Vazio = integração desligada (o front mostra baixar/visualizar em vez de editar).
ONLYOFFICE_DS_URL      = config('ONLYOFFICE_DS_URL', default='')       # URL pública do DS (ex.: http://localhost:8080)
ONLYOFFICE_JWT_SECRET  = config('ONLYOFFICE_JWT_SECRET', default='')   # segredo compartilhado com o DS
ONLYOFFICE_BACKEND_URL = config('ONLYOFFICE_BACKEND_URL', default='')  # URL do Django alcançável PELO container do DS

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Cache — usado pelo rate limiting (A-04). Com Redis (produção/multi-worker) o
# limite é compartilhado entre processos/réplicas; sem Redis (dev) cai no cache
# em memória do processo, que já basta localmente.
if REDIS_HOST:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': f"redis://{REDIS_HOST}:{config('REDIS_PORT', default=6379, cast=int)}/1",
        }
    }
else:
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'LOCATION': 'uneworld-throttle',
        }
    }

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
    # ScopedRateThrottle nativo fica como default global mas é INOFENSIVO: só
    # limita views que definem throttle_scope (nenhuma view interna define), então
    # os endpoints normais não são afetados. Os endpoints públicos sensíveis usam
    # throttles próprios por IP (core.throttling) via @throttle_classes.
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.ScopedRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'login': '5/min',
        'password_reset': '5/hour',
        'invite': '10/hour',
        'webhook': '60/min',
    },
}

DATA_UPLOAD_MAX_MEMORY_SIZE = 15 * 1024 * 1024  # 15 MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 15 * 1024 * 1024  # 15 MB

# Logging por módulo (A-15) — substitui os print() espalhados. Handler de console
# no nível INFO: erros/avisos aparecem; o "e-mail simulado" fica em DEBUG (não
# vaza destinatário em produção). Ajuste o nível por LOG_LEVEL no .env se precisar.
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'standard': {'format': '[%(asctime)s] %(levelname)s %(name)s: %(message)s'},
    },
    'handlers': {
        'console': {'class': 'logging.StreamHandler', 'formatter': 'standard'},
    },
    'root': {'handlers': ['console'], 'level': config('LOG_LEVEL', default='INFO')},
    'loggers': {
        'django': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
    },
}

CORS_ALLOWED_ORIGINS = config(
    'CORS_ALLOWED_ORIGINS',
    default='http://localhost:5173,http://127.0.0.1:5173'
).split(',')

CORS_ALLOW_CREDENTIALS = True

RESEND_API_KEY  = config('RESEND_API_KEY', default='')
RESEND_WEBHOOK_SECRET = config('RESEND_WEBHOOK_SECRET', default='')
RESEND_FROM     = config('RESEND_FROM_EMAIL', default='UneWorld Turismo <noreply@uneworld.com.br>')
FRONTEND_URL    = config('FRONTEND_URL', default='http://localhost:5173')
BACKEND_URL          = config('BACKEND_URL',          default='')
EMAIL_PREVIEW_ENABLED = config('EMAIL_PREVIEW_ENABLED', default='True') == 'True'
MAXMIND_ACCOUNT_ID  = config('MAXMIND_ACCOUNT_ID', default='')
MAXMIND_LICENSE_KEY = config('MAXMIND_LICENSE_KEY', default='')

# Autentique — assinatura digital. SANDBOX cria documentos de teste (sem valor
# jurídico, sem consumir créditos). DELIVERY: email (padrão) | whatsapp | sms.
# WEBHOOK_SECRET protege o endpoint público que a Autentique chama ao concluir.
AUTENTIQUE_API_TOKEN      = config('AUTENTIQUE_API_TOKEN', default='')
AUTENTIQUE_SANDBOX        = config('AUTENTIQUE_SANDBOX', default=True, cast=bool)
AUTENTIQUE_DELIVERY       = config('AUTENTIQUE_DELIVERY', default='email')
AUTENTIQUE_WEBHOOK_SECRET = config('AUTENTIQUE_WEBHOOK_SECRET', default='')
GEOIP_DB_PATH = BASE_DIR / 'geoip_db' / 'GeoLite2-City.mmdb'
CORS_EXPOSE_HEADERS = ['Content-Disposition']

CSRF_TRUSTED_ORIGINS = config(
    'CSRF_TRUSTED_ORIGINS',
    default='http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://192.168.1.55:5173,http://192.168.1.55:8000'
).split(',')

# Atrás do nginx/Cloudflare (modo "Flexible": HTTPS público, HTTP simples até o
# servidor), o Django só sabe que a conexão original era HTTPS através deste
# cabeçalho — sem isso, cookies "secure" e o redirect de HTTPS funcionam errado.
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

# ── Hardening HTTP (auditoria IDS — A-06) ──────────────────────────────────────
# Proteções que valem para QUALQUER ambiente (não dependem de HTTPS):
SECURE_CONTENT_TYPE_NOSNIFF = True          # impede sniffing de MIME type
SESSION_COOKIE_HTTPONLY = True              # cookie de sessão inacessível via JS
SESSION_COOKIE_SAMESITE = 'Lax'             # mitiga CSRF cross-site
CSRF_COOKIE_SAMESITE = 'Lax'

# HSTS e redirect forçado para HTTPS só em PRODUÇÃO (DEBUG=False). Em dev local
# (HTTP puro) ligar isso quebraria o acesso — o browser passaria a exigir HTTPS.
# O redirect respeita o SECURE_PROXY_SSL_HEADER acima (Cloudflare/nginx), então
# não entra em loop quando o TLS termina no proxy.
if not DEBUG:
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = 31536000          # 1 ano
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
