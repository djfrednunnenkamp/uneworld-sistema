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
    'laminas',
    'drive',
    'vouchers',
    'channels',
    'financeiro',
    'reservations',
]

# Drive (documentos na nuvem): por padrão os arquivos são PRIVADOS (só o dono vê).
# Se DRIVE_SUPERUSER_ACCESS=True, o superusuário também pode ver/abrir os arquivos
# de todos os usuários.
DRIVE_SUPERUSER_ACCESS = config('DRIVE_SUPERUSER_ACCESS', default=False, cast=bool)

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
            # PubSub em vez do RedisChannelLayer (baseado em listas/BRPOP): o uso
            # aqui é só broadcast (group_send p/ o dashboard), e o layer de listas
            # cospe "Timeout reading from redis" periódico nas conexões WS ociosas.
            # O PubSub usa pub/sub nativo (sem BRPOP bloqueante) e não tem esse ruído.
            'BACKEND': 'channels_redis.pubsub.RedisPubSubChannelLayer',
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

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# --- Armazenamento de mídia PÚBLICA no S3 (django-storages) ---------------------
# Imagens públicas (logos, imagens/vídeos de roteiro, avatares, fotos, vouchers) vão
# DIRETO pro S3 — não ocupam o disco do servidor. Documentos SENSÍVEIS continuam no
# storage 'default' (local + views autenticadas). Se S3_BUCKET/credenciais estiverem
# vazios (dev), 'public_media' cai no filesystem local — nada quebra.
AWS_ACCESS_KEY_ID       = config('AWS_ACCESS_KEY_ID', default='')
AWS_SECRET_ACCESS_KEY   = config('AWS_SECRET_ACCESS_KEY', default='')
AWS_S3_REGION_NAME      = config('AWS_REGION', default='us-east-2')
AWS_STORAGE_BUCKET_NAME = config('S3_BUCKET', default='')
S3_PUBLIC_PREFIX        = config('S3_PREFIX', default='').strip('/')
_USE_S3_PUBLIC = bool(AWS_STORAGE_BUCKET_NAME and AWS_ACCESS_KEY_ID)

STORAGES = {
    # Documentos SENSÍVEIS (docs de passageiro/roteiro, contratos, Drive, assinatura
    # do CEO) — filesystem local, servidos só por views autenticadas (A-11).
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}

if _USE_S3_PUBLIC:
    STORAGES['public_media'] = {
        'BACKEND': 'storages.backends.s3.S3Storage',
        'OPTIONS': {
            'access_key': AWS_ACCESS_KEY_ID,
            'secret_key': AWS_SECRET_ACCESS_KEY,
            'bucket_name': AWS_STORAGE_BUCKET_NAME,
            'region_name': AWS_S3_REGION_NAME,
            'location': S3_PUBLIC_PREFIX,   # ex.: uneworld/intranet/images/prod
            # Host REGIONAL fixo nas URLs (senão o django-storages gera o global
            # 's3.amazonaws.com', que não bate com a CSP do front). Determinístico.
            'custom_domain': f'{AWS_STORAGE_BUCKET_NAME}.s3.{AWS_S3_REGION_NAME}.amazonaws.com',
            'querystring_auth': False,      # URLs públicas limpas (sem assinatura)
            'default_acl': None,            # bucket usa policy pública no prefixo (ACLs off)
            'file_overwrite': False,
        },
    }
else:
    STORAGES['public_media'] = {'BACKEND': 'django.core.files.storage.FileSystemStorage'}

# ── Processamento de vídeo da Galeria (FFmpeg) ──────────────────────────────────
# Vídeos enviados à Galeria são NORMALIZADOS (H.264/yuv420p/faststart, timestamps
# reconstruídos) para tocar em qualquer navegador, e ganham uma thumbnail real.
# Precisa dos binários ffmpeg/ffprobe no PATH (ou caminho absoluto abaixo). Sem
# eles, o upload é aceito mas o registro fica 'failed' com mensagem clara.
# Aceita FFMPEG_BINARY/FFPROBE_BINARY (caminho absoluto explícito) OU FFMPEG_BIN
# (nome no PATH). Útil quando o processo Django foi iniciado com um PATH diferente
# do terminal (ex.: ffmpeg em ~/.local/bin e o systemd/daphne sem esse dir).
FFMPEG_BIN  = config('FFMPEG_BINARY',  default=config('FFMPEG_BIN',  default='ffmpeg'))
FFPROBE_BIN = config('FFPROBE_BINARY', default=config('FFPROBE_BIN', default='ffprobe'))
# Tempos-limite (segundos) por etapa — protegem contra vídeos maliciosos/travados.
FFPROBE_TIMEOUT   = config('FFPROBE_TIMEOUT',   default=60,   cast=int)
FFMPEG_TIMEOUT    = config('FFMPEG_TIMEOUT',    default=1800, cast=int)  # 30 min p/ vídeos longos
THUMBNAIL_TIMEOUT = config('THUMBNAIL_TIMEOUT', default=120,  cast=int)
# Taxa de quadros-alvo da normalização (CFR) quando a origem tem timestamps ruins.
VIDEO_TARGET_FPS  = config('VIDEO_TARGET_FPS',  default=30, cast=int)
VIDEO_MAX_HEIGHT  = config('VIDEO_MAX_HEIGHT',  default=1080, cast=int)  # não amplia; só limita p/ baixo
VIDEO_CRF         = config('VIDEO_CRF',         default=23, cast=int)
VIDEO_PRESET      = config('VIDEO_PRESET',      default='medium')
# Fallback WebM (VP9/Opus): navegadores/players Linux sem decoder H.264 tocam esta
# versão. É gerada ADICIONALMENTE ao MP4 (não o substitui). Se falhar, o vídeo ainda
# fica 'ready' (MP4 continua servindo). Desligue com VIDEO_MAKE_WEBM=0.
# WebM = **VP8/Vorbis** (não VP9/Opus): decodifica no GStreamer PADRÃO do Ubuntu
# (plugins-good/base), que todo Ubuntu tem — VP9/Opus exigem plugins-bad/opus, nem
# sempre presentes. Comprovado com gst-discoverer (VP9 → "Missing plugins" no stock).
VIDEO_MAKE_WEBM   = config('VIDEO_MAKE_WEBM',   default=True, cast=bool)
VIDEO_VP8_CRF     = config('VIDEO_VP8_CRF',     default=10, cast=int)    # 4..63 (menor = melhor)
VIDEO_VP8_BITRATE = config('VIDEO_VP8_BITRATE', default='1M')            # teto de bitrate do VP8
VIDEO_VP8_CPU_USED= config('VIDEO_VP8_CPU_USED',default=2,  cast=int)    # 0=melhor/lento … 5=rápido
VIDEO_VP8_DEADLINE= config('VIDEO_VP8_DEADLINE',default='good')          # 'good' | 'realtime'
VIDEO_WEBM_TIMEOUT= config('VIDEO_WEBM_TIMEOUT',default=3600, cast=int)  # VP8 é lento (até 1h)
# Processar numa THREAD de fundo logo após o upload (dev/prod sem worker dedicado).
# NÃO bloqueia a requisição — o upload responde na hora (status 'processing') e a
# conversão roda em paralelo. Desligue (0) para processar SÓ pelo comando
# `manage.py reprocess_videos` (cron/worker externo). Ver VIDEO_PROCESS_MODE p/ o
# nome explícito. (Alias mantido por compatibilidade.)
VIDEO_PROCESS_MODE = config('VIDEO_PROCESS_MODE', default='thread')  # 'thread' | 'off'
VIDEO_PROCESS_INLINE = config('VIDEO_PROCESS_INLINE', default=(VIDEO_PROCESS_MODE != 'off'), cast=bool)
# Um vídeo em 'processing' sem heartbeat há mais que isto é considerado ABANDONADO
# (thread/processo morreu). Baseado em heartbeat, não na duração total — vídeos
# grandes podem demorar, mas precisam continuar emitindo sinal de vida.
VIDEO_STUCK_HEARTBEAT_SECONDS = config('VIDEO_STUCK_HEARTBEAT_SECONDS', default=120, cast=int)
VIDEO_MAX_PROCESSING_ATTEMPTS = config('VIDEO_MAX_PROCESSING_ATTEMPTS', default=3, cast=int)
# ── Exportação avançada (sob demanda) ──────────────────────────────────────────
# Gera outros formatos/codecs sob demanda, com CACHE por config. Não gera tudo
# antecipadamente. Ajuste limites conforme a CPU do servidor.
VIDEO_EXPORT_TIMEOUT      = config('VIDEO_EXPORT_TIMEOUT',      default=3600, cast=int)  # por conversão
VIDEO_EXPORT_EXPIRY_DAYS  = config('VIDEO_EXPORT_EXPIRY_DAYS',  default=7,    cast=int)  # cache
VIDEO_EXPORT_MAX_PER_USER = config('VIDEO_EXPORT_MAX_PER_USER', default=3,    cast=int)  # simultâneas/usuário
VIDEO_EXPORT_MAX_TOTAL    = config('VIDEO_EXPORT_MAX_TOTAL',    default=6,    cast=int)  # simultâneas global
VIDEO_AV1_CPU_USED        = config('VIDEO_AV1_CPU_USED',        default=6,    cast=int)  # AV1 é lento

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
    # Sessão expirada/ausente → 401 (e não o 403 padrão do SessionAuthentication),
    # para o front distinguir "faça login de novo" de "sem permissão".
    'EXCEPTION_HANDLER': 'core.drf_exceptions.exception_handler',
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
    'filters': {
        # Silencia o CancelledError de cliente que desconecta no meio da requisição.
        'skip_client_cancelled': {'()': 'core.logging_filters.SkipClientCancelled'},
    },
    'handlers': {
        'console': {'class': 'logging.StreamHandler', 'formatter': 'standard',
                    'filters': ['skip_client_cancelled']},
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

# --- E-mail SMTP (fallback quando NÃO houver RESEND_API_KEY) ---------------------
# O envio transacional usa Resend por padrão (agenda/email_service.py). Se RESEND_API_KEY
# estiver vazio E EMAIL_HOST preenchido, o envio cai pro SMTP do Django (ex.: Mailgun).
# Sem nenhum dos dois, o e-mail é apenas simulado/logado. Não muda produção (que usa Resend).
EMAIL_BACKEND       = config('EMAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST          = config('EMAIL_HOST', default='')
EMAIL_PORT          = config('EMAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS       = config('EMAIL_USE_TLS', default=True, cast=bool)
EMAIL_USE_SSL       = config('EMAIL_USE_SSL', default=False, cast=bool)
EMAIL_HOST_USER     = config('EMAIL_HOST_USER', default='')
EMAIL_HOST_PASSWORD = config('EMAIL_HOST_PASSWORD', default='')
EMAIL_TIMEOUT       = config('EMAIL_TIMEOUT', default=15, cast=int)
# Remetente do SMTP. Tem que ser de um domínio autorizado no provedor (Mailgun),
# por isso NÃO cai no RESEND_FROM (que é @uneworld.com.br) — usa o próprio usuário SMTP.
EMAIL_FROM          = config('EMAIL_FROM', default='') or EMAIL_HOST_USER

MAXMIND_ACCOUNT_ID  = config('MAXMIND_ACCOUNT_ID', default='')
MAXMIND_LICENSE_KEY = config('MAXMIND_LICENSE_KEY', default='')

# Autentique — assinatura digital. SANDBOX cria documentos de teste (sem valor
# jurídico, sem consumir créditos). DELIVERY: email (padrão) | whatsapp | sms.
# WEBHOOK_SECRET protege o endpoint público que a Autentique chama ao concluir.
AUTENTIQUE_API_TOKEN      = config('AUTENTIQUE_API_TOKEN', default='')
AUTENTIQUE_SANDBOX        = config('AUTENTIQUE_SANDBOX', default=True, cast=bool)
AUTENTIQUE_DELIVERY       = config('AUTENTIQUE_DELIVERY', default='email')
AUTENTIQUE_WEBHOOK_SECRET = config('AUTENTIQUE_WEBHOOK_SECRET', default='')

# ── Verificação do contrato assinado (QR) ─────────────────────────────────────
# No upload do contrato assinado (físico), confere pelos QR de cada página se é
# ESTE contrato, na versão atual, com todas as páginas na ordem. Ligado por
# padrão; desligue com CONTRACT_QR_VERIFY=False (aceita o upload sem conferir).
CONTRACT_QR_VERIFY = config('CONTRACT_QR_VERIFY', default=True, cast=bool)

# ── Retenção dos logs de auditoria (poda automática pelo agendador) ───────────
# Idade máxima, em DIAS, para manter cada tipo de log. Vazio/ausente = infinito
# (guarda para sempre, até acabar o armazenamento).
#  - NAVIGATION: navegação/movimento (páginas visitadas + login/logout).
#  - CHANGE: mudanças no banco (criação/edição/exclusão de registros).
def _retention_days(key):
    raw = config(key, default='')
    try:
        n = int(str(raw).strip())
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None
AUDIT_NAVIGATION_RETENTION_DAYS = _retention_days('AUDIT_NAVIGATION_RETENTION_DAYS')
AUDIT_CHANGE_RETENTION_DAYS     = _retention_days('AUDIT_CHANGE_RETENTION_DAYS')

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

# Nº de proxies confiáveis à frente do Django (nginx=1; Cloudflare→nginx=2). Usado
# por core.throttling.client_ip para extrair o IP real do X-Forwarded-For a partir
# da direita, sem confiar no item forjável da esquerda (anti-bypass de rate-limit).
TRUSTED_PROXY_COUNT = config('TRUSTED_PROXY_COUNT', default=1, cast=int)

# Cookies só por HTTPS. Default seguro (True em produção). Para testar por HTTP
# puro (ex.: acesso por IP sem TLS) defina SESSION_COOKIE_SECURE=False no .env —
# senão o navegador nem guarda o cookie de sessão e o login não "cola".
SESSION_COOKIE_SECURE = config('SESSION_COOKIE_SECURE', default=not DEBUG, cast=bool)
CSRF_COOKIE_SECURE = config('CSRF_COOKIE_SECURE', default=not DEBUG, cast=bool)

# Expiração de sessão. O default do Django é 2 SEMANAS fixas — demais para um ERP
# com PII (CPF/RG/passaporte): um cookie roubado ou navegador esquecido fica válido
# por 14 dias. Aqui: timeout de INATIVIDADE (o prazo renova a cada request enquanto
# a pessoa usa, mas expira após SESSION_COOKIE_AGE parado). Ajustável por env.
SESSION_COOKIE_AGE = config('SESSION_COOKIE_AGE', default=60 * 60 * 12, cast=int)  # 12h
SESSION_SAVE_EVERY_REQUEST = True

# ── Hardening HTTP (auditoria IDS — A-06) ──────────────────────────────────────
# Proteções que valem para QUALQUER ambiente (não dependem de HTTPS):
SECURE_CONTENT_TYPE_NOSNIFF = True          # impede sniffing de MIME type
SESSION_COOKIE_HTTPONLY = True              # cookie de sessão inacessível via JS
SESSION_COOKIE_SAMESITE = 'Lax'             # mitiga CSRF cross-site
CSRF_COOKIE_SAMESITE = 'Lax'

# Domínio dos cookies de sessão/CSRF. Em deploy cross-subdomínio (front e back em
# subdomínios distintos do MESMO domínio — ex.: uneworld-intranet... e
# backend-uneworld-intranet...), defina o domínio-pai (ex.: ".uneworld.com.br")
# para o cookie ser compartilhado entre os dois e o CSRF-token ser legível pelo
# front. Vazio (None) = comportamento padrão do Django (cookie preso ao host).
# Isso continua same-site (SameSite=Lax funciona), pois compartilham o mesmo
# domínio registrável.
# Vazio = None (cookie preso ao host — obrigatório ao acessar por IP, pois não dá
# para prender cookie a um domínio-pai quando o host é um IP).
SESSION_COOKIE_DOMAIN = config('SESSION_COOKIE_DOMAIN', default='') or None
CSRF_COOKIE_DOMAIN = config('CSRF_COOKIE_DOMAIN', default='') or None

# Redirect forçado para HTTPS + HSTS. Default: ligado em produção (DEBUG=False).
# Para testar por HTTP puro (acesso por IP sem TLS), defina SECURE_SSL_REDIRECT=False
# no .env — senão o Django devolve 301 para https:// e o teste por HTTP quebra.
# O redirect respeita o SECURE_PROXY_SSL_HEADER acima, então não entra em loop
# quando o TLS termina no proxy (Cloudflare/NPM).
SECURE_SSL_REDIRECT = config('SECURE_SSL_REDIRECT', default=not DEBUG, cast=bool)
if SECURE_SSL_REDIRECT:
    SECURE_HSTS_SECONDS = 31536000          # 1 ano
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    # O healthcheck do Docker bate em http://127.0.0.1:8000/healthz SEM passar pelo
    # proxy (logo, sem X-Forwarded-Proto: https), então o SecurityMiddleware o
    # redirecionaria (301) e o container ficaria "unhealthy". Isenta /healthz do
    # redirect — é público e não trafega dado sensível. (Padrão matched contra
    # request.path sem a barra inicial.)
    #
    # Mesma questão para o OnlyOffice Document Server: ele chama o backend por HTTP
    # interno (ONLYOFFICE_BACKEND_URL=http://backend:8000), sem TLS e sem o header
    # X-Forwarded-Proto: https. Sem isentar, o 301→https quebraria o download do
    # documento (view assinada) e o callback de salvar (que não seguem redirect).
    # Endpoints protegidos por token/assinatura JWT — não abrem nada extra.
    SECURE_REDIRECT_EXEMPT = [
        r'^healthz$',
        r'^api/drive/oo-download/$',
        r'^api/drive/\d+/callback/$',
        r'^api/itineraries/documents/oo-download/$',
        r'^api/itineraries/documents/\d+/callback/$',
    ]

# ── Monitoramento de erros (Sentry) — OPCIONAL ────────────────────────────────
# Ativa só quando SENTRY_DSN está definido (e fora de DEBUG). O import é protegido:
# se a lib não estiver instalada, não quebra o boot — apenas não reporta.
SENTRY_DSN = config('SENTRY_DSN', default='')
if SENTRY_DSN and not DEBUG:
    try:
        import sentry_sdk
        from sentry_sdk.integrations.django import DjangoIntegration
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            integrations=[DjangoIntegration()],
            traces_sample_rate=config('SENTRY_TRACES_SAMPLE_RATE', default=0.0, cast=float),
            send_default_pii=False,          # não envia dados de usuário/PII ao Sentry
            environment=config('SENTRY_ENVIRONMENT', default='production'),
        )
    except Exception:
        pass
