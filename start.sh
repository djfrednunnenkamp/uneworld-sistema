#!/bin/bash
# Script para iniciar o backend Django e o frontend React.
#
# Desde a separação do sistema, backend e frontend ficam em pastas irmãs:
#   UneWorld System/
#     ├── Uni_Back   (este repositório — backend Django)
#     └── Uni_Front  (frontend React/Vite)
#
# O caminho do frontend pode ser sobrescrito com a variável FRONTEND_DIR:
#   FRONTEND_DIR="/outro/caminho" ./start.sh

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
# Por padrão, o front é a pasta irmã ao lado do back. Aceita tanto "Uni_Front"
# quanto "Uni Front" (com espaço). Pode ser sobrescrito via FRONTEND_DIR.
if [ -z "$FRONTEND_DIR" ]; then
  PARENT_DIR="$(cd "$PROJECT_DIR/.." && pwd)"
  for candidate in "$PARENT_DIR/Uni_Front" "$PARENT_DIR/Uni Front"; do
    if [ -d "$candidate" ]; then
      FRONTEND_DIR="$candidate"
      break
    fi
  done
  # Fallback: procura uma pasta irmã com package.json + vite.config.js
  if [ -z "$FRONTEND_DIR" ]; then
    for candidate in "$PARENT_DIR"/*/; do
      if [ -f "${candidate}package.json" ] && [ -f "${candidate}vite.config.js" ]; then
        FRONTEND_DIR="${candidate%/}"
        break
      fi
    done
  fi
fi

# IP local da máquina (para exibir o endereço de rede)
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')

echo "=== UneWorld Sistema ==="
echo ""

# Validações antes de subir qualquer coisa
if [ ! -d "$BACKEND_DIR" ]; then
  echo "ERRO: pasta do backend não encontrada em: $BACKEND_DIR"
  exit 1
fi
if [ ! -f "$PROJECT_DIR/venv/bin/activate" ]; then
  echo "ERRO: virtualenv não encontrado em: $PROJECT_DIR/venv"
  echo "      Crie com: python -m venv venv && source venv/bin/activate && pip install -r backend/requirements.txt"
  exit 1
fi
if [ ! -d "$FRONTEND_DIR" ]; then
  echo "ERRO: pasta do frontend não encontrada em: $FRONTEND_DIR"
  echo "      Ajuste com: FRONTEND_DIR=\"/caminho/do/front\" ./start.sh"
  exit 1
fi

# Inicia o backend Django
echo "[Backend]  Iniciando Django na porta 8000..."
echo "           $BACKEND_DIR"
cd "$BACKEND_DIR"
source "$PROJECT_DIR/venv/bin/activate"
python manage.py runserver 0.0.0.0:8000 &
BACKEND_PID=$!

# Aguarda o backend subir
sleep 2

# Inicia o frontend React (Vite)
echo "[Frontend] Iniciando React na porta 5173..."
echo "           $FRONTEND_DIR"
cd "$FRONTEND_DIR"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
# Instala dependências na primeira execução (se node_modules não existir)
if [ ! -d "node_modules" ]; then
  echo "[Frontend] Instalando dependências (npm install)..."
  npm install
fi
npm run dev &
FRONTEND_PID=$!

echo ""
echo "Sistema rodando:"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
if [ -n "$LOCAL_IP" ]; then
  echo "  Rede:     http://$LOCAL_IP:5173"
fi
echo ""
echo "Pressione Ctrl+C para parar tudo."

# Aguarda e limpa ao encerrar
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait
