#!/bin/bash
# Script para iniciar o backend Django e o frontend React

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# IP local da máquina (para exibir o endereço de rede)
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

echo "=== UneWorld Sistema ==="
echo ""

# Inicia o backend Django
echo "[Backend] Iniciando Django na porta 8000..."
cd "$PROJECT_DIR/backend"
source "$PROJECT_DIR/venv/bin/activate"
python manage.py runserver 0.0.0.0:8000 &
BACKEND_PID=$!

# Aguarda o backend subir
sleep 2

# Inicia o frontend React
echo "[Frontend] Iniciando React na porta 5173..."
cd "$PROJECT_DIR/frontend"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Sistema rodando:"
echo "  Local:    http://localhost:5173"
if [ -n "$LOCAL_IP" ]; then
  echo "  Rede:     http://$LOCAL_IP:5173"
fi
echo ""
echo "Pressione Ctrl+C para parar tudo."

# Aguarda e limpa ao encerrar
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait
