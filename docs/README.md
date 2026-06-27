# Documentação — UneWorld Sistema

Documentação técnica do painel interno da **UneWorld Turismo**, voltada para a
equipe de desenvolvimento. O objetivo é permitir que qualquer pessoa entenda
rapidamente **o que cada parte do sistema faz, o que é esperado dela e como o
código está organizado**.

> Para a visão de produto e o passo a passo de instalação, veja o
> [README.md](../README.md) na raiz. Para deploy, veja o [DEPLOY.md](../DEPLOY.md).

## Índice

| Documento | O que contém |
|-----------|--------------|
| [ARQUITETURA.md](ARQUITETURA.md) | Visão geral técnica: stack, organização de pastas, fluxo de dados, autenticação, tempo real (WebSocket), e-mails, soft-delete, jobs em background. |
| [GUIA_DESENVOLVEDOR.md](GUIA_DESENVOLVEDOR.md) | Como rodar o projeto, convenções de código, padrões recorrentes, e "armadilhas" conhecidas que já causaram bugs. |
| [PERMISSOES.md](PERMISSOES.md) | Como funciona o sistema de permissões granulares e por que front e back precisam estar sincronizados. |
| [PAGINAS.md](PAGINAS.md) | O que **cada página** do frontend faz e o que é esperado dela (rota, ações, permissões, APIs). |
| [BACKEND.md](BACKEND.md) | O que **cada app Django** faz: responsabilidade, modelos, endpoints, particularidades. |
| [RELATORIO_FALHAS.md](RELATORIO_FALHAS.md) | Auditoria de falhas de lógica encontradas no código e as correções aplicadas. |

## Mapa rápido do sistema

O sistema gira em torno de quatro entidades centrais:

- **Passageiro** — a pessoa que viaja (cadastro completo + documentos).
- **Lista de Passageiros** (também chamada de "Viagem") — a operação: quem vai,
  em qual acomodação, em qual voo/ônibus, com quais prazos e pendências.
- **Roteiro** — o "produto" comercial publicável (destinos, conteúdo editorial,
  datas, dados financeiros). Distinto da Lista operacional.
- **Agência** — parceiro/representante que traz passageiros.

Em volta disso há: **Contratos**, **Calendário/Agenda** (com e-mails
automáticos), **Configurações** (dezenas de catálogos), **Usuários &
Permissões** e **Log de Auditoria**.
