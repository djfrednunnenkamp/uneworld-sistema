#!/bin/sh
set -e

if [ "$DB_ENGINE" = "postgresql" ]; then
  echo "Aguardando o banco de dados em ${DB_HOST:-db}:${DB_PORT:-5432}..."
  until python -c "
import socket, os, sys
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(1)
try:
    s.connect((os.environ.get('DB_HOST', 'db'), int(os.environ.get('DB_PORT', 5432))))
except OSError:
    sys.exit(1)
"; do
    sleep 1
  done
  echo "Banco de dados disponível."
fi

python manage.py migrate --noinput
python manage.py collectstatic --noinput

echo "Iniciando Daphne (ASGI) na porta 8000..."
RUN_SCHEDULER=1 exec daphne -b 0.0.0.0 -p 8000 core.asgi:application
