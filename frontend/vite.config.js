import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Hosts que o dev server aceita (protege contra DNS rebinding). Para acessar de
// fora (ex.: túnel Cloudflare apontando um domínio para esta máquina), liste o
// domínio aqui ou em VITE_ALLOWED_HOSTS no frontend/.env (separado por vírgula).
// Um item começando com "." vira curinga de subdomínios (ex.: .fnunnenkamp.com.br).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const extra = (env.VITE_ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean)
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      host: true,
      allowedHosts: ['localhost', '127.0.0.1', '.fnunnenkamp.com.br', ...extra],
      proxy: {
        '/api': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/media': {
          target: 'http://localhost:8000',
          changeOrigin: true,
        },
        '/ws': {
          target: 'http://localhost:8000',
          ws: true,
          changeOrigin: true,
        },
      },
    },
  }
})
