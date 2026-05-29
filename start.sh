#!/bin/bash
# Script para iniciar o backend Django e o frontend React

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== UneWorld Sistema ==="
echo ""

# Inicia o backend Django
echo "[Backend] Iniciando Django na porta 8000..."
cd "$PROJECT_DIR/backend"
source "$PROJECT_DIR/venv/bin/activate"
python manage.py runserver 8000 &
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
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "  Admin:    http://localhost:8000/admin  (admin / uneworld2026)"
echo ""
echo "Pressione Ctrl+C para parar tudo."

# Aguarda e limpa ao encerrar
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait
