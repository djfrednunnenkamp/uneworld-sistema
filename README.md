<div align="center">
  <img src="frontend/public/logo.png" alt="UneWorld Turismo" width="220">

  # UneWorld Sistema

  Sistema de gestão para agência de turismo — passageiros, viagens, agências
  parceiras, calendário, documentos e contratos, tudo em um só painel.

  ![Django](https://img.shields.io/badge/Django-6.0-092E20?logo=django&logoColor=white)
  ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
  ![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
  ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
</div>

---

## O que é

O **UneWorld Sistema** é o painel interno da UneWorld Turismo para organizar
toda a operação de viagens em grupo: quem vai, com quem, em qual lista,
quais documentos estão pendentes, quando vence cada prazo, e quem já confirmou.

## Funcionalidades

**Gestão de passageiros e viagens**
- Cadastro completo de passageiros (documentos, vacinas, contatos de emergência)
- Listas de passageiros por viagem (aérea ou terrestre), com inscrições, voos e mapas de ônibus
- Agências parceiras e seus representantes
- Importação e exportação em massa via CSV (com revisão antes de confirmar)

**Calendário e notificações**
- Calendário unificado de viagens, prazos de confirmação, pendências e aniversários
- Resumo diário e lembretes automáticos por e-mail
- Indicadores de entrega e leitura de cada e-mail enviado (via Resend)

**Documentos e contratos**
- Modelos de documentos e cláusulas de contrato configuráveis
- Termos e condições com controle de aceite por usuário

**Administração**
- Permissões granulares por usuário e por área do sistema
- Log de auditoria (quem fez o quê, quando e de onde)
- Mais de uma dezena de catálogos configuráveis (idiomas, países, aeroportos, companhias aéreas, vacinas, perfis de acomodação, mapas de ônibus, etc.), todos com importação/exportação em CSV

## Stack

| Camada    | Tecnologia |
|-----------|------------|
| Backend   | Django 6 + Django REST Framework + Channels (WebSockets) |
| Frontend  | React 19 + Vite + Tailwind CSS |
| Banco     | PostgreSQL (produção) / SQLite (desenvolvimento) |
| Real-time | Django Channels + Redis |
| E-mail    | Resend |
| Deploy    | Docker + GitHub Actions (publica automaticamente no GHCR) |

## Rodando localmente (desenvolvimento)

```bash
git clone git@github.com:djfrednunnenkamp/uneworld-sistema.git
cd uneworld-sistema

# Backend
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env   # preencha SECRET_KEY e demais valores
cd backend && python manage.py migrate && cd ..

# Frontend
cd frontend && npm install && cd ..

# Sobe os dois de uma vez
./start.sh
```

Backend em `http://localhost:8000`, frontend em `http://localhost:5173`.

## Deploy em produção

O deploy é feito via Docker, com as imagens publicadas automaticamente no
GitHub Container Registry a cada push. Veja o passo a passo completo em
**[DEPLOY.md](DEPLOY.md)**.

## Documentação para desenvolvedores

A documentação técnica completa está em **[docs/](docs/README.md)**:
arquitetura, guia do desenvolvedor, sistema de permissões, o que cada página
faz, cada app do backend e o relatório de auditoria de falhas.

## Estrutura do repositório

```
backend/    Django + DRF — API, modelos, regras de negócio
frontend/   React + Vite — interface do painel
docs/       Documentação técnica da equipe (arquitetura, páginas, backend…)
docker-compose.yml        Build local (dev-parity)
docker-compose.prod.yml   Produção — usa as imagens do GHCR
.github/workflows/        CI: build e publicação automática das imagens Docker
DEPLOY.md                 Guia de deploy em servidor Ubuntu, passo a passo
```
